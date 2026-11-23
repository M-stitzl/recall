"use client";

import Link from "next/link";
import { StackLegend, StackStrip } from "@/components/stack-strip";
import { EmptyState, ErrorNote, Icon, Loading, PageHeader, SectionTitle, daysUntil } from "@/components/ui";
import { fetchCourseOverview, fetchSettings } from "@/lib/data";
import { useQuery } from "@/lib/hooks";
import { startOfLocalDay, type QueueCounts } from "@/lib/queue";
import { getSupabase } from "@/lib/supabase";
import type { CourseOverview } from "@/lib/types";

async function loadDashboard() {
  const now = new Date();
  const [courses, settings, newToday] = await Promise.all([
    fetchCourseOverview(now),
    fetchSettings(),
    getSupabase()
      .from("review_logs")
      .select("id", { count: "exact", head: true })
      .eq("state", 0)
      .gte("reviewed_at", startOfLocalDay(now).toISOString()),
  ]);
  return { courses, settings, newDoneToday: newToday.count ?? 0 };
}

function examLabel(examDate: string | null): string | null {
  const days = daysUntil(examDate);
  if (days === null) return null;
  if (days < 0) return "Klausur vorbei";
  if (days === 0) return "Klausur heute";
  if (days === 1) return "Klausur morgen";
  return `Klausur in ${days} Tagen`;
}

/** Was heute in einem Kurs ansteht; neue Karten höchstens bis zum Tageslimit. */
function courseCounts(course: CourseOverview, newBudget: number): QueueCounts {
  return {
    learning: course.learning_count,
    review: course.due_count - course.learning_count,
    fresh: Math.min(course.new_count, newBudget),
  };
}

export default function DashboardPage() {
  const { data, error, loading, reload } = useQuery(loadDashboard);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Unbekannter Fehler"} onRetry={reload} />;

  const { courses, settings, newDoneToday } = data;
  const newBudget = Math.max(0, settings.new_per_day - newDoneToday);
  const newAvailable = courses.reduce((sum, c) => sum + c.new_count, 0);
  const today: QueueCounts = {
    learning: courses.reduce((sum, c) => sum + c.learning_count, 0),
    review: courses.reduce((sum, c) => sum + c.due_count - c.learning_count, 0),
    fresh: Math.min(newAvailable, newBudget),
  };
  const total = today.learning + today.review + today.fresh;
  const drafts = courses.reduce((sum, c) => sum + c.draft_count, 0);
  const hasCards = courses.some((c) => c.card_count > 0);

  return (
    <>
      <PageHeader
        title="Heute"
        subtitle={new Date().toLocaleDateString("de-DE", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
      />

      <section aria-label="Heutiger Stapel">
        <StackStrip counts={today} size="lg" />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          {total > 0 ? (
            <>
              <div>
                <p className="text-lg font-semibold" data-testid="due-total">
                  {total} {total === 1 ? "Karte" : "Karten"}
                </p>
                <StackLegend counts={today} className="mt-1" />
              </div>
              <Link href="/study" className="btn btn-primary min-h-12 px-6 max-sm:w-full">
                Lernen beginnen
              </Link>
            </>
          ) : (
            <p className="text-lg font-semibold">
              {hasCards ? "Für heute erledigt." : "Noch kein Stapel."}
              <span className="ml-2 font-normal text-muted">
                {hasCards
                  ? newAvailable > 0
                    ? "Das Tageslimit für neue Karten ist erreicht."
                    : "Die nächsten Wiederholungen stehen in der Statistik."
                  : "Karten entstehen, sobald du Notes freigibst oder selbst anlegst."}
              </span>
            </p>
          )}
        </div>
      </section>

      {drafts > 0 && (
        <Link
          href="/review"
          className="mt-6 flex items-center justify-between gap-3 rounded-xl bg-marker-soft px-4 py-3 text-sm transition-colors duration-150 hover:bg-marker"
        >
          <span>
            <span className="font-semibold">{drafts}</span> {drafts === 1 ? "KI-Karte wartet" : "KI-Karten warten"}{" "}
            auf deine Freigabe
          </span>
          <span className="flex items-center gap-1 font-semibold">
            Sichten <Icon name="forward" size={16} />
          </span>
        </Link>
      )}

      <SectionTitle>Kurse</SectionTitle>
      {courses.length === 0 ? (
        <EmptyState title="Noch keine Kurse">
          Ein Kurs ist dein Stapel für eine Klausur.{" "}
          <Link href="/courses" className="link">
            Lege einen Kurs an
          </Link>{" "}
          und schreibe eigene Karten, oder{" "}
          <Link href="/import" className="link">
            importiere Karten
          </Link>{" "}
          aus der Pipeline – Kurse entstehen dabei automatisch.
        </EmptyState>
      ) : (
        <ul className="rows border-y border-border">
          {courses.map((course) => {
            const exam = examLabel(course.exam_date);
            const counts = courseCounts(course, newBudget);
            const open = counts.learning + counts.review + counts.fresh;
            return (
              <li key={course.id} className="flex items-center gap-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <Link href={`/course?id=${course.id}`} className="block truncate font-semibold hover:underline">
                    {course.name}
                  </Link>
                  <p className="mt-0.5 truncate text-sm text-muted">
                    {open > 0 ? `${open} heute` : "nichts fällig"} · {course.card_count} Karten
                    {exam ? ` · ${exam}` : ""}
                  </p>
                  {open > 0 && <StackStrip counts={counts} size="sm" className="mt-2 max-w-64" />}
                </div>
                {open > 0 && (
                  <Link href={`/study?course=${course.id}`} className="btn btn-sm">
                    Lernen
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
