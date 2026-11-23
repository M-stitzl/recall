import { z } from "zod";

/**
 * Festes Schema für das Import-JSON der Karten-Pipeline.
 * Wird von der Web-App (Upload) und vom CLI (pipeline/) gemeinsam genutzt.
 */

export const NOTE_TYPES = ["basic", "cloze"] as const;
export const PRIORITIES = ["hoch", "mittel", "niedrig"] as const;
export const SOURCE_KINDS = ["folien", "uebung", "altklausur", "sonstiges"] as const;

/** Findet Cloze-Lücken wie {{c1::Antwort}} oder {{c2::Antwort::Hinweis}}. */
export const CLOZE_PATTERN = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

export function clozeOrdinals(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(CLOZE_PATTERN)) {
    found.add(Number(match[1]));
  }
  return [...found].sort((a, b) => a - b);
}

const selfCheckSchema = z.object({
  ok: z.boolean(),
  issues: z.array(z.string().trim().min(1)).default([]),
});

/**
 * Kartentypen für den Kartenmix (Zielwerte siehe pipeline/prompts/cards.md):
 *  - warum: Warum/Wie-Frage, freie Antwort in höchstens 2 Sätzen (Typ basic)
 *  - cloze: Formel, Definition oder Kennzahl, genau 1 Lücke (Typ cloze)
 *  - anwendung: Mini-Rechenaufgabe mit eigenen Zahlen, Rechenweg auf der Rückseite (Typ basic)
 *  - bild: verdecktes Element in einer Grafik (noch nicht unterstützt)
 */
export const NOTE_FORMATS = ["warum", "cloze", "anwendung", "bild"] as const;
export type NoteFormat = (typeof NOTE_FORMATS)[number];

/** Höchstzahl an Wörtern einer Cloze-Karte (ohne Cloze-Syntax). */
export const CLOZE_MAX_WORDS = 20;

/** Text einer Cloze-Karte ohne Syntax: {{c1::Antwort::Hinweis}} → Antwort. */
export function clozePlainText(text: string): string {
  return text.replace(CLOZE_PATTERN, (_all, _num: string, answer: string) => answer);
}

