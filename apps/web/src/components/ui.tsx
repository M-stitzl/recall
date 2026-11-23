import type { ReactNode } from "react";

const ICON_PATHS = {
  today: "M4 11.2 12 4.5l8 6.7V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z",
  courses: "M5 5.5h14M5 5.5v13h14v-13M9 5.5v13M5 10h4M5 14h4",
  review: "m5 12.5 4.5 4.5L19 7.5",
  stats: "M5 20V11M12 20V4M19 20v-6",
  more: "M5 7h14M5 12h14M5 17h14",
  back: "M19 12H5m0 0 6-6m-6 6 6 6",
  forward: "M5 12h14m0 0-6-6m6 6-6 6",
  plus: "M12 5v14M5 12h14",
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** Ein Icon-Satz für die ganze App: gleiche Strichstärke, gleiche Endungen. */
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 mt-9 text-sm font-semibold text-muted">{children}</h2>;
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-again/40 bg-surface p-4"
    >
      <div>
        <p className="text-sm font-semibold text-again">Das hat nicht geklappt.</p>
        <p className="mt-0.5 text-sm text-muted">{message}</p>
      </div>
      {onRetry && (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          Erneut versuchen
        </button>
      )}
    </div>
  );
}

/** Platzhalter in der Form des späteren Inhalts statt eines Lade-Textes. */
export function Loading({ rows = 4, label = "Inhalt wird geladen" }: { rows?: number; label?: string }) {
  return (
    <div aria-busy="true" aria-label={label} role="status">
      <div className="skeleton h-8 w-40" />
      <div className="skeleton mt-3 h-4 w-56" />
      <div className="mt-8 space-y-4">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="skeleton h-12" style={{ width: `${100 - index * 9}%` }} />
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-5 py-8">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  const style =
    tone === "warn"
      ? "bg-warn-soft text-warn-text"
      : tone === "hoch"
        ? "bg-marker-soft text-foreground"
        : "bg-surface-2 text-muted";
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ${style}`}>
      {children}
    </span>
  );
}

export function formatDate(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Tage bis zur Klausur (0 = heute), oder null ohne Datum. */
export function daysUntil(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  const target = new Date(year, month - 1, day).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}
