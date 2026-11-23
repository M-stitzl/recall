import type { Priority, StudyCard } from "./types";

/**
 * Queue-Logik der Lernsession (reine Funktionen, ohne Datenbank und ohne Uhr).
 *
 * Regeln:
 *  - Fällige Wiederholungen kommen vor neuen Karten.
 *  - Neue Karten sind pro Tag begrenzt (new_per_day), Wiederholungen ebenfalls.
 *  - Reihenfolge nach Klausurdatum (nächste Klausur zuerst), dann Kurs-Priorität.
 *  - Lernkarten mit Minuten-Schritten erscheinen erst, wenn sie fällig sind –
 *    außer es ist sonst nichts mehr übrig.
 */

/** Karten in Lernschritten dürfen so viele Minuten vorgezogen werden. */
export const LEARN_AHEAD_MS = 20 * 60_000;

const PRIORITY_RANK: Record<Priority, number> = { hoch: 0, mittel: 1, niedrig: 2 };

export type QueueCard = Pick<
  StudyCard,
  "id" | "state" | "due" | "exam_date" | "course_priority" | "note_priority" | "created_at"
>;

export type QueueLimits = {
  newPerDay: number;
  maxReviewsPerDay: number;
  /** Heute bereits zum ersten Mal gelernte Karten. */
  newDoneToday: number;
  /** Heute bereits bewertete Wiederholungen. */
  reviewsDoneToday: number;
};

/** Beginn des lokalen Kalendertags (00:00) für `now`. */
export function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Ende des lokalen Kalendertags: Wiederholungen bis dahin gelten als „heute fällig“. */
export function endOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

function examTime(card: QueueCard): number {
  return card.exam_date ? Date.parse(card.exam_date) : Number.POSITIVE_INFINITY;
}

function compareCourse(a: QueueCard, b: QueueCard): number {
  const exam = examTime(a) - examTime(b);
  if (exam !== 0 && !Number.isNaN(exam)) return exam;
  return b.course_priority - a.course_priority;
}

function compareReviews(a: QueueCard, b: QueueCard): number {
  return compareCourse(a, b) || Date.parse(a.due) - Date.parse(b.due) || a.id.localeCompare(b.id);
}

function compareNew(a: QueueCard, b: QueueCard): number {
  return (
    compareCourse(a, b) ||
    PRIORITY_RANK[a.note_priority] - PRIORITY_RANK[b.note_priority] ||
    Date.parse(a.created_at) - Date.parse(b.created_at) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Baut die Tages-Queue aus allen Kandidaten.
 * Rückgabe: Lernkarten (laufende Schritte), dann Wiederholungen, dann neue Karten.
 */
export function buildQueue<T extends QueueCard>(cards: T[], limits: QueueLimits, now: Date): T[] {
  const dayEnd = endOfLocalDay(now).getTime();

  const learning = cards
    .filter((c) => (c.state === 1 || c.state === 3) && Date.parse(c.due) < dayEnd)
    .sort((a, b) => Date.parse(a.due) - Date.parse(b.due) || a.id.localeCompare(b.id));

  const reviewBudget = Math.max(0, limits.maxReviewsPerDay - limits.reviewsDoneToday);
  const reviews = cards
    .filter((c) => c.state === 2 && Date.parse(c.due) < dayEnd)
    .sort(compareReviews)
    .slice(0, reviewBudget);

  const newBudget = Math.max(0, limits.newPerDay - limits.newDoneToday);
  const fresh = cards
    .filter((c) => c.state === 0)
    .sort(compareNew)
    .slice(0, newBudget);

  return [...learning, ...reviews, ...fresh];
}

/**
 * Wählt die nächste Karte der laufenden Session.
 * Lernkarten, die noch nicht dran sind, warten – solange es andere Karten gibt.
 */
export function pickNext<T extends QueueCard>(queue: T[], now: Date): T | null {
  if (queue.length === 0) return null;
  const nowMs = now.getTime();
  const isWaiting = (c: T) => (c.state === 1 || c.state === 3) && Date.parse(c.due) > nowMs;

  // 1. Fällige Lernschritte haben Vorrang, damit die Minuten-Abstände stimmen.
  const dueLearning = queue
    .filter((c) => (c.state === 1 || c.state === 3) && Date.parse(c.due) <= nowMs)
    .sort((a, b) => Date.parse(a.due) - Date.parse(b.due))[0];
  if (dueLearning) return dueLearning;

  // 2. Sonst die nächste Karte in Queue-Reihenfolge, die nicht wartet.
  const ready = queue.find((c) => !isWaiting(c));
  if (ready) return ready;

  // 3. Nur noch wartende Lernkarten: die früheste vorziehen (Learn-ahead).
  return [...queue].sort((a, b) => Date.parse(a.due) - Date.parse(b.due))[0] ?? null;
}

/**
 * Aktualisiert die Session-Queue nach einer Bewertung.
 * Bleibt die Karte in einem Lernschritt, der heute noch fällig wird, kommt sie zurück.
 */
export function requeue<T extends QueueCard>(queue: T[], rated: T, now: Date): T[] {
  const rest = queue.filter((c) => c.id !== rated.id);
  const stillLearning = rated.state === 1 || rated.state === 3;
  const dueToday = Date.parse(rated.due) < endOfLocalDay(now).getTime();
  return stillLearning && dueToday ? [...rest, rated] : rest;
}

export type QueueCounts = { learning: number; review: number; fresh: number };

export function countQueue(queue: QueueCard[]): QueueCounts {
  return {
    learning: queue.filter((c) => c.state === 1 || c.state === 3).length,
    review: queue.filter((c) => c.state === 2).length,
    fresh: queue.filter((c) => c.state === 0).length,
  };
}
