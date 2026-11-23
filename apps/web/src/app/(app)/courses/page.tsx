"use client";

import Link from "next/link";
import { useState } from "react";
import { CourseForm, EMPTY_COURSE } from "@/components/course-form";
import { EmptyState, ErrorNote, Icon, Loading, PageHeader, formatDate } from "@/components/ui";
import { fetchCourseOverview, saveCourse } from "@/lib/data";
import { useQuery } from "@/lib/hooks";

export default function CoursesPage() {
  const { data, error, loading, reload } = useQuery(() => fetchCourseOverview());
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Kurse"
        action={
          !creating && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
              <Icon name="plus" size={16} />
              Neuer Kurs
            </button>
          )
        }
      />

      {creating && (
        <div className="sheet mb-8 p-5">
          <CourseForm
            initial={EMPTY_COURSE}
            submitLabel="Kurs anlegen"
            onCancel={() => setCreating(false)}
            onSubmit={async (course) => {
              await saveCourse(course);
              setCreating(false);
              reload();
            }}
          />
        </div>
      )}

      {loading && <Loading />}
      {error && <ErrorNote message={error} onRetry={reload} />}
      {data && data.length === 0 && !creating && (
        <EmptyState title="Noch keine Kurse">
          Ein Kurs ist dein Stapel für eine Klausur. Mit Klausurdatum und Priorität bestimmst du, was
          in der Lernsession zuerst kommt. Beim Import von Karten entstehen Kurse automatisch.
        </EmptyState>
      )}
      {data && data.length > 0 && (
        <ul className="rows border-y border-border">
          {data.map((course) => (
            <li key={course.id}>
              <Link href={`/course?id=${course.id}`} className="-mx-2 block rounded-lg px-2 py-3.5 transition-colors duration-150 hover:bg-surface-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-semibold">{course.name}</span>
                  <span className="shrink-0 text-sm text-muted">{course.semester ?? ""}</span>
                </div>
                <p className="mt-0.5 text-sm text-muted">
                  {course.note_count} Notes · {course.card_count} Karten · {course.draft_count} Entwürfe ·
                  Klausur {formatDate(course.exam_date)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
