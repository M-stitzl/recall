import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./supabase";

/**
 * Führt die Ablehnungsgründe aus der Freigabe zurück in die Pipeline:
 *   pnpm cards:feedback
 * schreibt pipeline/prompts/feedback.md. Die Datei wird beim Generieren mitgelesen,
 * damit dieselben Fehler nicht wieder vorkommen.
 */

const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../prompts/feedback.md");

type Row = {
  front: string;
  back: string;
  type: string;
  reject_reason: string | null;
  decided_at: string | null;
  courses: { name: string } | null;
};

const { supabase, userId, target } = await connect();

const { data, error } = await supabase
  .from("notes")
  .select("front, back, type, reject_reason, decided_at, courses(name)")
  .eq("user_id", userId)
  .eq("origin", "ai")
  .eq("status", "rejected")
  .order("decided_at", { ascending: false })
  .limit(300);
if (error) {
  console.error(error.message);
  process.exit(1);
}
const rejected = data as unknown as Row[];

const { count: approved } = await supabase
  .from("notes")
  .select("id", { count: "exact", head: true })
  .eq("user_id", userId)
  .eq("origin", "ai")
  .in("status", ["approved", "suspended"]);

const byReason = new Map<string, Row[]>();
for (const row of rejected) {
  const reason = row.reject_reason?.trim() || "Ohne Angabe";
  byReason.set(reason, [...(byReason.get(reason) ?? []), row]);
}
const reasons = [...byReason.entries()].sort((a, b) => b[1].length - a[1].length);

const decided = (approved ?? 0) + rejected.length;
const rate = decided > 0 ? `${(((approved ?? 0) / decided) * 100).toFixed(0)} %` : "–";
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 220);

const lines = [
  "# Feedback aus der Freigabe",
  "",
  "<!-- Automatisch erzeugt von `pnpm cards:feedback`. Nicht von Hand bearbeiten. -->",
  "",
  `Stand: ${new Date().toLocaleDateString("sv-SE")} · Freigabequote ${rate} (${approved ?? 0} angenommen, ${rejected.length} verworfen)`,
  "",
  "Diese Karten wurden verworfen. Vermeide die genannten Fehler bei neuen Karten.",
  "",
];
if (reasons.length === 0) {
  lines.push("_Bisher wurde keine Karte verworfen._", "");
}
for (const [reason, rows] of reasons) {
  lines.push(`## ${reason} (${rows.length}×)`, "");
  for (const row of rows.slice(0, 5)) {
    const back = row.back.trim() ? ` → ${oneLine(row.back)}` : "";
    lines.push(`- [${row.courses?.name ?? "?"}, ${row.type}] ${oneLine(row.front)}${back}`);
  }
  lines.push("");
}

mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, lines.join("\n"), "utf8");
console.log(`Quelle: ${target}`);
console.log(`${rejected.length} verworfene Karten in ${reasons.length} Gründen → ${output}`);
