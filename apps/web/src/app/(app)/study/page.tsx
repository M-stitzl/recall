"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { CardText } from "@/components/card-text";
import { SlideImage, prefetchSlide } from "@/components/slide-image";
import { SourceViewer } from "@/components/source-viewer";
import { StackStrip } from "@/components/stack-strip";
import { ErrorNote, Icon, Loading } from "@/components/ui";
import { fetchStudyData } from "@/lib/data";
import {
  GRADES,
  GRADE_LABELS,
  createScheduler,
  formatInterval,
  previewCard,
  rateCard,
  type CardSchedule,
  type Scheduler,
} from "@/lib/fsrs";
import { errorMessage } from "@/lib/hooks";
import { enqueueReview, flushOutbox, pendingReviews } from "@/lib/outbox";
import { buildQueue, countQueue, pickNext, requeue } from "@/lib/queue";
import { getSupabase } from "@/lib/supabase";
import type { Grade, StudyCard } from "@/lib/types";

/** Jede Bewertung trägt ihre Zustandsfarbe: als Schriftfarbe und als leichte Tönung der Fläche. */
const GRADE_STYLE: Record<Grade, string> = {
  1: "text-again !bg-[color-mix(in_srgb,var(--again)_9%,var(--surface))]",
  2: "text-hard !bg-[color-mix(in_srgb,var(--hard)_9%,var(--surface))]",
  3: "text-good !bg-[color-mix(in_srgb,var(--good)_9%,var(--surface))]",
  4: "text-easy !bg-[color-mix(in_srgb,var(--easy)_9%,var(--surface))]",
};

/** Antwortzeiten über einer Minute zählen als Pause, nicht als Lernzeit. */
const MAX_DURATION_MS = 60_000;

const OFFLINE_MESSAGE =
  "Du bist offline. Eine neue Session braucht eine Verbindung – bereits abgegebene Bewertungen sind auf diesem Gerät gespeichert und werden nachgesendet.";

type Session = {
  scheduler: Scheduler;
  queue: StudyCard[];
  current: StudyCard | null;
  done: number;
};

