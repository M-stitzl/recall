import { pendingSourceUploads } from "@recall/schema";
import { findUserId, literal, query, type Target } from "./supabase-cli";
import { readNotes } from "./validate";

/**
 * Trägt Quellenansichten bei bereits importierten Karten nach (Zuordnung über den Inhalt,
 * Status und Lernstand bleiben unverändert). Korrigierte Quellenangaben werden übernommen.
 *   pnpm cards:attach-sources <notes.json> [weitere …] --linked
 */

const args = process.argv.slice(2);
const files = args.filter((arg) => !arg.startsWith("--"));
const target: Target = args.includes("--local") ? "local" : "linked";
if (files.length === 0) {
  console.error("Aufruf: pnpm cards:attach-sources <notes.json> [weitere …] [--linked|--local]");
  process.exit(1);
}

const batches = files.map((file) => ({ file, notes: readNotes(file) }));
for (const { file, notes } of batches) {
  if (pendingSourceUploads(notes) > 0) {
    console.error(`✗ ${file}: Quellen noch nicht hochgeladen. Erst: pnpm cards:upload-images "${file}" --${target}`);
    process.exit(1);
  }
}

const userId = findUserId(target);
let total = 0;
for (const { file, notes } of batches) {
  const withView = notes.filter((note) => note.source_view);
  if (withView.length === 0) continue;
  const json = JSON.stringify(withView);
  const tag = "$src" + Math.random().toString(36).slice(2, 8) + "$";
  const rows = query<{ updated: number }>(
    `select public.attach_source_views_for(${literal(userId)}::uuid, ${tag}${json}${tag}::jsonb) as updated;`,
    target,
  );
  const updated = Number(rows[0]?.updated ?? 0);
  total += updated;
  console.log(`✓ ${file}: ${updated} von ${withView.length} Karten aktualisiert`);
}
console.log(`${total} Karten mit Quellenansicht (${target}).`);
