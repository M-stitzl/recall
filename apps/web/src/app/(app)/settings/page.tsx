"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ErrorNote, Loading, PageHeader } from "@/components/ui";
import { exportAll, fetchSettings, saveSettings } from "@/lib/data";
import { errorMessage, useQuery, useSession } from "@/lib/hooks";
import { pendingReviews } from "@/lib/outbox";
import { getSupabase } from "@/lib/supabase";
import type { Settings } from "@/lib/types";

export default function SettingsPage() {
  const router = useRouter();
  const session = useSession();
  const { data, error, loading, reload } = useQuery(fetchSettings);
  const [form, setForm] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage ist erst im Browser lesbar
    setPending(pendingReviews().length);
  }, []);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Unbekannter Fehler"} onRetry={reload} />;

  const values = form ?? data;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setFormError(null);
    try {
      await saveSettings(values);
      setMessage("Gespeichert.");
    } catch (saveError) {
      setFormError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function downloadBackup() {
    setBusy(true);
    setFormError(null);
    try {
      const dump = await exportAll();
      const blob = new Blob(
        [JSON.stringify({ exported_at: new Date().toISOString(), ...dump }, null, 2)],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `recall-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setFormError(errorMessage(exportError));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (pending > 0) {
      const ok = window.confirm(
        `${pending} Bewertungen sind noch nicht synchronisiert. Sie bleiben auf diesem Gerät gespeichert. Trotzdem abmelden?`,
      );
      if (!ok) return;
    }
    await getSupabase().auth.signOut();
    router.replace("/login");
  }

  return (
    <>
      <PageHeader title="Mehr" />

      <div className="mb-8 grid grid-cols-2 gap-2">
        <Link href="/import" className="btn">
          Karten importieren
        </Link>
        <button type="button" className="btn" disabled={busy} onClick={downloadBackup}>
          Backup als JSON
        </button>
      </div>

      <form onSubmit={submit} className="space-y-5 border-t border-border pt-6">
        <h2 className="text-lg font-semibold">Lernen</h2>
        <div>
          <label htmlFor="retention" className="label">
            Zielretention: {Math.round(values.desired_retention * 100)} %
          </label>
          <input
            id="retention"
            type="range"
            min={0.75}
            max={0.95}
            step={0.01}
            className="h-11 w-full"
            value={values.desired_retention}
            onChange={(e) => setForm({ ...values, desired_retention: Number(e.target.value) })}
          />
          <p className="mt-1 text-xs text-muted">
            Anteil der Karten, den du bei der Wiederholung noch wissen willst. Höher bedeutet mehr
            Wiederholungen pro Tag. Standard: 90 %.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="new-per-day" className="label">Neue Karten pro Tag</label>
            <input
              id="new-per-day"
              type="number"
              min={0}
              max={500}
              className="field"
              value={values.new_per_day}
              onChange={(e) => setForm({ ...values, new_per_day: Number(e.target.value) })}
            />
          </div>
          <div>
            <label htmlFor="max-reviews" className="label">Max. Wiederholungen pro Tag</label>
            <input
              id="max-reviews"
              type="number"
              min={0}
              max={5000}
              className="field"
              value={values.max_reviews_per_day}
              onChange={(e) => setForm({ ...values, max_reviews_per_day: Number(e.target.value) })}
            />
          </div>
        </div>
        {formError && <p role="alert" className="text-sm text-again">{formError}</p>}
        {message && <p role="status" className="text-sm text-good">{message}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Speichern
        </button>
      </form>

      <div className="mt-9 border-t border-border pt-6">
        <h2 className="text-lg font-semibold">Konto</h2>
        <p className="mt-1 text-sm text-muted">{session?.user.email}</p>
        {pending > 0 && (
          <p className="mt-2 text-sm text-hard">
            {pending} Bewertungen warten auf Synchronisierung.
          </p>
        )}
        <button type="button" className="btn mt-4" onClick={signOut}>
          Abmelden
        </button>
      </div>
    </>
  );
}
