"use client";

import { useState, type FormEvent } from "react";
import type { CourseInput } from "@/lib/data";
import { errorMessage } from "@/lib/hooks";

export const EMPTY_COURSE: CourseInput = {
  name: "",
  semester: null,
  exam_date: null,
  exam_type: null,
  priority: 0,
};

export function CourseForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: CourseInput;
  submitLabel: string;
  onSubmit: (course: CourseInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [course, setCourse] = useState<CourseInput>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!course.name.trim()) {
      setError("Der Kurs braucht einen Namen.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ ...course, name: course.name.trim() });
    } catch (submitError) {
      const message = errorMessage(submitError);
      setError(message.includes("duplicate key") ? "Einen Kurs mit diesem Namen gibt es schon." : message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="course-name" className="label">Name</label>
        <input
          id="course-name"
          className="field"
          value={course.name}
          onChange={(e) => setCourse({ ...course, name: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="course-semester" className="label">Semester</label>
          <input
            id="course-semester"
            className="field"
            placeholder="WiSe 2026/27"
            value={course.semester ?? ""}
            onChange={(e) => setCourse({ ...course, semester: e.target.value || null })}
          />
        </div>
        <div>
          <label htmlFor="course-exam" className="label">Klausurdatum</label>
          <input
            id="course-exam"
            type="date"
            className="field"
            value={course.exam_date ?? ""}
            onChange={(e) => setCourse({ ...course, exam_date: e.target.value || null })}
          />
        </div>
        <div>
          <label htmlFor="course-type" className="label">Klausurart</label>
          <select
            id="course-type"
            className="field"
            value={course.exam_type ?? ""}
            onChange={(e) =>
              setCourse({ ...course, exam_type: (e.target.value || null) as CourseInput["exam_type"] })
            }
          >
            <option value="">–</option>
            <option value="geschlossen">geschlossen (ohne Unterlagen)</option>
            <option value="offen">offen (Open Book)</option>
          </select>
        </div>
        <div>
          <label htmlFor="course-priority" className="label">Priorität</label>
          <select
            id="course-priority"
            className="field"
            value={course.priority}
            onChange={(e) => setCourse({ ...course, priority: Number(e.target.value) })}
          >
            <option value={2}>hoch</option>
            <option value={1}>erhöht</option>
            <option value={0}>normal</option>
            <option value={-1}>niedrig</option>
          </select>
        </div>
      </div>
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
