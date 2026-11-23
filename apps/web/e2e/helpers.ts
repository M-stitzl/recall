import { execSync } from "node:child_process";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

export const E2E_EMAIL = "e2e@recall.test";

type LocalStack = { API_URL: string; SERVICE_ROLE_KEY: string };

let admin: SupabaseClient | null = null;

/** Admin-Client für die LOKALE Supabase-Instanz. Schlüssel kommen direkt aus der CLI. */
export function getAdmin(): SupabaseClient {
  if (admin) return admin;
  const root = path.resolve(__dirname, "../../..");
  const raw = execSync("pnpm exec supabase status -o json", {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const stack = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as LocalStack;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(stack.API_URL)) {
    throw new Error(`E2E-Tests dürfen nur gegen die lokale Datenbank laufen, nicht ${stack.API_URL}`);
  }
  admin = createClient(stack.API_URL, stack.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

/** Stellt sicher, dass der Testnutzer existiert, und löscht alle seine Daten. */
export async function resetTestUser(): Promise<string> {
  const supabase = getAdmin();
  const { data: list, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) throw listError;
  let user = list.users.find((u) => u.email === E2E_EMAIL);
  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: E2E_EMAIL,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
  }
  // Kurse löschen kaskadiert auf Quellen, Notes und Karten.
  for (const table of ["review_logs", "courses", "settings"]) {
    const { error } = await supabase.from(table).delete().eq("user_id", user.id);
    if (error) throw error;
  }
  return user.id;
}

/** Meldet den Testnutzer über einen frisch erzeugten Login-Link an. */
export async function login(page: Page): Promise<void> {
  const { data, error } = await getAdmin().auth.admin.generateLink({
    type: "magiclink",
    email: E2E_EMAIL,
  });
  if (error) throw error;
  await page.goto(`/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink`);
  await page.waitForURL("**/");
  await page.getByRole("heading", { name: "Heute" }).waitFor();
}

export function makeNotes(course: string, basicCount: number): unknown[] {
  const notes: unknown[] = Array.from({ length: basicCount }, (_, i) => ({
    course,
    source: "VL01.pdf",
    source_ref: `Folie ${i + 1}`,
    type: "basic",
    format: "warum",
    warum_relevant: "Testkarte für die E2E-Tests.",
    front: `Testfrage ${i + 1}: Was ist Begriff ${i + 1}?`,
    back: `Antwort ${i + 1}`,
    tags: ["e2e"],
    priority: i % 3 === 0 ? "hoch" : "mittel",
  }));
  notes.push({
    course,
    source: "VL01.pdf",
    source_ref: "Folie 30",
    type: "cloze",
    format: "cloze",
    warum_relevant: "Testkarte für die E2E-Tests.",
    front: "Der WACC gewichtet mit {{c1::Marktwerten}}: $r = \\frac{E}{V} r_E$",
    extra: "Zusatzinfo",
    check: { ok: false, issues: ["Formel unvollständig"] },
  });
  return notes;
}
