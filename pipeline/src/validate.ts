import { readFileSync } from "node:fs";
import path from "node:path";
import {
  NOTE_FORMATS,
  parseImportText,
  sentenceCount,
  type ImportNote,
  type NoteFormat,
} from "@recall/schema";

/**
 * Prüft eine notes.json gegen das feste Import-Schema.
 *   pnpm cards:validate kurse/<kurs>/_karten/VL03.notes.json
 * Exit-Code 1 bei Fehlern – so kann die Pipeline hart abbrechen.
 */

// pnpm führt Skripte im Paketordner aus; Pfade beziehen sich aber auf den Aufrufort.
const invokedFrom = process.env.INIT_CWD ?? process.cwd();

export function readNotes(file: string): ImportNote[] {
  const absolute = path.resolve(invokedFrom, file);
  let text: string;
  try {
    text = readFileSync(absolute, "utf8");
  } catch {
    console.error(`Datei nicht gefunden: ${absolute}`);
    process.exit(1);
  }
  const result = parseImportText(text.replace(/^﻿/, ""));
  if (!result.ok) {
    console.error(`✗ ${file}: ${result.issues.length} Fehler`);
    for (const issue of result.issues) {
      const where = issue.index >= 0 ? `Note ${issue.index + 1}` : "Datei";
      console.error(`  ${where}${issue.path ? ` · ${issue.path}` : ""}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.notes;
}

/** Zielmix aus pipeline/prompts/cards.md (Anteile, keine harten Grenzen). */
const TARGET_MIX: Record<NoteFormat, number> = { warum: 0.4, cloze: 0.25, anwendung: 0.2, bild: 0.15 };

export function summarize(notes: ImportNote[]): string {
  const flagged = notes.filter((n) => n.check && (!n.check.ok || n.check.issues.length > 0)).length;
  const unchecked = notes.filter((n) => !n.check).length;
  const mix = NOTE_FORMATS.map((format) => {
    const count = notes.filter((n) => n.format === format).length;
    const share = notes.length ? Math.round((count / notes.length) * 100) : 0;
    return `${format} ${count} (${share} %, Ziel ${Math.round(TARGET_MIX[format] * 100)} %)`;
  });
  const parts = [`${notes.length} Notes`, mix.join(", ")];
  if (flagged > 0) parts.push(`${flagged} mit Hinweisen aus der Selbstprüfung`);
  if (unchecked > 0) parts.push(`${unchecked} ohne Selbstprüfung`);
  return parts.join(" · ");
}

/** Weiche Regeln: Hinweise, die nicht zum Abbruch führen. */
export function warnings(notes: ImportNote[]): string[] {
  const result: string[] = [];
  notes.forEach((note, index) => {
    if (note.format === "warum" && sentenceCount(note.back) > 2) {
      result.push(`Note ${index + 1}: Warum-Antwort hat mehr als 2 Sätze`);
    }
    if (note.format === "anwendung" && !/\d/.test(note.front)) {
      result.push(`Note ${index + 1}: Anwendungsaufgabe ohne Zahlen auf der Vorderseite`);
    }
  });
  return result;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]).endsWith("validate.ts");
if (isMain) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Aufruf: pnpm cards:validate <notes.json> [weitere.json …]");
    process.exit(1);
  }
  for (const file of files) {
    const notes = readNotes(file);
    console.log(`✓ ${file}: ${summarize(notes)}`);
    for (const warning of warnings(notes)) console.log(`  ⚠ ${warning}`);
  }
}
