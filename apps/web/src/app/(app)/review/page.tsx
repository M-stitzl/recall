"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useEffectEvent } from "react";
import { CardText } from "@/components/card-text";
import { NoteForm } from "@/components/note-form";
import { SlideImage } from "@/components/slide-image";
import { SourceViewer } from "@/components/source-viewer";
import { Badge, EmptyState, ErrorNote, Loading, PageHeader } from "@/components/ui";
import { approveAllDrafts, fetchDrafts, updateNote, type NoteContent } from "@/lib/data";
import { errorMessage, useQuery } from "@/lib/hooks";
import type { NoteFormat, NoteWithContext } from "@/lib/types";
import { clozeOrdinals } from "@recall/schema";

/** Häufige Ablehnungsgründe – sie fließen als Feedback in den Generierungs-Prompt zurück. */
const REJECT_REASONS = [
  "Inhaltlich falsch oder nicht in der Quelle",
  "Zu trivial / nicht prüfungsrelevant",
  "Mehr als eine Idee pro Karte",
  "Unklar oder mehrdeutig formuliert",
  "Doppelt / schon abgedeckt",
] as const;

type Mode = "view" | "edit" | "reject";

const FORMAT_LABEL: Record<NoteFormat, string> = {
  warum: "Warum/Wie",
  cloze: "Cloze",
  anwendung: "Anwendung",
  bild: "Bild",
};