export function wordCount(text: string): number {
  return text
    .replace(/\$\$?[^$]*\$\$?/g, " Formel ")
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Anzahl der Lücken-Vorkommen (nicht nur der Nummern). */
export function clozeCount(text: string): number {
  return [...text.matchAll(CLOZE_PATTERN)].length;
}

/** Grobe Satzzählung für die Regel „Antwort in höchstens 2 Sätzen“ (Warnung, kein Fehler). */
export function sentenceCount(text: string): number {
  const cleaned = text
    .replace(/\$\$?[^$]*\$\$?/g, "x")
    .replace(/\b(e\.g|i\.e|c\.p|vs|incl|approx|etc|z\.B|bzw|ca|inkl|p\.a)\./gi, "x")
    .replace(/\d+\.\d+/g, "x");
  return cleaned.split(/[.!?]+(?:\s|$)/).filter((part) => part.trim().length > 0).length;
}

const fraction = z.number().min(0).max(1);

/** Verdeckter Bereich einer Bildkarte: Ecke oben links (x, y) und Größe (w, h), relativ 0..1. */
export const occlusionSchema = z
  .object({ x: fraction, y: fraction, w: fraction.positive(), h: fraction.positive() })
  .refine((r) => r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, "Abdeckung ragt über das Bild hinaus");

export type Occlusion = z.infer<typeof occlusionSchema>;

/**
 * Quellenansicht einer Karte: die zitierten Folien (ganze Folie als Bild) oder der zitierte
 * Textabschnitt. `file` ist der lokale Pfad (relativ zur notes-Datei), `path` der Pfad im
 * privaten Speicher nach dem Hochladen.
 */
export const sourceItemSchema = z
  .object({
    kind: z.enum(["image", "text"]),
    label: z.string().trim().min(1),
    file: z.string().trim().min(1).optional(),
    path: z.string().trim().min(1).optional(),
  })
  .refine((item) => item.file || item.path, "Quellenansicht ohne Datei");

export const sourceViewSchema = z.object({ items: z.array(sourceItemSchema).min(1) });
export type SourceView = z.infer<typeof sourceViewSchema>;

type UploadCheck = { format: string; image_path?: string; source_view?: SourceView };

/** Bildkarten, deren Bild noch nicht im privaten Speicher liegt (vor dem Import hochladen). */
export function pendingImageUploads(notes: UploadCheck[]): number {
  return notes.filter((n) => n.format === "bild" && !n.image_path).length;
}

/** Quellenansichten mit Dateien, die noch nicht hochgeladen sind. */
export function pendingSourceUploads(notes: UploadCheck[]): number {
  return notes.filter((n) => n.source_view?.items.some((item) => !item.path)).length;
}

export const importNoteSchema = z
  .object({
    /** Kartentyp für den Mix. */
    format: z.enum(NOTE_FORMATS, { message: "Kartentyp fehlt: warum, cloze, anwendung oder bild" }),
    /** Ein Satz: warum die Karte laut Prüfungsprofil prüfungsrelevant ist. */
    warum_relevant: z.string().trim().min(1, "warum_relevant fehlt (1 Satz Bezug zum Prüfungsprofil)"),
    course: z.string().trim().min(1, "Kursname fehlt"),
    source: z.string().trim().min(1, "Quelle (Datei) ist Pflicht"),
    source_ref: z.string().trim().min(1, "Quellenverweis (z. B. „Folie 12“) ist Pflicht"),
    type: z.enum(NOTE_TYPES),
    front: z.string().trim().min(1, "Vorderseite fehlt"),
    back: z.string().default(""),
    extra: z.string().default(""),
    tags: z.array(z.string().trim().min(1)).default([]),
    priority: z.enum(PRIORITIES).default("mittel"),
    week: z.string().trim().min(1).optional(),
    source_kind: z.enum(SOURCE_KINDS).optional(),
    source_title: z.string().trim().min(1).optional(),
    source_hash: z.string().trim().min(1).optional(),
    /** Ergebnis der Selbstprüfung (zweiter Claude-Durchlauf). */
    check: selfCheckSchema.optional(),
    /** Bildkarte: lokaler Pfad des Folienbilds (relativ zum Kursordner), vor dem Hochladen. */
    image: z.string().trim().min(1).optional(),
    /** Bildkarte: Pfad im privaten Speicher („<user_id>/<sha256>.png“), nach dem Hochladen. */
    image_path: z.string().trim().min(1).optional(),
    /** Bildkarte: verdeckter Bereich, relativ zur Bildgröße. */
    occlusion: occlusionSchema.optional(),
    /** Zitierte Folien bzw. Textabschnitte zum Nachschlagen (Button „Quelle anzeigen“). */
    source_view: sourceViewSchema.optional(),
  })
  .superRefine((note, ctx) => {
    if (note.format === "bild") {
      if (note.type !== "basic") {
        ctx.addIssue({ code: "custom", path: ["type"], message: "Bildkarte braucht type „basic“ (Frage + Antwort)" });
      }
      if (!note.occlusion) {
        ctx.addIssue({ code: "custom", path: ["occlusion"], message: "Bildkarte ohne verdeckten Bereich" });
      }
      if (!note.image && !note.image_path) {
        ctx.addIssue({ code: "custom", path: ["image"], message: "Bildkarte ohne Bild" });
      }
    } else if (note.image || note.image_path || note.occlusion) {
      ctx.addIssue({ code: "custom", path: ["format"], message: "Bild und Abdeckung nur bei Kartentyp „bild“" });
    }
    if (note.format === "cloze" && note.type !== "cloze") {
      ctx.addIssue({ code: "custom", path: ["type"], message: "Kartentyp „cloze“ braucht type „cloze“" });
    }
    if ((note.format === "warum" || note.format === "anwendung") && note.type !== "basic") {
      ctx.addIssue({
        code: "custom",
        path: ["type"],
        message: `Kartentyp „${note.format}“ ist eine Frage mit Antwort (type „basic“), kein Lückentext`,
      });
    }
    if (note.format === "cloze" && note.type === "cloze") {
      if (clozeCount(note.front) !== 1) {
        ctx.addIssue({
          code: "custom",
          path: ["front"],
          message: "Cloze-Karte: genau eine Lücke (1 Lücke = 1 Kernbegriff)",
        });
      }
      const words = wordCount(clozePlainText(note.front));
      if (words > CLOZE_MAX_WORDS) {
        ctx.addIssue({
          code: "custom",
          path: ["front"],
          message: `Cloze-Karte zu lang: ${words} Wörter (höchstens ${CLOZE_MAX_WORDS})`,
        });
      }
    }
    if (note.type === "cloze") {
      const ordinals = clozeOrdinals(note.front);
      if (ordinals.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["front"],
          message: "Cloze-Note ohne Lücke ({{c1::…}})",
        });
      }
      if (ordinals.some((n) => n < 1 || n > 20)) {
        ctx.addIssue({
          code: "custom",
          path: ["front"],
          message: "Cloze-Nummern müssen zwischen c1 und c20 liegen",
        });
      }
    } else {
      if (note.back.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["back"],
          message: "Basic-Note braucht eine Rückseite",
        });
      }
      if (clozeOrdinals(note.front).length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["front"],
          message: "Basic-Note enthält Cloze-Syntax – Typ „cloze“ gemeint?",
        });
      }
    }
  });

export const importFileSchema = z.array(importNoteSchema).min(1, "Die Datei enthält keine Notes");

export type ImportNote = z.infer<typeof importNoteSchema>;
export type ImportNoteInput = z.input<typeof importNoteSchema>;

export type ImportIssue = { index: number; path: string; message: string };

export type ParseResult =
  | { ok: true; notes: ImportNote[] }
  | { ok: false; issues: ImportIssue[] };

/** Prüft bereits geparstes JSON gegen das Schema und liefert lesbare Fehler. */
export function parseImport(data: unknown): ParseResult {
  // Erlaubt sowohl ein Array als auch { "notes": [...] }.
  const candidate =
    data !== null && typeof data === "object" && !Array.isArray(data) && "notes" in data
      ? (data as { notes: unknown }).notes
      : data;

  const result = importFileSchema.safeParse(candidate);
  if (result.success) {
    return { ok: true, notes: result.data };
  }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => {
      const [index, ...rest] = issue.path;
      return {
        index: typeof index === "number" ? index : -1,
        path: rest.join("."),
        message: issue.message,
      };
    }),
  };
}

/** Wie parseImport, aber für rohen Text (Datei-Upload, Zwischenablage). */
export function parseImportText(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          index: -1,
          path: "",
          message: `Kein gültiges JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
  return parseImport(data);
}
