import { DefaultScheduler } from "ts-fsrs";
import type { CardState, Grade, Settings, StudyCard } from "./types";

/**
 * Anbindung an ts-fsrs. Der Algorithmus wird bewusst nicht selbst implementiert.
 * Wir nutzen das FSRS-6-Modell (dasselbe wie Anki), nicht den neuen Default FSRS-7.
 */

export type Scheduler = Awaited<ReturnType<typeof DefaultScheduler<"FSRS-6">>>;

/** Die Felder, die FSRS pro Karte fortschreibt (so liegen sie in der Datenbank). */
export type CardSchedule = Pick<
  StudyCard,
  | "id"
  | "due"
  | "stability"
  | "difficulty"
  | "scheduled_days"
  | "learning_step"
  | "reps"
  | "lapses"
  | "state"
  | "last_review"
>;

export const GRADES: readonly Grade[] = [1, 2, 3, 4];

export const GRADE_LABELS: Record<Grade, string> = {
  1: "Nochmal",
  2: "Schwer",
  3: "Gut",
  4: "Einfach",
};

export type SchedulerOptions = Pick<Settings, "desired_retention" | "fsrs_params"> & {
  /** Streut längere Intervalle leicht, damit Karten nicht alle am selben Tag fällig werden. */
  enableFuzz?: boolean;
};

export async function createScheduler(options: SchedulerOptions): Promise<Scheduler> {
  return DefaultScheduler({
    version: "FSRS-6",
    desiredRetention: options.desired_retention,
    enableFuzz: options.enableFuzz ?? true,
    ...(options.fsrs_params && options.fsrs_params.length > 0
      ? { weights: options.fsrs_params }
      : {}),
  });
}

function scheduleStatus(state: CardState): "new" | "learning" | "review" {
  if (state === 0) return "new";
  if (state === 2) return "review";
  return "learning";
}

function toFsrsCard(card: CardSchedule) {
  return {
    cardId: card.id,
    stability: card.stability,
    difficulty: card.difficulty,
    state: card.state,
    scheduleStatus: scheduleStatus(card.state),
    dueAt: new Date(card.due),
    lastReviewAt: card.last_review ? new Date(card.last_review) : null,
    reps: card.reps,
    lapses: card.lapses,
    scheduledDays: card.scheduled_days,
    learningStep: card.learning_step,
  };
}

type FsrsCard = ReturnType<Scheduler["review"]>["card"];

function fromFsrsCard(card: FsrsCard, reviewedAt: Date): CardSchedule {
  return {
    id: String(card.cardId),
    due: new Date(card.dueAt).toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduled_days: card.scheduledDays,
    learning_step: card.learningStep,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as CardState,
    last_review: reviewedAt.toISOString(),
  };
}

/** Zustand der Karte nach einer Bewertung. Verändert die Eingabe nicht. */
export function rateCard(
  scheduler: Scheduler,
  card: CardSchedule,
  grade: Grade,
  now: Date,
): CardSchedule {
  const result = scheduler.review({ card: toFsrsCard(card), grade, now });
  return fromFsrsCard(result.card, now);
}

/** Alle vier möglichen Folgezustände – für die Intervalle unter den Buttons. */
export function previewCard(
  scheduler: Scheduler,
  card: CardSchedule,
  now: Date,
): Record<Grade, CardSchedule> {
  const preview = {} as Record<Grade, CardSchedule>;
  for (const item of scheduler.preview({ card: toFsrsCard(card), now })) {
    preview[item.grade as Grade] = fromFsrsCard(item.card, now);
  }
  return preview;
}

/** „10 Min“, „3 Std“, „4 Tage“, „2,5 Mon“ – Abstand zwischen jetzt und Fälligkeit. */
export function formatInterval(from: Date, due: Date): string {
  const minutes = Math.max(0, (due.getTime() - from.getTime()) / 60_000);
  if (minutes < 1) return "< 1 Min";
  if (minutes < 60) return `${Math.round(minutes)} Min`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)} Std`;
  const days = hours / 24;
  if (days < 31) {
    const rounded = Math.round(days);
    return rounded === 1 ? "1 Tag" : `${rounded} Tage`;
  }
  const months = days / 30.44;
  if (months < 12) return `${formatDecimal(months)} Mon`;
  const years = days / 365.25;
  return `${formatDecimal(years)} J`;
}

function formatDecimal(value: number): string {
  return (Math.round(value * 10) / 10).toString().replace(".", ",");
}
