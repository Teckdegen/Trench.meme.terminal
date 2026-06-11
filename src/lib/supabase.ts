// Supabase client — browser anon (RLS) + server admin (Service Role).
//
// The admin client requires a `ws` transport on Node < 22 (Vercel runs
// Node 20). We load it via a runtime-built dynamic import so Vite's
// dep crawler never tries to put `ws` in the browser chunk — ws uses
// Node-only APIs and would fail to resolve there. The `if (typeof
// window === "undefined")` ensures the import only runs server-side.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let WebSocketImpl: any;
if (typeof window === "undefined") {
  try {
    // String built at runtime + @vite-ignore so Vite leaves "ws" alone.
    // Top-level await is fine here — only the server branch awaits;
    // the client branch is skipped entirely (no module suspension).
    const mod = await import(/* @vite-ignore */ ("w" + "s"));
    WebSocketImpl = (mod as any).default ?? mod;
  } catch {
    /* ws not installed locally — admin REST still works, realtime won't */
  }
}

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let _browser: SupabaseClient | undefined;
export function supabase(): SupabaseClient {
  if (_browser) return _browser;
  if (!URL || !ANON) {
    throw new Error(
      "Supabase env missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example).",
    );
  }
  _browser = createClient(URL, ANON, {
    auth: { persistSession: true, autoRefreshToken: true },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return _browser;
}

let _admin: SupabaseClient | undefined;
export function supabaseAdmin(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("supabaseAdmin() must only be called on the server.");
  }
  if (_admin) return _admin;
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Server Supabase env missing. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false },
    realtime: WebSocketImpl ? { transport: WebSocketImpl } : undefined,
  });
  return _admin;
}
