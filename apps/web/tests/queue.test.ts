import { describe, expect, it } from "vitest";
import {
  buildQueue,
  countQueue,
  endOfLocalDay,
  pickNext,
  requeue,
  startOfLocalDay,
  type QueueCard,
  type QueueLimits,
} from "@/lib/queue";

// Lokale Mittagszeit, damit die Tests in jeder Zeitzone denselben Kalendertag treffen.
const NOW = new Date(2026, 10, 14, 12, 0, 0);
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString();
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

let counter = 0;
function card(overrides: Partial<QueueCard>): QueueCard {
  counter += 1;
  return {
    id: `card-${String(counter).padStart(3, "0")}`,
    state: 2,
    due: minutes(-60),
    exam_date: null,
    course_priority: 0,
    note_priority: "mittel",
    created_at: days(-10),
    ...overrides,
  };
}

const LIMITS: QueueLimits = {
  newPerDay: 20,
  maxReviewsPerDay: 200,
  newDoneToday: 0,
  reviewsDoneToday: 0,
};

describe("Tagesgrenzen", () => {
  it("liefert lokale Mitternacht als Anfang und Ende des Tages", () => {
    expect(startOfLocalDay(NOW)).toEqual(new Date(2026, 10, 14));
    expect(endOfLocalDay(NOW)).toEqual(new Date(2026, 10, 15));
  });
});

describe("buildQueue", () => {
  it("stellt fällige Wiederholungen vor neue Karten", () => {
    const fresh = card({ id: "new", state: 0 });
    const review = card({ id: "review", state: 2 });
    const learning = card({ id: "learning", state: 1, due: minutes(-1) });

    const queue = buildQueue([fresh, review, learning], LIMITS, NOW);
    expect(queue.map((c) => c.id)).toEqual(["learning", "review", "new"]);
  });

  it("nimmt Wiederholungen von heute Abend mit, aber keine von morgen", () => {
    const tonight = card({ id: "tonight", due: new Date(2026, 10, 14, 23, 30).toISOString() });
    const tomorrow = card({ id: "tomorrow", due: new Date(2026, 10, 15, 0, 30).toISOString() });

    expect(buildQueue([tonight, tomorrow], LIMITS, NOW).map((c) => c.id)).toEqual(["tonight"]);
  });

  it("begrenzt neue Karten auf das Tageslimit abzüglich der heute gelernten", () => {
    const cards = Array.from({ length: 10 }, () => card({ state: 0 }));

    expect(buildQueue(cards, { ...LIMITS, newPerDay: 5 }, NOW)).toHaveLength(5);
    expect(buildQueue(cards, { ...LIMITS, newPerDay: 5, newDoneToday: 3 }, NOW)).toHaveLength(2);
    expect(buildQueue(cards, { ...LIMITS, newPerDay: 5, newDoneToday: 9 }, NOW)).toHaveLength(0);
  });

  it("begrenzt Wiederholungen auf das Tageslimit", () => {
    const cards = Array.from({ length: 10 }, () => card({ state: 2 }));
    const limits = { ...LIMITS, maxReviewsPerDay: 6, reviewsDoneToday: 2 };

    expect(buildQueue(cards, limits, NOW)).toHaveLength(4);
  });

  it("lässt laufende Lernschritte nie am Tageslimit scheitern", () => {
    const learning = card({ state: 3, due: minutes(5) });
    const limits = { ...LIMITS, maxReviewsPerDay: 0, newPerDay: 0 };

    expect(buildQueue([learning], limits, NOW)).toEqual([learning]);
  });

  it("sortiert nach Klausurdatum, dann Kurs-Priorität, dann Fälligkeit", () => {
    const late = card({ id: "late-exam", exam_date: "2027-02-20" });
    const soon = card({ id: "soon-exam", exam_date: "2026-12-18" });
    const none = card({ id: "no-exam", exam_date: null, course_priority: 2 });
    const noneLow = card({ id: "no-exam-low", exam_date: null, course_priority: 0 });
    const soonOlder = card({ id: "soon-older", exam_date: "2026-12-18", due: minutes(-600) });

    const queue = buildQueue([late, noneLow, none, soon, soonOlder], LIMITS, NOW);
    expect(queue.map((c) => c.id)).toEqual([
      "soon-older",
      "soon-exam",
      "late-exam",
      "no-exam",
      "no-exam-low",
    ]);
  });

  it("zieht bei neuen Karten hohe Priorität vor", () => {
    const low = card({ id: "low", state: 0, note_priority: "niedrig", created_at: days(-9) });
    const high = card({ id: "high", state: 0, note_priority: "hoch", created_at: days(-1) });
    const mid = card({ id: "mid", state: 0, note_priority: "mittel", created_at: days(-5) });

    const queue = buildQueue([low, high, mid], { ...LIMITS, newPerDay: 2 }, NOW);
    expect(queue.map((c) => c.id)).toEqual(["high", "mid"]);
  });
});

describe("pickNext", () => {
  it("gibt null für eine leere Queue zurück", () => {
    expect(pickNext([], NOW)).toBeNull();
  });

  it("zieht fällige Lernschritte allen anderen Karten vor", () => {
    const review = card({ id: "review" });
    const learningDue = card({ id: "learning-due", state: 1, due: minutes(-2) });

    expect(pickNext([review, learningDue], NOW)?.id).toBe("learning-due");
  });

  it("überspringt wartende Lernkarten, solange es andere Karten gibt", () => {
    const waiting = card({ id: "waiting", state: 1, due: minutes(8) });
    const fresh = card({ id: "fresh", state: 0 });

    expect(pickNext([waiting, fresh], NOW)?.id).toBe("fresh");
  });

  it("zieht die früheste wartende Lernkarte vor, wenn sonst nichts übrig ist", () => {
    const later = card({ id: "later", state: 1, due: minutes(9) });
    const sooner = card({ id: "sooner", state: 3, due: minutes(3) });

    expect(pickNext([later, sooner], NOW)?.id).toBe("sooner");
  });
});

describe("requeue", () => {
  it("entfernt eine Karte, die den Lernmodus verlassen hat", () => {
    const a = card({ id: "a" });
    const b = card({ id: "b" });
    const rated = { ...a, state: 2 as const, due: days(3) };

    expect(requeue([a, b], rated, NOW).map((c) => c.id)).toEqual(["b"]);
  });

  it("stellt eine Karte im Lernschritt ans Ende und übernimmt den neuen Stand", () => {
    const a = card({ id: "a", state: 0 });
    const b = card({ id: "b" });
    const rated = { ...a, state: 1 as const, due: minutes(10) };

    const queue = requeue([a, b], rated, NOW);
    expect(queue.map((c) => c.id)).toEqual(["b", "a"]);
    expect(queue[1]).toBe(rated);
  });

  it("stellt Lernkarten, die erst morgen fällig werden, nicht zurück", () => {
    const a = card({ id: "a", state: 1 });
    const rated = { ...a, due: days(1) };

    expect(requeue([a], rated, NOW)).toEqual([]);
  });
});

describe("countQueue", () => {
  it("zählt Lernen, Wiederholen und Neu getrennt", () => {
    const queue = [
      card({ state: 0 }),
      card({ state: 0 }),
      card({ state: 1 }),
      card({ state: 3 }),
      card({ state: 2 }),
    ];
    expect(countQueue(queue)).toEqual({ fresh: 2, learning: 2, review: 1 });
  });
});
