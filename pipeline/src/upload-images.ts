import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cliPath, findUserId, parseTarget, supabase } from "./supabase-cli";

/**
 * Lädt Dateien von Karten in den privaten Speicher und trägt die Speicherpfade ein:
 *  - Folienbilder von Bildkarten (`image` → `image_path`)
 *  - Quellenansichten (`source_view.items[].file` → `.path`): zitierte Folien und Textabschnitte
 *
 *   pnpm cards:upload-images <notes.json> [weitere …] --linked   (Cloud, über dein CLI-Login)
 *   pnpm cards:upload-images <notes.json> [weitere …] --local    (lokale Datenbank)
 *
 * Ablage: slides/<user_id>/<sha256>.<endung>. Gleiche Dateien werden nur einmal hochgeladen.
 */

type SourceItem = { kind: "image" | "text"; label: string; file?: string; path?: string };
type Note = {
  format?: string;
  image?: string;
  image_path?: string;
  front: string;
  source_view?: { items: SourceItem[] };
};

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".md": "text/markdown",
  ".txt": "text/plain",
};

const args = process.argv.slice(2);
const files = args.filter((arg) => !arg.startsWith("--"));
if (files.length === 0) {
  console.error("Aufruf: pnpm cards:upload-images <notes.json> [weitere …] --linked|--local");
  process.exit(1);
}
const target = parseTarget(args);
const invokedFrom = process.env.INIT_CWD ?? process.cwd();

let userId: string | null = null;
const uploaded = new Map<string, string>();
let uploads = 0;

function upload(local: string): string {
  const known = uploaded.get(local);
  if (known) return known;
  if (!existsSync(local)) {
    console.error(`Datei fehlt: ${local}`);
    process.exit(1);
  }
  const extension = path.extname(local).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) {
    console.error(`Dateityp nicht erlaubt: ${local}`);
    process.exit(1);
  }
  userId ??= findUserId(target);
  const hash = createHash("sha256").update(readFileSync(local)).digest("hex");
  const remote = `${userId}/${hash}${extension}`;
  supabase(["storage", "cp", cliPath(local), `ss:///slides/${remote}`, `--${target}`, "--experimental", "--content-type", contentType]);
  uploaded.set(local, remote);
  uploads += 1;
  console.log(`↑ ${path.basename(local)}`);
  return remote;
}

for (const file of files) {
  const notesPath = path.resolve(invokedFrom, file);
  const notes = JSON.parse(readFileSync(notesPath, "utf8")) as Note[];
  const resolve = (relative: string) => path.resolve(path.dirname(notesPath), relative);
  let changed = 0;

  for (const note of notes) {
    if (note.format === "bild" && note.image && !note.image_path) {
      note.image_path = upload(resolve(note.image));
      changed += 1;
    }
    for (const item of note.source_view?.items ?? []) {
      if (item.file && !item.path) {
        item.path = upload(resolve(item.file));
        changed += 1;
      }
    }
  }

  if (changed > 0) writeFileSync(notesPath, JSON.stringify(notes, null, 2) + "\n", "utf8");
  console.log(`${path.basename(notesPath)}: ${changed} Verweise aktualisiert`);
}
console.log(`${uploads} Dateien hochgeladen (${target}).`);
