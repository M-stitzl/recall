"use client";

import { useState, type FormEvent } from "react";
import { clozeOrdinals } from "@recall/schema";
import type { NoteContent } from "@/lib/data";
import { CardText } from "./card-text";

export const EMPTY_NOTE: NoteContent = {
  type: "basic",
  front: "",
  back: "",
  extra: "",
  source_ref: "",
  tags: [],
  priority: "mittel",
  relevance: "",
};

function validate(note: NoteContent): string | null {
  if (!note.front.trim()) return "Die Vorderseite darf nicht leer sein.";
  if (note.type === "cloze" && clozeOrdinals(note.front).length === 0) {
    return "Eine Cloze-Karte braucht mindestens eine Lücke, z. B. {{c1::Antwort}}.";
  }
  if (note.type === "basic" && !note.back.trim()) return "Die Rückseite darf nicht leer sein.";
  return null;
}

type Props = {
  initial: NoteContent;
  submitLabel: string;
  onSubmit: (note: NoteContent) => Promise<void>;
  onCancel?: () => void;
};

export function NoteForm({ initial, submitLabel, onSubmit, onCancel }: Props) {
  const [note, setNote] = useState<NoteContent>(initial);
  const [tagText, setTagText] = useState(initial.tags.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(change: Partial<NoteContent>) {
    setNote((previous) => ({ ...previous, ...change }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result: NoteContent = {
      ...note,
      front: note.front.trim(),
      tags: tagText
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
    const problem = validate(result);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(result);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : String(submitError);
      setError(
        message.includes("duplicate key")
          ? "Diese Karte gibt es in dem Kurs bereits."
          : message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4"
      onKeyDown={(event) => {
        if (event.key === "Escape" && onCancel) {
          event.preventDefault();
          onCancel();
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.currentTarget.requestSubmit();
        }
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="note-type" className="label">Typ</label>
          <select
            id="note-type"
            className="field"
            value={note.type}
            onChange={(e) => patch({ type: e.target.value as NoteContent["type"] })}
          >
            <option value="basic">Basic (Frage / Antwort)</option>
            <option value="cloze">Cloze (Lückentext)</option>
          </select>
        </div>
        <div>
          <label htmlFor="note-priority" className="label">Priorität</label>
          <select
            id="note-priority"
            className="field"
            value={note.priority}
            onChange={(e) => patch({ priority: e.target.value as NoteContent["priority"] })}
          >
            <option value="hoch">hoch</option>
            <option value="mittel">mittel</option>
            <option value="niedrig">niedrig</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="note-front" className="label">
          {note.type === "cloze" ? "Text mit Lücken – {{c1::Antwort}}" : "Vorderseite"}
        </label>
        <textarea
          id="note-front"
          className="field"
          rows={4}
          autoFocus
          value={note.front}
          onChange={(e) => patch({ front: e.target.value })}
        />
      </div>

      <div>
        <label htmlFor="note-back" className="label">
          {note.type === "cloze" ? "Rückseite (optional)" : "Rückseite"}
        </label>
        <textarea
          id="note-back"
          className="field"
          rows={3}
          value={note.back}
          onChange={(e) => patch({ back: e.target.value })}
        />
      </div>

      <div>
        <label htmlFor="note-extra" className="label">Zusatz (optional)</label>
        <textarea
          id="note-extra"
          className="field"
          rows={2}
          value={note.extra}
          onChange={(e) => patch({ extra: e.target.value })}
        />
      </div>

      <div>
        <label htmlFor="note-relevance" className="label">Warum prüfungsrelevant? (optional, 1 Satz)</label>
        <input
          id="note-relevance"
          className="field"
          value={note.relevance}
          onChange={(e) => patch({ relevance: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="note-source" className="label">Quelle (z. B. Folie 12)</label>
          <input
            id="note-source"
            className="field"
            value={note.source_ref}
            onChange={(e) => patch({ source_ref: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="note-tags" className="label">Tags (mit Komma)</label>
          <input
            id="note-tags"
            className="field"
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
          />
        </div>
      </div>

      {note.front.trim() && (
        <div className="rounded-xl border border-dashed border-border p-4">
          <p className="label">Vorschau</p>
          <CardText text={note.front} highlightAll={note.type === "cloze"} />
          {note.back.trim() && (
            <>
              <hr className="my-3 border-border" />
              <CardText text={note.back} />
            </>
          )}
        </div>
      )}

      <p className="text-xs text-muted">
        Formeln mit <code>$…$</code> oder <code>$$…$$</code> (LaTeX). Speichern mit <kbd>Strg</kbd>+
        <kbd>Enter</kbd>.
      </p>

      {error && <p role="alert" className="text-sm text-again">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Speichert …" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Abbrechen
          </button>
        )}
      </div>
    </form>
  );
}
