"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useSession } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase";

type Mode = "login" | "signup" | "reset";

const MIN_PASSWORD = 10;

function friendlyError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("signup_not_allowed") || text.includes("database error saving new user")) {
    return "Diese E-Mail-Adresse ist für Recall nicht freigeschaltet.";
  }
  if (text.includes("invalid login credentials")) return "E-Mail-Adresse oder Passwort ist falsch.";
  if (text.includes("email not confirmed")) {
    return "Bitte bestätige zuerst deine E-Mail-Adresse über den Link in der Mail.";
  }
  if (text.includes("already registered") || text.includes("already been registered")) {
    return "Für diese Adresse gibt es schon ein Konto. Bitte melde dich an.";
  }
  if (text.includes("rate limit") || text.includes("security purposes")) {
    return "Zu viele Versuche. Bitte warte ein paar Minuten und versuche es erneut.";
  }
  if (text.includes("password")) return `Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`;
  if (text.includes("failed to fetch") || text.includes("network")) return "Keine Verbindung zum Server.";
  return message;
}

const TITLES: Record<Mode, string> = {
  login: "Anmelden",
  signup: "Konto anlegen",
  reset: "Passwort zurücksetzen",
};

export default function LoginPage() {
  const router = useRouter();
  const session = useSession();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (session) router.replace("/");
  }, [session, router]);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const supabase = getSupabase();
    const redirectTo = `${window.location.origin}/auth/confirm`;
    try {
      if (mode === "login") {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authError) throw authError;
        router.replace("/");
      } else if (mode === "signup") {
        if (password.length < MIN_PASSWORD) {
          throw new Error(`Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`);
        }
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: redirectTo },
        });
        if (authError) throw authError;
        if (data.session) {
          router.replace("/");
        } else {
          setNotice(
            "Fast geschafft: Öffne den Bestätigungslink in der E-Mail. Danach meldest du dich hier mit deinem Passwort an.",
          );
          setMode("login");
        }
      } else {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo,
        });
        if (authError) throw authError;
        setNotice("Wenn ein Konto existiert, ist ein Link zum Zurücksetzen unterwegs. Öffne ihn auf diesem Gerät.");
      }
    } catch (submitError) {
      setError(friendlyError(submitError instanceof Error ? submitError.message : String(submitError)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-[2rem] font-semibold leading-none tracking-[-0.03em]">
          <span className="rounded-[0.2rem] bg-marker px-1.5 text-marker-ink [box-decoration-break:clone]">
            Recall
          </span>
        </h1>
        <p className="mt-3 text-muted">Karteikarten für deine Klausuren.</p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <h2 className="text-lg font-semibold">{TITLES[mode]}</h2>
          <div>
            <label htmlFor="email" className="label">
              E-Mail-Adresse
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {mode !== "reset" && (
            <div>
              <label htmlFor="password" className="label">
                Passwort{mode === "signup" ? ` (mindestens ${MIN_PASSWORD} Zeichen)` : ""}
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={mode === "signup" ? MIN_PASSWORD : undefined}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                className="field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            {busy ? "Einen Moment …" : mode === "reset" ? "Link senden" : TITLES[mode]}
          </button>
        </form>

        {error && (
          <p role="alert" className="mt-4 text-sm text-again">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 rounded-xl bg-marker-soft p-3 text-sm">
            {notice}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {mode !== "login" && (
            <button type="button" className="link" onClick={() => switchMode("login")}>
              Zur Anmeldung
            </button>
          )}
          {mode !== "signup" && (
            <button type="button" className="link" onClick={() => switchMode("signup")}>
              Konto anlegen
            </button>
          )}
          {mode !== "reset" && (
            <button type="button" className="link" onClick={() => switchMode("reset")}>
              Passwort vergessen
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
