"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

/**
 * Ziel der Links aus den Supabase-Mails (Konto bestätigen, Passwort zurücksetzen).
 * Unterstützt beide Formate:
 *  - Standard-Mail der Cloud: Tokens im URL-Fragment (#access_token=…&type=signup|recovery)
 *  - eigene Vorlage / Tests: ?token_hash=…&type=…
 */
export default function ConfirmPage() {
  const router = useRouter();
  const [state, setState] = useState<"working" | "recovery" | "error">("working");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Tokens sind nur einmal gültig: auch bei doppelt ausgeführten Effekten nur einmal einlösen.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const supabase = getSupabase();
    const query = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    // Tokens nicht in der Adresszeile oder im Verlauf stehen lassen.
    window.history.replaceState(null, "", window.location.pathname);

    const fail = (message: string) => {
      setError(message);
      setState("error");
    };

    async function run() {
      const linkError = fragment.get("error_description") ?? query.get("error_description");
      if (linkError) {
        fail("Der Link ist ungültig oder abgelaufen. Fordere einen neuen an.");
        return;
      }

      let type = (fragment.get("type") ?? query.get("type") ?? "") as EmailOtpType | "";
      const accessToken = fragment.get("access_token");
      const refreshToken = fragment.get("refresh_token");
      const tokenHash = query.get("token_hash");

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) return fail("Der Link ist ungültig oder abgelaufen.");
      } else if (tokenHash) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: (type || "email") as EmailOtpType,
        });
        if (verifyError) return fail("Der Link ist ungültig oder abgelaufen.");
        type = type || "email";
      } else {
        router.replace("/login");
        return;
      }

      if (type === "recovery") {
        setState("recovery");
      } else {
        router.replace("/");
      }
    }
    void run();
  }, [router]);

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: updateError } = await getSupabase().auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(
        updateError.message.toLowerCase().includes("password")
          ? "Das Passwort braucht mindestens 10 Zeichen."
          : updateError.message,
      );
      return;
    }
    router.replace("/");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {state === "working" && (
          <p className="text-sm text-muted" aria-busy="true">
            Einen Moment …
          </p>
        )}
        {state === "recovery" && (
          <form onSubmit={savePassword} className="space-y-4">
            <h1 className="text-lg font-semibold">Neues Passwort festlegen</h1>
            <div>
              <label htmlFor="new-password" className="label">
                Neues Passwort (mindestens 10 Zeichen)
              </label>
              <input
                id="new-password"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
                className="field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              {busy ? "Speichert …" : "Passwort speichern"}
            </button>
            {error && (
              <p role="alert" className="text-sm text-again">
                {error}
              </p>
            )}
          </form>
        )}
        {state === "error" && (
          <div>
            <p role="alert" className="text-again">
              {error}
            </p>
            <Link href="/login" className="btn mt-4">
              Zur Anmeldung
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
