import type { QueueCounts } from "@/lib/queue";

/**
 * Der Kartenstapel von der Seite: ein Strich pro Karte, gefärbt nach Lernzustand.
 * Taucht überall auf, wo Arbeit ansteht – auf „Heute“, pro Kurs und in der Lernsession,
 * wo der Stapel Karte für Karte kleiner wird.
 */

const SEGMENTS = [
  { key: "learning", color: "bg-again", label: "im Lernen" },
  { key: "review", color: "bg-good", label: "Wiederholungen" },
  { key: "fresh", color: "bg-easy", label: "neu" },
] as const;

const MAX_TICKS = 72;

export function stackLabel(counts: QueueCounts): string {
  const total = counts.learning + counts.review + counts.fresh;
  if (total === 0) return "Keine Karten offen";
  return SEGMENTS.filter((segment) => counts[segment.key] > 0)
    .map((segment) => `${counts[segment.key]} ${segment.label}`)
    .join(", ");
}

/** Verteilt bei großen Stapeln die Striche proportional, mindestens einen pro belegtem Zustand. */
function tickCounts(counts: QueueCounts): number[] {
  const values = SEGMENTS.map((segment) => counts[segment.key]);
  const total = values.reduce((sum, n) => sum + n, 0);
  if (total <= MAX_TICKS) return values;
  return values.map((n) => (n === 0 ? 0 : Math.max(1, Math.round((n / total) * MAX_TICKS))));
}

type Props = {
  counts: QueueCounts;
  size?: "lg" | "md" | "sm";
  className?: string;
};

const HEIGHT = { lg: "h-11", md: "h-5", sm: "h-2" } as const;
const TICK = { lg: "max-w-[7px] rounded-[2px]", md: "max-w-[4px] rounded-[1px]", sm: "max-w-[4px] rounded-[1px]" } as const;

export function StackStrip({ counts, size = "md", className = "" }: Props) {
  const ticks = tickCounts(counts);
  const total = ticks.reduce((sum, n) => sum + n, 0);

  return (
    <div
      role="img"
      aria-label={stackLabel(counts)}
      className={`flex items-stretch gap-[2px] ${HEIGHT[size]} ${className}`}
    >
      {total === 0 ? (
        <span className="h-px w-full self-end bg-border" />
      ) : (
        SEGMENTS.flatMap((segment, index) =>
          Array.from({ length: ticks[index] }, (_, i) => (
            <span key={`${segment.key}-${i}`} className={`min-w-px flex-1 ${TICK[size]} ${segment.color}`} />
          )),
        )
      )}
    </div>
  );
}

/** Legende zum Stapel: Zahl und Zustand, mit Farbpunkt in der Farbe der Striche. */
export function StackLegend({ counts, className = "" }: { counts: QueueCounts; className?: string }) {
  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1 text-sm ${className}`}>
      {SEGMENTS.map((segment) => (
        <li key={segment.key} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-[3px] rounded-[1px] ${segment.color}`} aria-hidden="true" />
          <span className="font-semibold">{counts[segment.key]}</span>
          <span className="text-muted">{segment.label}</span>
        </li>
      ))}
    </ul>
  );
}
