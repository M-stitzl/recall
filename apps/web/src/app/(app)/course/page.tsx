"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CourseForm } from "@/components/course-form";
import { EMPTY_NOTE, NoteForm } from "@/components/note-form";
import { Badge, EmptyState, ErrorNote, Loading, PageHeader, formatDate } from "@/components/ui";
import {
  createNote,
  deleteCourse,
  deleteNote,
  fetchCourseNotes,
  fetchCourses,
  saveCourse,
  updateNote,
} from "@/lib/data";
import { errorMessage, useQuery } from "@/lib/hooks";
import { plainPreview } from "@/lib/render";
import type { Note, NoteFormat, NoteStatus } from "@/lib/types";

const STATUS_LABEL: Record<NoteStatus, string> = {
  approved: "Aktiv",
  draft: "Entwurf",
  rejected: "Verworfen",
  suspended: "Pausiert",
};

const FORMAT_LABEL: Record<NoteFormat, string> = {
  warum: "Warum/Wie",
  cloze: "Cloze",
  anwendung: "Anwendung",
  bild: "Bild",
};

const FILTERS: (NoteStatus | "all")[] = ["all", "approved", "draft", "suspended", "rejected"];

type Panel = { kind: "none" } | { kind: "new" } | { kind: "course" } | { kind: "edit"; note: Note };

function CourseDetail() {
  const router = useRouter();
  const courseId = useSearchParams().get("id") ?? "";
  const { data, error, loading, reload } = useQuery(async () => {
    const [courses, notes] = await Promise.all([fetchCourses(), fetchCourseNotes(courseId)]);
    return { course: courses.find((c) => c.id === courseId) ?? null, notes };
  }, courseId);
  const [panel, setPanel] = useState<Panel>({ kind: "none" });
  const [filter, setFilter] = useState<NoteStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Unbekannter Fehler"} onRetry={reload} />;
  if (!data.course) {
    return (
      <EmptyState title="Kurs nicht gefunden">
        <Link href="/courses" className="link">
          Zur Kursliste
        </Link>
      </EmptyState>
    );
  }

  const { course, notes } = data;
  const needle = search.trim().toLowerCase();
  const visible = notes.filter(
    (note) =>
      (filter === "all" || note.status === filter) &&
      (!needle ||
        `${note.front} ${note.back} ${note.tags.join(" ")}`.toLowerCase().includes(needle)),
  );

  async function act(action: () => Promise<void>) {
    setActionError(null);
    try {
      await action();
      reload();
    } catch (runError) {
      setActionError(errorMessage(runError));
    }
  }

  return (
    <>
      <PageHeader
        title={course.name}
        subtitle={`${course.semester ?? "Kein Semester"} · Klausur ${formatDate(course.exam_date)}`}
        action={
          <div className="flex gap-2">
            <button type="button" className="btn btn-sm" onClick={() => setPanel({ kind: "course" })}>
              Bearbeiten
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setPanel({ kind: "new" })}
            >
              Neue Karte
            </button>
          </div>
        }
      />

      {panel.kind === "course" && (
        <div className="sheet mb-8 p-5">
          <CourseForm
            initial={{
              name: course.name,
              semester: course.semester,
              exam_date: course.exam_date,
              exam_type: course.exam_type,
              priority: course.priority,
            }}
            submitLabel="Speichern"
            onCancel={() => setPanel({ kind: "none" })}
            onSubmit={async (input) => {
              await saveCourse(input, course.id);
              setPanel({ kind: "none" });
              reload();
            }}
          />
          <hr className="my-5 border-border" />
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => {
              const ok = window.confirm(
                `Kurs „${course.name}“ mit allen ${notes.length} Notes und Karten endgültig löschen? Das lässt sich nicht rückgängig machen.`,
              );
              if (ok) {
                void act(async () => {
                  await deleteCourse(course.id);
                  router.replace("/courses");
                });
              }
            }}
          >
            Kurs löschen
          </button>
        </div>
      )}

      {panel.kind === "new" && (
        <div className="sheet mb-8 p-5">
          <NoteForm
            initial={EMPTY_NOTE}
            submitLabel="Karte anlegen"
            onCancel={() => setPanel({ kind: "none" })}
            onSubmit={async (content) => {
              await createNote(course.id, content);
              setPanel({ kind: "none" });
              reload();
            }}
          />
        </div>
      )}

      {panel.kind === "edit" && (
        <div className="sheet mb-8 p-5">
          <NoteForm
            key={panel.note.id}
            initial={{
              type: panel.note.type,
              front: panel.note.front,
              back: panel.note.back,
              extra: panel.note.extra,
              source_ref: panel.note.source_ref,
              tags: panel.note.tags,
              priority: panel.note.priority,
              relevance: panel.note.relevance,
            }}
            submitLabel="Speichern"
            onCancel={() => setPanel({ kind: "none" })}
            onSubmit={async (content) => {
              await updateNote(panel.note.id, content);
              setPanel({ kind: "none" });
              reload();
            }}
          />
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="field max-w-xs"
          type="search"
          placeholder="Suchen …"
          aria-label="Karten durchsuchen"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="field max-w-[11rem]"
          aria-label="Nach Status filtern"
          value={filter}
          onChange={(e) => setFilter(e.target.value as NoteStatus | "all")}
        >
          {FILTERS.map((value) => (
            <option key={value} value={value}>
              {value === "all" ? "Alle" : STATUS_LABEL[value]} (
              {value === "all" ? notes.length : notes.filter((n) => n.status === value).length})
            </option>
          ))}
        </select>
      </div>

      {actionError && <p role="alert" className="mb-3 text-sm text-again">{actionError}</p>}

      {visible.length === 0 ? (
        <EmptyState title={notes.length === 0 ? "Noch keine Karten" : "Keine Treffer"}>
          {notes.length === 0
            ? "Schreibe mit „Neue Karte“ eine eigene Karte – sie ist sofort aktiv. KI-Karten aus der Pipeline erscheinen hier, sobald du sie importiert hast."
            : "Kein Eintrag passt zu Suche und Filter."}
        </EmptyState>
      ) : (
        <ul className="rows border-y border-border">
          {visible.map((note) => (
            <li key={note.id} className="py-4">
              <p className="max-w-prose">{plainPreview(note.front, 220)}</p>
              {note.back.trim() && (
                <p className="mt-1 text-sm text-muted">{plainPreview(note.back, 160)}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone={note.status === "draft" ? "warn" : "neutral"}>
                  {STATUS_LABEL[note.status]}
                </Badge>
                <Badge>{note.format ? FORMAT_LABEL[note.format] : note.type === "cloze" ? "Cloze" : "Basic"}</Badge>
                {note.source_ref && <span className="text-xs text-muted">{note.source_ref}</span>}
                {note.status === "rejected" && note.reject_reason && (
                  <span className="text-xs text-muted">Grund: {note.reject_reason}</span>
                )}
                <span className="ml-auto flex gap-1">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setPanel({ kind: "edit", note });
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    Bearbeiten
                  </button>
                  {note.status === "approved" && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => act(() => updateNote(note.id, { status: "suspended" }))}
                    >
                      Pausieren
                    </button>
                  )}
                  {note.status === "suspended" && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => act(() => updateNote(note.id, { status: "approved" }))}
                    >
                      Fortsetzen
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => {
                      if (window.confirm("Diese Karte samt Lernstand endgültig löschen?")) {
                        void act(() => deleteNote(note.id));
                      }
                    }}
                  >
                    Löschen
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function CoursePage() {
  return (
    <Suspense fallback={<Loading />}>
      <CourseDetail />
    </Suspense>
  );
}
