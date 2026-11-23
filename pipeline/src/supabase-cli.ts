import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Zugriff über die Supabase-CLI statt über Service-Role-Schlüssel.
 * `--linked` nutzt dein CLI-Login (supabase login + link), `--local` die lokale Instanz.
 * So müssen keine geheimen Schlüssel in Dateien oder Umgebungsvariablen stehen.
 */

export type Target = "linked" | "local";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Pfad für CLI-Argumente: relativ zum Repo mit „/“. Absolute Windows-Pfade („C:\…“) hält
 * `supabase storage cp` sonst für eine URL mit dem Schema „c:“.
 */
export function cliPath(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join("/");
}

export function parseTarget(args: string[]): Target {
  if (args.includes("--linked")) return "linked";
  if (args.includes("--local")) return "local";
  console.error("Ziel fehlt: --linked (Cloud) oder --local (lokale Datenbank).");
  process.exit(1);
}

/** Die Supabase-CLI ist ein Node-Skript; direkt mit Node starten, ohne Shell und ohne Quoting. */
const supabaseCli = path.join(
  path.dirname(createRequire(path.join(repoRoot, "package.json")).resolve("supabase/package.json")),
  "dist",
  "supabase.js",
);

export function supabase(args: string[]): string {
  return execFileSync(process.execPath, [supabaseCli, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Führt SQL aus einer Datei aus und liefert die Zeilen der letzten Abfrage. */
export function query<T = Record<string, unknown>>(sql: string, target: Target): T[] {
  const dir = mkdtempSync(path.join(tmpdir(), "recall-sql-"));
  const file = path.join(dir, "query.sql");
  writeFileSync(file, sql, "utf8");
  const raw = supabase(["db", "query", `--${target}`, "-f", file]);
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const result = JSON.parse(json) as { rows?: T[] };
  return result.rows ?? [];
}

/** SQL-Literal für Text (einfache Anführungszeichen verdoppeln). */
export function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Nutzer-ID für Importe: RECALL_USER_EMAIL oder der einzige Nutzer außer Testkonten. */
export function findUserId(target: Target): string {
  const wanted = process.env.RECALL_USER_EMAIL?.toLowerCase();
  const rows = query<{ id: string; email: string }>(
    wanted
      ? `select id, email from auth.users where lower(email) = ${literal(wanted)};`
      : `select id, email from auth.users where email not like '%@recall.test';`,
    target,
  );
  if (rows.length !== 1) {
    console.error(
      wanted
        ? `Kein Nutzer mit der Adresse aus RECALL_USER_EMAIL gefunden.`
        : `Erwartet genau einen Nutzer, gefunden: ${rows.length}. Setze RECALL_USER_EMAIL.`,
    );
    process.exit(1);
  }
  return rows[0].id;
}
