import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";

/**
 * Admin-Zugang für die CLI-Skripte.
 *
 * Ohne Konfiguration wird die LOKALE Supabase-Instanz verwendet (Schlüssel aus der CLI).
 * Für die Cloud-Datenbank pipeline/.env anlegen (siehe pipeline/.env.example).
 * Der Service-Role-Schlüssel umgeht RLS – er gehört nie ins Repo und nie in die Web-App.
 */

const pipelineDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pipelineDir, "..");
config({ path: path.join(pipelineDir, ".env"), quiet: true });

export type Admin = { supabase: SupabaseClient; userId: string; target: string };

function localStack(): { url: string; key: string } {
  try {
    const raw = execSync("pnpm exec supabase status -o json", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const stack = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as {
      API_URL: string;
      SERVICE_ROLE_KEY: string;
    };
    return { url: stack.API_URL, key: stack.SERVICE_ROLE_KEY };
  } catch {
    console.error(
      "Keine Datenbank erreichbar: Lokale Supabase-Instanz läuft nicht (pnpm db:start) und pipeline/.env fehlt.",
    );
    process.exit(1);
  }
}

export async function connect(): Promise<Admin> {
  const fromEnv = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { url, key } = fromEnv
    ? { url: process.env.SUPABASE_URL!, key: process.env.SUPABASE_SERVICE_ROLE_KEY! }
    : localStack();

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) {
    console.error(`Anmeldung an ${url} fehlgeschlagen: ${error.message}`);
    process.exit(1);
  }
  const wanted = process.env.RECALL_USER_EMAIL?.toLowerCase();
  const candidates = data.users.filter((user) =>
    wanted ? user.email?.toLowerCase() === wanted : !user.email?.endsWith("@recall.test"),
  );
  if (candidates.length !== 1) {
    console.error(
      wanted
        ? `Kein Nutzer mit der Adresse aus RECALL_USER_EMAIL gefunden. Melde dich einmal in der App an.`
        : `Erwartet genau einen Nutzer, gefunden: ${candidates.length}. Melde dich einmal in der App an oder setze RECALL_USER_EMAIL in pipeline/.env.`,
    );
    process.exit(1);
  }
  return { supabase, userId: candidates[0].id, target: new URL(url).host };
}