function StudySession() {
  const courseId = useSearchParams().get("course");
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Gesetzt, sobald die Antwort sichtbar ist: Zeitpunkt und die vier möglichen Folgezustände.
  const [answer, setAnswer] = useState<{ at: Date; preview: Record<Grade, CardSchedule> } | null>(
    null,
  );
  const revealed = answer !== null;
  const [pending, setPending] = useState(0);
  const shownAt = useRef(0);

  const load = useCallback(async () => {
    setError(null);
    setSession(null);
    // Ohne Netz gar nicht erst auf Zeitüberschreitungen warten.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setPending(pendingReviews().length);
      setError(OFFLINE_MESSAGE);
      return;
    }
    try {
      const supabase = getSupabase();
      // Erst offene Bewertungen sichern, sonst lädt die Queue veraltete Kartenstände.
      setPending(await flushOutbox(supabase).catch(() => pendingReviews().length));
      const now = new Date();
      const data = await fetchStudyData(courseId, now);
      const scheduler = await createScheduler(data.settings);
      const queue = buildQueue(
        data.cards,
        {
          newPerDay: data.settings.new_per_day,
          maxReviewsPerDay: data.settings.max_reviews_per_day,
          newDoneToday: data.newDoneToday,
          reviewsDoneToday: data.reviewsDoneToday,
        },
        now,
      );
      shownAt.current = performance.now();
      setAnswer(null);
      setSession({ scheduler, queue, current: pickNext(queue, now), done: 0 });
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [courseId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- einmaliges Laden beim Öffnen der Session
    void load();
  }, [load]);

  const reveal = useCallback(() => {
    if (!session?.current) return;
    const at = new Date();
    setAnswer({ at, preview: previewCard(session.scheduler, session.current, at) });
  }, [session]);

  const grade = useCallback(
    (rating: Grade) => {
      if (!session?.current || !revealed) return;
      const now = new Date();
      const card = session.current;
      const next = rateCard(session.scheduler, card, rating, now);

      enqueueReview({
        logId: crypto.randomUUID(),
        cardId: card.id,
        rating,
        reviewedAt: now.toISOString(),
        durationMs: Math.min(MAX_DURATION_MS, performance.now() - shownAt.current),
        next,
      });
      setPending(pendingReviews().length);
      void flushOutbox(getSupabase())
        .then(setPending)
        .catch(() => setPending(pendingReviews().length));

      const updated: StudyCard = { ...card, ...next };
      const queue = requeue(session.queue, updated, now);
      // Folienbilder der nächsten Karten schon anfordern, damit sie ohne Wartezeit erscheinen.
      queue.slice(0, 3).forEach((item) => prefetchSlide(item.image_path));
      shownAt.current = performance.now();
      setAnswer(null);
      setSession({
        scheduler: session.scheduler,
        queue,
        current: pickNext(queue, now),
        done: session.done + 1,
      });
    },
    [session, revealed],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (!revealed && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        reveal();
      } else if (revealed && ["1", "2", "3", "4"].includes(event.key)) {
        event.preventDefault();
        grade(Number(event.key) as Grade);
      } else if (revealed && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        grade(3);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, reveal, grade]);

  if (error) return <ErrorNote message={error} onRetry={load} />;
  if (!session) return <Loading rows={3} label="Session wird vorbereitet" />;

  const { current, queue, done } = session;
  const counts = countQueue(queue);

  if (!current) {
    return (
      <div className="flex min-h-[70dvh] flex-col justify-center">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">
          {done > 0 ? "Stapel geschafft." : "Nichts mehr fällig."}
        </h1>
        <p className="mt-2 text-muted">
          {done > 0
            ? `${done} ${done === 1 ? "Bewertung" : "Bewertungen"} in dieser Session.`
            : "Für heute ist alles gelernt."}
        </p>
        {pending > 0 && (
          <p className="mt-4 text-sm font-medium text-hard" role="status">
            {pending} {pending === 1 ? "Bewertung wartet" : "Bewertungen warten"} noch auf die
            Synchronisierung. Sie {pending === 1 ? "bleibt" : "bleiben"} auf diesem Gerät gespeichert.
          </p>
        )}
        <div className="mt-8">
          <Link href="/" className="btn btn-primary">
            Zur Übersicht
          </Link>
        </div>
      </div>
    );
  }

  const isCloze = current.type === "cloze";
  const source = [current.source_file, current.source_ref].filter(Boolean).join(" · ");

  return (
    <div className="flex min-h-[calc(100dvh-2.25rem)] flex-col">
      <header className="flex items-center gap-2">
        <Link href="/" className="btn btn-icon -ml-2.5" aria-label="Session beenden">
          <Icon name="back" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{current.course_name}</p>
          <StackStrip counts={counts} size="sm" className="mt-1.5" />
        </div>
        <p className="shrink-0 pl-2 text-sm text-muted">
          noch {queue.length}
        </p>
      </header>

      <article
        className="sheet mt-4 flex flex-1 flex-col justify-center px-5 py-8 md:px-10"
        data-testid="study-card"
      >
        {current.format === "bild" && current.image_path && current.occlusion && (
          <div className="mb-5">
            <SlideImage
              path={current.image_path}
              occlusion={current.occlusion}
              hidden={!revealed}
              alt={`Folie aus ${current.source_file ?? current.course_name}`}
            />
          </div>
        )}
        <CardText
          text={current.front}
          clozeOrdinal={isCloze ? current.ordinal : undefined}
          revealed={revealed}
        />
        {revealed && (
          <div data-testid="answer" className="reveal">
            {current.back.trim() && (
              <>
                <hr className="my-6 border-border" />
                <CardText text={current.back} />
              </>
            )}
            {current.extra.trim() && (
              <CardText text={current.extra} className="mt-5 !text-[1.0625rem] text-muted" />
            )}
            <SourceViewer key={current.id} view={current.source_view} reference={source} />
          </div>
        )}
      </article>

      <div className="sticky bottom-0 mt-4 bg-background pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1">
        {pending > 0 && (
          <p className="mb-2 text-center text-xs font-medium text-hard" role="status">
            {pending} {pending === 1 ? "Bewertung wartet" : "Bewertungen warten"} auf Synchronisierung
          </p>
        )}
        {answer ? (
          <div className="grid grid-cols-4 gap-2" role="group" aria-label="Wie gut wusstest du es?">
            {GRADES.map((rating) => (
              <button
                key={rating}
                type="button"
                className={`btn h-16 flex-col !gap-0.5 !px-1 ${GRADE_STYLE[rating]}`}
                onClick={() => grade(rating)}
                data-testid={`grade-${rating}`}
              >
                <span className="font-semibold">{GRADE_LABELS[rating]}</span>
                <span className="text-xs font-normal text-muted">
                  {formatInterval(answer.at, new Date(answer.preview[rating].due))}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <button type="button" className="btn btn-primary h-16 w-full text-base" onClick={reveal}>
            Antwort zeigen
          </button>
        )}
        <p className="mt-2 hidden text-center text-xs text-muted md:block">
          {answer ? (
            <>
              <kbd>1</kbd>–<kbd>4</kbd> bewerten · <kbd>Leertaste</kbd> für „Gut“
            </>
          ) : (
            <>
              <kbd>Leertaste</kbd> zeigt die Antwort
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export default function StudyPage() {
  return (
    <Suspense fallback={<Loading rows={3} />}>
      <StudySession />
    </Suspense>
  );
}
