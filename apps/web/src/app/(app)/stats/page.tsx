"use client";

import type { ReactNode } from "react";
import { EmptyState, ErrorNote, Loading, PageHeader, SectionTitle } from "@/components/ui";
import { fetchSettings, fetchStats } from "@/lib/data";
import { useQuery } from "@/lib/hooks";

function percent(part: number, whole: number): string {
  if (whole === 0) return "–";
  return `${((part / whole) * 100).toFixed(1).replace(".", ",")} %`;
}

function Row({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1 py-3">
      <dt className="text-sm">{label}</dt>
      <dd className="text-right text-base font-semibold">{value}</dd>
      {note && <dd className="col-span-2 text-sm text-muted">{note}</dd>}
    </div>
  );
}

/** Ist-Retention gegen das Ziel auf einer Skala von 70 bis 100 %. */
function RetentionScale({ actual, target }: { actual: number | null; target: number }) {
  const position = (value: number) => `${Math.min(100, Math.max(0, ((value - 0.7) / 0.3) * 100))}%`;
  return (
    <div className="mt-2" aria-hidden="true">
      <div className="relative h-2 rounded-full bg-surface-2">
        <span
          className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 bg-foreground"
          style={{ left: position(target) }}
        />
        {actual !== null && (
          <span
            className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background ${
              actual >= target - 0.03 ? "bg-good" : "bg-again"
            }`}
            style={{ left: position(actual) }}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span>70 %</span>
        <span>100 %</span>
      </div>
    </div>
  );
}

function Bars({
  title,
  values,
  labels,
  highlight,
  unit,
}: {
  title: string;
  values: number[];
  labels: string[];
  highlight?: number;
  unit: [singular: string, plural: string];
}) {
  const max = Math.max(1, ...values);
  const total = values.reduce((sum, n) => sum + n, 0);
  return (
    <figure>
      <figcaption>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-sm text-muted">
          {total} {total === 1 ? unit[0] : unit[1]}
          {total > 0 ? ` · höchstens ${max} an einem Tag` : ""}
        </span>
      </figcaption>
      <div
        className="mt-3 flex h-28 items-end gap-[3px] border-b border-foreground/40"
        role="img"
        aria-label={`${title}: ${values.map((value, index) => `${labels[index]} ${value}`).join(", ")}`}
      >
        {values.map((value, index) => (
          <div key={index} className="flex h-full flex-1 flex-col justify-end" title={`${labels[index]}: ${value}`}>
            <div
              className={`rounded-t-[2px] ${index === highlight ? "bg-marker" : "bg-foreground/75"}`}
              style={{ height: `${(value / max) * 100}%`, minHeight: value > 0 ? 3 : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </figure>
  );
}

function dayLabel(date: Date): string {
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

const STATES = [
  { key: "0", label: "Neu", color: "bg-easy" },
  { key: "1", label: "Lernen", color: "bg-again" },
  { key: "3", label: "Neu lernen", color: "bg-hard" },
  { key: "2", label: "Wiederholen", color: "bg-good" },
] as const;

export default function StatsPage() {
  const { data, error, loading, reload } = useQuery(async () => {
    const [stats, settings] = await Promise.all([fetchStats(), fetchSettings()]);
    return { stats, settings };
  });

  if (loading) return <Loading rows={5} />;
  if (error || !data) return <ErrorNote message={error ?? "Unbekannter Fehler"} onRetry={reload} />;

  const { stats, settings } = data;
  const today = new Date();

  const forecastLabels = stats.forecast.map((entry) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + entry.offset);
    return entry.offset === 0 ? "heute" : dayLabel(date);
  });

  // Verlauf der letzten 30 Tage lückenlos aufbauen (Tage ohne Reviews = 0).
  const byDay = new Map(stats.history.map((entry) => [entry.day, entry]));
  const history = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (29 - index));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate(),
    ).padStart(2, "0")}`;
    return { date, reviews: byDay.get(key)?.reviews ?? 0, durationMs: byDay.get(key)?.duration_ms ?? 0 };
  });
  const activeDays = history.filter((day) => day.reviews > 0);
  const avgMinutes =
    activeDays.length > 0
      ? activeDays.reduce((sum, day) => sum + day.durationMs, 0) / activeDays.length / 60_000
      : 0;

  const decided = stats.decisions.approved + stats.decisions.rejected;
  const cardTotal = Object.values(stats.states).reduce((sum, n) => sum + n, 0);
  const retention =
    stats.retention.total > 0 ? stats.retention.passed / stats.retention.total : null;
  const targetPercent = Math.round(settings.desired_retention * 100);

  if (stats.total_reviews === 0 && cardTotal === 0) {
    return (
      <>
        <PageHeader title="Statistik" />
        <EmptyState title="Noch nichts zu messen">
          Sobald du Karten lernst, siehst du hier, wie viel du behältst (Ist-Retention gegen dein Ziel
          von {targetPercent} %), wie lange du täglich lernst und was in den nächsten 14 Tagen fällig
          wird.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Statistik" subtitle={`${stats.total_reviews} Bewertungen · ${cardTotal} aktive Karten`} />

      <dl className="rows border-y border-border">
        <Row
          label="Ist-Retention, letzte 30 Tage"
          value={percent(stats.retention.passed, stats.retention.total)}
          note={
            <>
              {retention === null
                ? `Noch keine Wiederholungen – die Retention zählt erst ab der zweiten Begegnung mit einer Karte. Ziel: ${targetPercent} %.`
                : `${stats.retention.passed} von ${stats.retention.total} Wiederholungen gewusst. Ziel: ${targetPercent} % (Strich).`}
              <RetentionScale actual={retention} target={settings.desired_retention} />
            </>
          }
        />
        <Row
          label="Lernzeit pro aktivem Tag"
          value={activeDays.length > 0 ? `${avgMinutes < 1 ? "< 1" : avgMinutes.toFixed(0)} Min` : "–"}
          note={`${activeDays.length} von 30 Tagen gelernt`}
        />
        <Row
          label="Freigabequote der KI-Karten"
          value={percent(stats.decisions.approved, decided)}
          note={`${stats.decisions.approved} angenommen, ${stats.decisions.rejected} verworfen, ${stats.decisions.draft} offen`}
        />
      </dl>

      <div className="mt-9 grid gap-9 md:grid-cols-2">
        <Bars
          title="Fällig in den nächsten 14 Tagen"
          unit={["Wiederholung", "Wiederholungen"]}
          values={stats.forecast.map((entry) => entry.due)}
          labels={forecastLabels}
          highlight={0}
        />
        <Bars
          title="Bewertungen, letzte 30 Tage"
          unit={["Bewertung", "Bewertungen"]}
          values={history.map((day) => day.reviews)}
          labels={history.map((day) => dayLabel(day.date))}
          highlight={29}
        />
      </div>

      <SectionTitle>Karten nach Zustand</SectionTitle>
      <div
        className="flex h-3 overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={STATES.map((state) => `${state.label} ${stats.states[state.key] ?? 0}`).join(", ")}
      >
        {STATES.map((state) => {
          const count = stats.states[state.key] ?? 0;
          return count > 0 ? (
            <span key={state.key} className={state.color} style={{ width: `${(count / cardTotal) * 100}%` }} />
          ) : null;
        })}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {STATES.map((state) => (
          <li key={state.key} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${state.color}`} aria-hidden="true" />
            <span className="font-semibold">{stats.states[state.key] ?? 0}</span>
            <span className="text-muted">{state.label}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