export default function ReviewPage() {
  const { data, error, loading, reload } = useQuery(fetchDrafts);
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>("view");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [stats, setStats] = useState({ approved: 0, rejected: 0 });
  const [confirmAll, setConfirmAll] = useState(false);
  const reasonInput = useRef<HTMLInputElement>(null);

  const remaining = (data ?? []).filter((note) => !handled.has(note.id));
  const note: NoteWithContext | undefined = remaining[0];

  const finish = useCallback((id: string, kind: "approved" | "rejected") => {
    setHandled((previous) => new Set(previous).add(id));
    setStats((previous) => ({ ...previous, [kind]: previous[kind] + 1 }));
    setMode("view");
    setReason("");
  }, []);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (runError) {
      setActionError(errorMessage(runError));
    } finally {
      setBusy(false);
    }
  }, []);

  // Einfache Funktionen: Der React Compiler übernimmt die Memoisierung.
  const approve = () => {
    if (!note || busy) return;
    void run(async () => {
      await updateNote(note.id, { status: "approved" });
      finish(note.id, "approved");
    });
  };

  const approveAll = () => {
    if (busy) return;
    void run(async () => {
      const count = await approveAllDrafts();
      setHandled(new Set((data ?? []).map((item) => item.id)));
      setStats((previous) => ({ ...previous, approved: previous.approved + count }));
      setConfirmAll(false);
      setMode("view");
    });
  };

  const reject = (text: string) => {
      if (!note || busy) return;
      const cleaned = text.trim();
      if (!cleaned) {
        setActionError("Bitte gib einen Grund an – er verbessert die nächsten Karten.");
        return;
      }
      void run(async () => {
        await updateNote(note.id, { status: "rejected", reject_reason: cleaned });
        finish(note.id, "rejected");
      });
  };

  const saveAndApprove = async (content: NoteContent) => {
    if (!note) return;
    await updateNote(note.id, { ...content, status: "approved" });
    finish(note.id, "approved");
  };

  useEffect(() => {
    if (mode === "reject") reasonInput.current?.focus();
  }, [mode]);

  // Effect-Event: sieht immer den aktuellen Stand, ohne den Listener neu zu registrieren.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || !note) return;
      const target = event.target as HTMLElement | null;
      const typing = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);

      if (mode === "reject") {
        if (event.key === "Escape") {
          setMode("view");
          setActionError(null);
        } else if (!typing || (target as HTMLInputElement).value === "") {
          const index = Number(event.key) - 1;
          if (index >= 0 && index < REJECT_REASONS.length) {
            event.preventDefault();
            reject(REJECT_REASONS[index]);
          }
        }
        return;
      }
      // Während der Rückfrage „Alle annehmen“ keine Einzel-Kürzel auslösen.
      if (mode !== "view" || typing || confirmAll) return;

      const key = event.key.toLowerCase();
      if (key === "a") {
        event.preventDefault();
        approve();
      } else if (key === "e") {
        event.preventDefault();
        setMode("edit");
      } else if (key === "r") {
        event.preventDefault();
        setActionError(null);
        setMode("reject");
      }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Unbekannter Fehler"} onRetry={reload} />;

  const doneCount = stats.approved + stats.rejected;

  if (!note) {
    return (
      <>
        <PageHeader title="Freigabe" />
        <EmptyState title={doneCount > 0 ? "Alles gesichtet" : "Keine Entwürfe"}>
          {doneCount === 0 && (
            <p className="mb-2">
              Hier prüfst du jede KI-Karte, bevor sie in deinen Stapel kommt: annehmen, bearbeiten oder
              mit Grund verwerfen. Erst angenommene Notes erzeugen Karten.
            </p>
          )}
          {doneCount > 0 ? (
            <p>
              {stats.approved} angenommen · {stats.rejected} verworfen.
            </p>
          ) : (
            <p>
              Neue KI-Karten kommen über den{" "}
              <Link href="/import" className="link">
                Import
              </Link>
              .
            </p>
          )}
          {data.length >= 200 && doneCount > 0 && (
            <button type="button" className="btn mt-4" onClick={() => { setHandled(new Set()); reload(); }}>
              Weitere laden
            </button>
          )}
        </EmptyState>
      </>
    );
  }

  const isCloze = note.type === "cloze";
  const ordinals = isCloze ? clozeOrdinals(note.front) : [];
  const source = [note.sources?.file_path, note.source_ref].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader
        title="Freigabe"
        subtitle={`${remaining.length}${(data?.length ?? 0) >= 200 ? "+" : ""} offen · ${stats.approved} angenommen · ${stats.rejected} verworfen`}
        action={
          !confirmAll && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => {
                setActionError(null);
                setConfirmAll(true);
              }}
            >
              Alle annehmen
            </button>
          )
        }
      />

      {confirmAll && (
        <div className="mb-4 rounded-xl bg-marker-soft p-4" role="alertdialog" aria-label="Alle annehmen bestätigen">
          <p className="font-semibold">
            Alle {remaining.length}
            {(data?.length ?? 0) >= 200 ? "+" : ""} offenen Entwürfe annehmen?
          </p>
          <p className="mt-1 text-sm">
            Daraus entstehen sofort Lernkarten.
            {remaining.some((item) => item.ai_flags.length > 0) &&
              ` ${remaining.filter((item) => item.ai_flags.length > 0).length} davon haben einen Hinweis aus der Selbstprüfung.`}{" "}
            Einzelne Karten kannst du später unter „Kurse“ bearbeiten, pausieren oder löschen.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={approveAll}>
              {busy ? "Nimmt an …" : "Ja, alle annehmen"}
            </button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirmAll(false)}>
              Abbrechen
            </button>
          </div>
        </div>
      )}

      <article className="sheet p-5 md:p-8" data-testid="draft-note">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="font-medium text-foreground">{note.courses?.name}</span>
          <Badge>
            {note.format
              ? FORMAT_LABEL[note.format]
              : isCloze
                ? `Cloze · ${ordinals.length} ${ordinals.length === 1 ? "Karte" : "Karten"}`
                : "Basic"}
          </Badge>
          <Badge tone={note.priority}>Priorität {note.priority}</Badge>
          {note.tags.map((tag) => (
            <Badge key={tag}>#{tag}</Badge>
          ))}
        </div>

        {note.ai_flags.length > 0 && (
          <div className="mb-4 rounded-xl bg-warn-soft p-3 text-sm text-warn-text" role="note">
            <p className="font-semibold">Hinweise aus der Selbstprüfung</p>
            <ul className="mt-1 list-disc pl-5">
              {note.ai_flags.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          </div>
        )}

        {mode === "edit" ? (
          <NoteForm
            key={note.id}
            initial={{
              type: note.type,
              front: note.front,
              back: note.back,
              extra: note.extra,
              source_ref: note.source_ref,
              tags: note.tags,
              priority: note.priority,
              relevance: note.relevance,
            }}
            submitLabel="Speichern und annehmen"
            onSubmit={saveAndApprove}
            onCancel={() => setMode("view")}
          />
        ) : (
          <>
            {note.format === "bild" && note.image_path && note.occlusion && (
              <div className="mb-5">
                <SlideImage
                  path={note.image_path}
                  occlusion={note.occlusion}
                  hidden={false}
                  alt={`Folie aus ${note.sources?.file_path ?? note.courses?.name ?? "dem Kurs"}`}
                />
              </div>
            )}
            <CardText text={note.front} highlightAll={isCloze} />
            {note.back.trim() && (
              <>
                <hr className="my-4 border-border" />
                <CardText text={note.back} />
              </>
            )}
            {note.extra.trim() && (
              <CardText text={note.extra} className="mt-4 !text-base text-muted" />
            )}
            {note.relevance && (
              <p className="mt-5 text-sm">
                <span className="font-semibold">Warum relevant: </span>
                <span className="text-muted">{note.relevance}</span>
              </p>
            )}
            {source ? (
              <SourceViewer key={note.id} view={note.source_view} reference={`Quelle: ${source}`} />
            ) : (
              <p className="mt-5 text-xs font-medium text-again">Keine Quelle angegeben</p>
            )}
          </>
        )}
      </article>

      {mode === "reject" && (
        <div className="sheet mt-3 p-4">
          <p className="label">Warum verwerfen?</p>
          <div className="flex flex-col gap-2">
            {REJECT_REASONS.map((text, index) => (
              <button
                key={text}
                type="button"
                className="btn btn-sm justify-start text-left"
                disabled={busy}
                onClick={() => reject(text)}
              >
                <kbd>{index + 1}</kbd> {text}
              </button>
            ))}
          </div>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              reject(reason);
            }}
          >
            <input
              ref={reasonInput}
              className="field"
              placeholder="Eigener Grund …"
              aria-label="Eigener Ablehnungsgrund"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button type="submit" className="btn btn-danger" disabled={busy}>
              Verwerfen
            </button>
          </form>
          <button type="button" className="btn btn-sm mt-2" onClick={() => setMode("view")}>
            Abbrechen <kbd>Esc</kbd>
          </button>
        </div>
      )}

      {actionError && (
        <p role="alert" className="mt-3 text-sm text-again">
          {actionError}
        </p>
      )}

      {mode === "view" && (
        <div className="sticky bottom-20 mt-4 grid grid-cols-3 gap-2 md:bottom-4">
          <button type="button" className="btn btn-primary h-14" disabled={busy} onClick={approve}>
            Annehmen <kbd className="max-md:hidden">A</kbd>
          </button>
          <button type="button" className="btn h-14" disabled={busy} onClick={() => setMode("edit")}>
            Bearbeiten <kbd className="max-md:hidden">E</kbd>
          </button>
          <button
            type="button"
            className="btn btn-danger h-14"
            disabled={busy}
            onClick={() => {
              setActionError(null);
              setMode("reject");
            }}
          >
            Verwerfen <kbd className="max-md:hidden">R</kbd>
          </button>
        </div>
      )}
    </>
  );
}
