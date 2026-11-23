"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { parseImportText } from "@recall/schema";
import { PageHeader } from "@/components/ui";
import { importNotes } from "@/lib/data";
import { errorMessage } from "@/lib/hooks";

const EXAMPLE = `[
  {
    "course": "Corporate Finance",
    "source": "VL03.pdf",
    "source_ref": "Folie 14",
    "type": "cloze",
    "front": "Der WACC gewichtet Eigen- und Fremdkapitalkosten mit ihren {{c1::Marktwerten}}.",
    "extra": "Buchwerte verzerren die Kapitalstruktur.",
    "tags": ["wacc"],
    "priority": "hoch"
  }
]`;

export default function ImportPage() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ inserted: number; duplicates: number } | null>(null);

  const parsed = useMemo(() => (text.trim() ? parseImportText(text) : null), [text]);

  const summary = useMemo(() => {
    if (!parsed?.ok) return null;
    const courses = new Map<string, number>();
    let flagged = 0;
    for (const note of parsed.notes) {
      courses.set(note.course, (courses.get(note.course) ?? 0) + 1);
      if (note.check && (!note.check.ok || note.check.issues.length > 0)) flagged += 1;
    }
    return { courses: [...courses.entries()], flagged };
  }, [parsed]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setResult(null);
    setError(null);
    setText(await file.text());
  }

  async function runImport() {
    if (!parsed?.ok) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await importNotes(parsed.notes));
      setText("");
    } catch (importError) {
      setError(errorMessage(importError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Import"
        subtitle="Karten-JSON aus der Pipeline. Importierte Notes landen als Entwurf in der Freigabe."
      />

      {result && (
        <div className="mb-6 rounded-xl bg-marker-soft p-4" role="status">
          <p className="font-semibold">
            {result.inserted} {result.inserted === 1 ? "Note" : "Notes"} importiert
            {result.duplicates > 0 ? `, ${result.duplicates} Duplikate übersprungen` : ""}.
          </p>
          {result.inserted > 0 && (
            <Link href="/review" className="btn btn-primary btn-sm mt-3">
              Jetzt sichten
            </Link>
          )}
        </div>
      )}

      <div className="space-y-5">
        <div>
          <label htmlFor="import-file" className="label">JSON-Datei</label>
          <input
            id="import-file"
            type="file"
            accept=".json,application/json"
            className="field"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </div>
        <div>
          <label htmlFor="import-text" className="label">… oder JSON einfügen</label>
          <textarea
            id="import-text"
            className="field font-mono !text-sm"
            rows={10}
            spellCheck={false}
            placeholder={EXAMPLE}
            value={text}
            onChange={(e) => {
              setResult(null);
              setText(e.target.value);
            }}
          />
        </div>

        {parsed && !parsed.ok && (
          <div role="alert" className="rounded-xl bg-warn-soft p-3 text-sm text-warn-text">
            <p className="font-semibold">
              {parsed.issues.length} {parsed.issues.length === 1 ? "Fehler" : "Fehler"} – nichts wird importiert
            </p>
            <ul className="mt-1 list-disc pl-5">
              {parsed.issues.slice(0, 30).map((issue, index) => (
                <li key={index}>
                  {issue.index >= 0 ? `Note ${issue.index + 1}` : "Datei"}
                  {issue.path ? ` · ${issue.path}` : ""}: {issue.message}
                </li>
              ))}
            </ul>
            {parsed.issues.length > 30 && <p className="mt-1">… und {parsed.issues.length - 30} weitere.</p>}
          </div>
        )}

        {parsed?.ok && summary && (
          <div className="text-sm" data-testid="import-summary">
            <p className="font-semibold text-good">{parsed.notes.length} gültige Notes</p>
            <ul className="mt-1 text-muted">
              {summary.courses.map(([name, count]) => (
                <li key={name}>
                  {name}: {count}
                </li>
              ))}
            </ul>
            {summary.flagged > 0 && (
              <p className="mt-1 text-warn-text">
                {summary.flagged} mit Hinweisen aus der Selbstprüfung – sie sind in der Freigabe markiert.
              </p>
            )}
          </div>
        )}

        {error && <p role="alert" className="text-sm text-again">{error}</p>}

        <button
          type="button"
          className="btn btn-primary"
          disabled={!parsed?.ok || busy}
          onClick={runImport}
        >
          {busy ? "Importiert …" : "Importieren"}
        </button>
      </div>
    </>
  );
}
