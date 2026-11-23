import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-Client für Supabase. Die App spricht ausschließlich mit dem
 * öffentlichen (anon/publishable) Schlüssel; der Datenschutz kommt aus Row Level Security.
 * Die Session liegt im localStorage – so funktioniert der Login auch in der
 * installierten PWA auf dem iPhone und ohne Netz.
 */

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_ANON_KEY fehlen (siehe apps/web/.env.example).",
    );
  }

  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Login-Links werden bewusst auf /auth/confirm verarbeitet, nicht automatisch.
      detectSessionInUrl: false,
      storageKey: "recall-auth",
    },
  });
  return client;
}
