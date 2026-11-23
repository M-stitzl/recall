import { pendingImageUploads, pendingSourceUploads, type ImportNote } from "@recall/schema";
import { connect } from "./supabase";
import { findUserId, literal, query, type Target } from "./supabase-cli";
import { readNotes, summarize } from "./validate";

/**
 * Importiert geprüfte Notes als Entwürfe in die Datenbank.
 *   pnpm cards:import <notes.json> [weitere …]            lokale Instanz bzw. pipeline/.env
 *   pnpm cards:import <notes.json> [weitere …] --linked   Cloud über dein CLI-Login (ohne Schlüssel)
 * Doppelte Inhalte werden per Hash erkannt und übersprungen. Karten entstehen erst
 * nach der Freigabe in der App. Bildkarten brauchen vorher `pnpm cards:upload-images`.
 */

const args = process.argv.slice(2);
const files = args.filter((arg) => !arg.startsWith("--"));
const viaCli: Target | null = args.includes("--linked") ? "linked" : null;
if (files.length === 0) {
  console.error("Aufruf: pnpm cards:import <notes.json> [weitere.json …] [--linked]");
  process.exit(1);
}

// Erst alles validieren, dann importieren: keine halben Importe wegen einer kaputten Datei.
const batches = files.map((file) => ({ file, notes: readNotes(file) }));
for (const { file, notes } of batches) {
  const missing = pendingImageUploads(notes) + pendingSourceUploads(notes);
  if (missing > 0) {
    console.error(`✗ ${file}: ${missing} Karten mit noch nicht hochgeladenen Bildern oder Quellen. Erst: pnpm cards:upload-images "${file}" --linked`);
    process.exit(1);
  }
}

type Result = { inserted: number; duplicates: number };

async function importAll(run: (notes: ImportNote[]) => Promise<Result>) {
  for (const { file, notes } of batches) {
    try {
      const result = await run(notes);
      console.log(
        `✓ ${file}: ${summarize(notes)} → ${result.inserted} importiert, ${result.duplicates} Duplikate übersprungen`,
      );
    } catch (error) {
      console.error(`✗ ${file}: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
  console.log("Die Entwürfe warten jetzt in der App unter „Freigabe“.");
}

if (viaCli) {
  const userId = findUserId(viaCli);
  console.log(`Ziel: ${viaCli} (Supabase-CLI)`);
  await importAll(async (notes) => {
    const json = JSON.stringify(notes);
    const tag = "$imp" + Math.random().toString(36).slice(2, 8) + "$";
    if (json.includes(tag)) throw new Error("Trennzeichen kollidiert");
    const rows = query<{ result: Result | string }>(
      `select public.import_notes_for(${literal(userId)}::uuid, ${tag}${json}${tag}::jsonb) as result;`,
      viaCli,
    );
    const value = rows[0]?.result;
    return (typeof value === "string" ? JSON.parse(value) : value) as Result;
  });
} else {
  const { supabase, userId, target } = await connect();
  console.log(`Ziel: ${target}`);
  await importAll(async (notes) => {
    const { data, error } = await supabase.rpc("import_notes_for", { p_user: userId, p_notes: notes });
    if (error) throw new Error(error.message);
    return data as Result;
  });
}
