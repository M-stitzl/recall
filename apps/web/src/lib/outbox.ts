import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardSchedule } from "./fsrs";
import type { Grade } from "./types";

/**
 * Ausgangskorb für Bewertungen. Jede Bewertung bekommt eine feste Log-ID und
 * landet zuerst im localStorage; erst nach bestätigtem Schreiben wird sie entfernt.
 * Die RPC `review_card` ist über die Log-ID idempotent, ein Retry bucht nie doppelt.
 * So gehen Bewertungen bei Funklöchern nicht verloren.
 */

const STORAGE_KEY = "recall-outbox-v1";

export type PendingReview = {
  logId: string;
  cardId: string;
  rating: Grade;
  reviewedAt: string;
  durationMs: number;
  next: CardSchedule;
};

function read(): PendingReview[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PendingReview[]) : [];
  } catch {
    return [];
  }
}

function write(items: PendingReview[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Speicher voll oder gesperrt: Die Bewertung wird trotzdem direkt gesendet.
  }
}

export function pendingReviews(): PendingReview[] {
  return read();
}

export function enqueueReview(review: PendingReview): void {
  write([...read(), review]);
}

async function send(supabase: SupabaseClient, review: PendingReview): Promise<void> {
  const { error } = await supabase.rpc("review_card", {
    p_log_id: review.logId,
    p_card_id: review.cardId,
    p_rating: review.rating,
    p_reviewed_at: review.reviewedAt,
    p_duration_ms: Math.round(review.durationMs),
    p_due: review.next.due,
    p_stability: review.next.stability,
    p_difficulty: review.next.difficulty,
    p_scheduled_days: review.next.scheduled_days,
    p_learning_step: review.next.learning_step,
    p_reps: review.next.reps,
    p_lapses: review.next.lapses,
    p_state: review.next.state,
  });
  if (error) throw error;
}

let flushing: Promise<number> | null = null;

/**
 * Sendet alle wartenden Bewertungen in ihrer Reihenfolge.
 * Gibt zurück, wie viele noch offen sind (0 = alles gespeichert).
 */
export function flushOutbox(supabase: SupabaseClient): Promise<number> {
  if (flushing) return flushing;
  // Erst zuweisen, dann per .finally() freigeben: Ein leerer Korb ist sofort fertig,
  // und ein Aufräumen innerhalb von drain() liefe noch vor der Zuweisung.
  const run: Promise<number> = drain(supabase).finally(() => {
    if (flushing === run) flushing = null;
  });
  flushing = run;
  return run;
}

async function drain(supabase: SupabaseClient): Promise<number> {
  // Immer den ältesten Eintrag neu lesen: während des Sendens können neue dazukommen.
  for (;;) {
    const review = read()[0];
    if (!review) return 0;
    try {
      await send(supabase, review);
    } catch (error) {
      // Karte gibt es nicht mehr (z. B. Note gelöscht): Eintrag verwerfen statt ewig hängen.
      const message = (error as { message?: string } | null)?.message ?? "";
      if (!message.includes("card_not_found")) return read().length;
    }
    write(read().filter((item) => item.logId !== review.logId));
  }
}
