// Alert CRUD server fns — admin client bypasses RLS (we don't issue
// Supabase JWTs, so the anon client's `auth_addr()` is NULL and every
// `alerts` query was silently no-op'ing). All write paths trust the
// `me` arg the same way other server fns in this codebase do.

import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/lib/supabase";

type AlertKind = "price" | "progress" | "launch" | "wallet" | "volume" | "holder";
type Comparator = ">" | "<" | ">=" | "<=" | "==" | "any";

export type AlertRow = {
  id: string;
  owner_address: string;
  kind: AlertKind;
  token_address: string | null;
  wallet_address: string | null;
  comparator: Comparator;
  threshold: number | null;
  enabled: boolean;
  push_inapp: boolean;
  push_telegram: boolean;
  push_email: boolean;
  note: string | null;
  created_at: string;
  last_fired_at?: string | null;
};

export const listAlerts = createServerFn({ method: "GET" })
  .inputValidator((d: { me: string }) => d)
  .handler(async ({ data }): Promise<AlertRow[]> => {
    const sb = supabaseAdmin();
    const { data: rows, error } = await sb
      .from("alerts")
      .select("*")
      .eq("owner_address", data.me.toLowerCase())
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []) as AlertRow[];
  });

export const createAlert = createServerFn({ method: "POST" })
  .inputValidator((d: {
    me: string;
    kind: AlertKind;
    token_address?: string | null;
    wallet_address?: string | null;
    comparator: Comparator;
    threshold?: number | null;
    note?: string | null;
  }) => d)
  .handler(async ({ data }) => {
    const sb = supabaseAdmin();
    const { error } = await sb.from("alerts").insert({
      owner_address: data.me.toLowerCase(),
      kind: data.kind,
      token_address: data.token_address?.toLowerCase() ?? null,
      wallet_address: data.wallet_address?.toLowerCase() ?? null,
      comparator: data.comparator,
      threshold: data.threshold ?? null,
      enabled: true,
      push_inapp: true,
      push_telegram: false,
      push_email: false,
      note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
  });

export const toggleAlert = createServerFn({ method: "POST" })
  .inputValidator((d: { me: string; id: string; enabled: boolean }) => d)
  .handler(async ({ data }) => {
    const sb = supabaseAdmin();
    const { error } = await sb
      .from("alerts")
      .update({ enabled: data.enabled })
      .eq("id", data.id)
      .eq("owner_address", data.me.toLowerCase()); // owner guard
    if (error) throw new Error(error.message);
  });

// ─────────── notifications (same RLS issue — admin-backed reads) ──────────
export type NotificationRow = {
  id: string;
  owner_address: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  created_at: string;
};

export const listNotifications = createServerFn({ method: "GET" })
  .inputValidator((d: { me: string }) => d)
  .handler(async ({ data }): Promise<NotificationRow[]> => {
    const sb = supabaseAdmin();
    const { data: rows, error } = await sb
      .from("notifications")
      .select("*")
      .eq("owner_address", data.me.toLowerCase())
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (rows ?? []) as NotificationRow[];
  });

export const markNotifRead = createServerFn({ method: "POST" })
  .inputValidator((d: { me: string; id: string }) => d)
  .handler(async ({ data }) => {
    const sb = supabaseAdmin();
    await sb
      .from("notifications")
      .update({ read: true })
      .eq("id", data.id)
      .eq("owner_address", data.me.toLowerCase());
  });

export const markAllNotifsRead = createServerFn({ method: "POST" })
  .inputValidator((d: { me: string }) => d)
  .handler(async ({ data }) => {
    const sb = supabaseAdmin();
    await sb
      .from("notifications")
      .update({ read: true })
      .eq("owner_address", data.me.toLowerCase())
      .eq("read", false);
  });

export const deleteAlert = createServerFn({ method: "POST" })
  .inputValidator((d: { me: string; id: string }) => d)
  .handler(async ({ data }) => {
    const sb = supabaseAdmin();
    const { error } = await sb
      .from("alerts")
      .delete()
      .eq("id", data.id)
      .eq("owner_address", data.me.toLowerCase()); // owner guard
    if (error) throw new Error(error.message);
  });
