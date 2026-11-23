import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueReview, flushOutbox, pendingReviews, type PendingReview } from "@/lib/outbox";

function installLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
}

function review(logId: string): PendingReview {
  return {
    logId,
    cardId: `card-${logId}`,
    rating: 3,
    reviewedAt: "2026-11-14T10:00:00.000Z",
    durationMs: 1234.6,
    next: {
      id: `card-${logId}`,
      due: "2026-11-14T10:10:00.000Z",
      stability: 2.3065,
      difficulty: 2.118,
      scheduled_days: 0,
      learning_step: 1,
      reps: 1,
      lapses: 0,
      state: 1,
      last_review: "2026-11-14T10:00:00.000Z",
    },
  };
}

type RpcResult = { error: { message: string } | null };

function fakeSupabase(respond: (args: Record<string, unknown>) => RpcResult | Promise<RpcResult>) {
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => respond(args));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

beforeEach(() => {
  installLocalStorage();
});

describe("Ausgangskorb für Bewertungen", () => {
  it("sendet auch dann, wenn vorher ein Flush mit leerem Korb lief", async () => {
    const { client, rpc } = fakeSupabase(() => ({ error: null }));

    expect(await flushOutbox(client)).toBe(0); // leerer Korb, z. B. beim Öffnen der Session
    enqueueReview(review("a"));
    expect(await flushOutbox(client)).toBe(0);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(pendingReviews()).toEqual([]);
  });

  it("übergibt die Werte der Bewertung an review_card", async () => {
    const { client, rpc } = fakeSupabase(() => ({ error: null }));
    enqueueReview(review("a"));
    await flushOutbox(client);

    expect(rpc).toHaveBeenCalledWith("review_card", {
      p_log_id: "a",
      p_card_id: "card-a",
      p_rating: 3,
      p_reviewed_at: "2026-11-14T10:00:00.000Z",
      p_duration_ms: 1235,
      p_due: "2026-11-14T10:10:00.000Z",
      p_stability: 2.3065,
      p_difficulty: 2.118,
      p_scheduled_days: 0,
      p_learning_step: 1,
      p_reps: 1,
      p_lapses: 0,
      p_state: 1,
    });
  });

  it("behält Bewertungen bei Netzfehlern und sendet sie später in Reihenfolge nach", async () => {
    let online = false;
    const { client, rpc } = fakeSupabase(() =>
      online ? { error: null } : { error: { message: "Failed to fetch" } },
    );
    enqueueReview(review("a"));
    enqueueReview(review("b"));

    expect(await flushOutbox(client)).toBe(2);
    expect(pendingReviews().map((r) => r.logId)).toEqual(["a", "b"]);

    online = true;
    expect(await flushOutbox(client)).toBe(0);
    expect(rpc.mock.calls.slice(1).map(([, args]) => args.p_log_id)).toEqual(["a", "b"]);
  });

  it("sendet Bewertungen mit, die während eines laufenden Flushs dazukommen", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { client, rpc } = fakeSupabase(async () => {
      await gate;
      return { error: null };
    });

    enqueueReview(review("a"));
    const first = flushOutbox(client);
    enqueueReview(review("b"));
    const second = flushOutbox(client);
    release();

    expect(await first).toBe(0);
    expect(await second).toBe(0);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(pendingReviews()).toEqual([]);
  });

  it("verwirft Bewertungen für gelöschte Karten, statt die Warteschlange zu blockieren", async () => {
    const { client } = fakeSupabase((args) =>
      args.p_log_id === "a" ? { error: { message: "card_not_found" } } : { error: null },
    );
    enqueueReview(review("a"));
    enqueueReview(review("b"));

    expect(await flushOutbox(client)).toBe(0);
    expect(pendingReviews()).toEqual([]);
  });
});
