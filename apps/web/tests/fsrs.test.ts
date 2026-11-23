import { beforeAll, describe, expect, it } from "vitest";
import {
  createScheduler,
  formatInterval,
  previewCard,
  rateCard,
  type CardSchedule,
  type Scheduler,
} from "@/lib/fsrs";
import type { Grade } from "@/lib/types";

/**
 * Referenzwerte: FSRS-6 mit Standardparametern, Zielretention 90 %, ohne Fuzz.
 * Lernschritte 1 Min / 10 Min, Relearning 10 Min (Standard von ts-fsrs, wie Anki).
 * Schlägt einer dieser Tests fehl, hat sich das Scheduling geändert – z. B. durch
 * ein Bibliotheks-Update, Zeitzonen- oder Rundungsfehler.
 */

const START = new Date("2026-01-01T00:00:00.000Z");

function newCard(): CardSchedule {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    due: START.toISOString(),
    stability: 0,
    difficulty: 0,
    scheduled_days: 0,
    learning_step: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    last_review: null,
  };
}

let scheduler: Scheduler;

beforeAll(async () => {
  scheduler = await createScheduler({ desired_retention: 0.9, fsrs_params: null, enableFuzz: false });
});

/** Bewertet die Karte jeweils genau zum Fälligkeitszeitpunkt. */
function replay(grades: Grade[]): CardSchedule[] {
  const history: CardSchedule[] = [];
  let card = newCard();
  let now = START;
  for (const grade of grades) {
    card = rateCard(scheduler, card, grade, now);
    history.push(card);
    now = new Date(card.due);
  }
  return history;
}

describe("FSRS-6 Referenzintervalle", () => {
  it("nutzt das FSRS-6-Modell", () => {
    expect(scheduler.definition.model.name).toBe("fsrs-6");
  });

  it("plant die erste Bewertung einer neuen Karte wie die Referenz", () => {
    const preview = previewCard(scheduler, newCard(), START);

    expect(preview[1]).toMatchObject({ due: "2026-01-01T00:01:00.000Z", state: 1, stability: 0.212 });
    expect(preview[2]).toMatchObject({ due: "2026-01-01T00:05:30.000Z", state: 1, stability: 1.2931 });
    expect(preview[3]).toMatchObject({ due: "2026-01-01T00:10:00.000Z", state: 1, stability: 2.3065 });
    expect(preview[4]).toMatchObject({
      due: "2026-01-09T00:00:00.000Z",
      state: 2,
      stability: 8.2956,
      scheduled_days: 8,
    });
  });

  it("liefert für eine feste Bewertungsfolge feste Intervalle", () => {
    const history = replay([3, 3, 3, 1, 3]);

    expect(history.map((c) => c.due)).toEqual([
      "2026-01-01T00:10:00.000Z", // Good: Lernschritt 10 Min
      "2026-01-03T00:10:00.000Z", // Good: Abschluss, 2 Tage
      "2026-01-14T00:10:00.000Z", // Good: 11 Tage
      "2026-01-14T00:20:00.000Z", // Again: Relearning 10 Min
      "2026-01-16T00:20:00.000Z", // Good: 2 Tage
    ]);
    expect(history.map((c) => c.state)).toEqual([1, 2, 2, 3, 2]);
    expect(history.map((c) => c.scheduled_days)).toEqual([0, 2, 11, 0, 2]);
    expect(history.map((c) => c.reps)).toEqual([1, 2, 3, 4, 5]);
    expect(history.map((c) => c.lapses)).toEqual([0, 0, 0, 1, 1]);
    expect(history[2].stability).toBeCloseTo(10.97104786, 6);
    expect(history[3].stability).toBeCloseTo(1.5390125, 6);
    expect(history[3].difficulty).toBeCloseTo(7.38997579, 6);
  });

  it("merkt sich den Bewertungszeitpunkt als last_review", () => {
    const now = new Date("2026-03-29T01:30:00.000Z"); // Nacht der Zeitumstellung in Deutschland
    const rated = rateCard(scheduler, { ...newCard(), due: now.toISOString() }, 4, now);
    expect(rated.last_review).toBe("2026-03-29T01:30:00.000Z");
    // 8 Tage sind exakt 8 × 24 h in UTC – unabhängig von Sommer-/Winterzeit.
    expect(rated.due).toBe("2026-04-06T01:30:00.000Z");
  });

  it("verändert die Eingabekarte nicht und stimmt mit der Vorschau überein", () => {
    const card = newCard();
    const snapshot = structuredClone(card);
    const preview = previewCard(scheduler, card, START);
    for (const grade of [1, 2, 3, 4] as Grade[]) {
      expect(rateCard(scheduler, card, grade, START)).toEqual(preview[grade]);
    }
    expect(card).toEqual(snapshot);
  });

  it("verlängert Intervalle bei niedrigerer Zielretention", async () => {
    const relaxed = await createScheduler({
      desired_retention: 0.8,
      fsrs_params: null,
      enableFuzz: false,
    });
    const strict = rateCard(scheduler, newCard(), 4, START);
    const loose = rateCard(relaxed, newCard(), 4, START);
    expect(loose.scheduled_days).toBeGreaterThan(strict.scheduled_days);
  });
});

describe("formatInterval", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");
  const after = (ms: number) => new Date(from.getTime() + ms);
  const MIN = 60_000;
  const DAY = 86_400_000;

  it.each([
    [30_000, "< 1 Min"],
    [10 * MIN, "10 Min"],
    [3 * 60 * MIN, "3 Std"],
    [1 * DAY, "1 Tag"],
    [4 * DAY, "4 Tage"],
    [76 * DAY, "2,5 Mon"],
    [730 * DAY, "2 J"],
  ])("%d ms → %s", (ms, label) => {
    expect(formatInterval(from, after(ms))).toBe(label);
  });

  it("zeigt bei überfälligem Datum nie negative Werte", () => {
    expect(formatInterval(from, after(-5 * MIN))).toBe("< 1 Min");
  });
});
