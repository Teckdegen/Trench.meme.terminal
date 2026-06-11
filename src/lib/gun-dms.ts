// Direct messages. Kept under the old module name so the Inbox and floating
// bubbles don't need to know whether the transport is Gun or Supabase.

import { createServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { supabaseAdmin } from "@/lib/supabase";
import { defaultAccountHandle, defaultDisplayName } from "@/lib/handles";

export const GUN_ENABLED = true;

export function dmChannelId(a: string, b: string): string {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
  return `dm:${x}:${y}`;
}

export type DMMessage = {
  id: string;
  sender: string;
  body: string;
  kind?: "text" | "image";
  ts: number;
  edited_at?: number | null;
  deleted?: boolean;
  deleted_by?: string | null;
  deleted_at?: number | null;
};

export type DMThread = {
  channelId: string;
  partner: string;
  lastBody: string;
  lastTs: number;
  lastSender: string;
  unread: number;
};

function cleanAddress(addr: string) {
  const out = addr.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(out)) throw new Error("Invalid wallet address.");
  return out;
}

function preview(body: string, kind: "text" | "image") {
  if (kind === "image") return "Photo";
  return body.length > 80 ? `${body.slice(0, 80)}...` : body;
}

async function ensureAccount(address: string) {
  const { error } = await supabaseAdmin().from("accounts").upsert({
    address,
    handle: defaultAccountHandle(address),
    display_name: defaultDisplayName(address),
  }, { onConflict: "address", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

function readStorageKey(me: string, channelId: string) {
  return `dm.read.${me.toLowerCase()}.${channelId}`;
}

function readUpTo(me: string, channelId: string) {
  if (typeof window === "undefined") return 0;
  return Number(localStorage.getItem(readStorageKey(me, channelId)) ?? 0);
}

export function markThreadRead(me: string, partner: string) {
  const channelId = dmChannelId(me, partner);
  if (typeof window !== "undefined") {
    localStorage.setItem(readStorageKey(me, channelId), String(Date.now()));
    window.dispatchEvent(new Event("dm-read"));
  }
}

const listThreads = createServerFn({ method: "POST" })
  .inputValidator((d: { me: string }) => d)
  .handler(async ({ data }) => {
    const me = cleanAddress(data.me);
    const { data: rows, error } = await supabaseAdmin()
      .from("dm_threads")
      .select("channel_id, owner_address, partner_address, last_body, last_ts, last_sender")
      .eq("owner_address", me)
      .order("last_ts", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      channelId: r.channel_id,
      partner: r.partner_address,
      lastBody: r.last_body ?? "",
      lastTs: r.last_ts ? +new Date(r.last_ts) : 0,
      lastSender: r.last_sender ?? "",
    }));
  });

const listMessages = createServerFn({ method: "POST" })
  .inputValidator((d: { me: string; partner: string }) => d)
  .handler(async ({ data }) => {
    const me = cleanAddress(data.me);
    const partner = cleanAddress(data.partner);
    const channelId = dmChannelId(me, partner);
    const { data: rows, error } = await supabaseAdmin()
      .from("dm_messages")
      .select("id, sender_address, body, kind, created_at, edited_at, deleted, deleted_by, deleted_at")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: true })
      .limit(300);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      sender: r.sender_address,
      body: r.deleted ? "" : (r.body ?? ""),
      kind: r.kind === "image" ? "image" : "text",
      ts: r.created_at ? +new Date(r.created_at) : 0,
      edited_at: r.edited_at ? +new Date(r.edited_at) : null,
      deleted: !!r.deleted,
      deleted_by: r.deleted_by ?? null,
      deleted_at: r.deleted_at ? +new Date(r.deleted_at) : null,
    }));
  });

const upsertThread = async (
  owner: string,
  partner: string,
  channelId: string,
  lastBody: string,
  lastSender: string,
) => {
  const { error } = await supabaseAdmin().from("dm_threads").upsert({
    channel_id: channelId,
    owner_address: owner,
    partner_address: partner,
    last_body: lastBody,
    last_sender: lastSender,
    last_ts: new Date().toISOString(),
  }, { onConflict: "owner_address,channel_id" });
  if (error) throw new Error(error.message);
};

const sendMessage = createServerFn({ method: "POST" })
  .inputValidator((d: { me: string; partner: string; body: string; kind?: "text" | "image" }) => d)
  .handler(async ({ data }) => {
    const me = cleanAddress(data.me);
    const partner = cleanAddress(data.partner);
    if (me === partner) throw new Error("Cannot message yourself");
    await Promise.all([ensureAccount(me), ensureAccount(partner)]);
    const kind = data.kind === "image" ? "image" : "text";
    const body = String(data.body ?? "").trim();
    if (!body) throw new Error("Message is empty.");
    const channelId = dmChannelId(me, partner);
    const { data: msg, error } = await supabaseAdmin().from("dm_messages").insert({
      channel_id: channelId,
      sender_address: me,
      body,
      kind,
    }).select("id, created_at").single();
    if (error) throw new Error(error.message);
    const last = preview(body, kind);
    await Promise.all([
      upsertThread(me, partner, channelId, last, me),
      upsertThread(partner, me, channelId, last, me),
    ]);
    return { id: (msg as any).id, ts: +(new Date((msg as any).created_at)) };
  });

const createThread = createServerFn({ method: "POST" })
  .inputValidator((d: { me: string; partner: string }) => d)
  .handler(async ({ data }) => {
    const me = cleanAddress(data.me);
    const partner = cleanAddress(data.partner);
    if (me === partner) throw new Error("Cannot message yourself");
    await Promise.all([ensureAccount(me), ensureAccount(partner)]);
    const channelId = dmChannelId(me, partner);
    await Promise.all([
      upsertThread(me, partner, channelId, "", me),
      upsertThread(partner, me, channelId, "", me),
    ]);
    return channelId;
  });

const deleteMessage = createServerFn({ method: "POST" })
  .inputValidator((d: { me: string; partner: string; id: string }) => d)
  .handler(async ({ data }) => {
    const me = cleanAddress(data.me);
    const partner = cleanAddress(data.partner);
    const channelId = dmChannelId(me, partner);
    const { error } = await supabaseAdmin().from("dm_messages")
      .update({ deleted: true, deleted_by: me, deleted_at: new Date().toISOString(), body: "" })
      .eq("id", data.id)
      .eq("channel_id", channelId)
      .eq("sender_address", me);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const editMessage = createServerFn({ method: "POST" })
  .inputValidator((d: { me: string; partner: string; id: string; body: string }) => d)
  .handler(async ({ data }) => {
    const me = cleanAddress(data.me);
    const partner = cleanAddress(data.partner);
    const channelId = dmChannelId(me, partner);
    const body = data.body.trim();
    const { error } = await supabaseAdmin().from("dm_messages")
      .update({ body, edited_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("channel_id", channelId)
      .eq("sender_address", me)
      .eq("deleted", false);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const removeThread = createServerFn({ method: "POST" })
  .inputValidator((d: { me: string; partner: string }) => d)
  .handler(async ({ data }) => {
    const me = cleanAddress(data.me);
    const partner = cleanAddress(data.partner);
    const { error } = await supabaseAdmin().from("dm_threads")
      .delete()
      .eq("owner_address", me)
      .eq("channel_id", dmChannelId(me, partner));
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export function useDMThreads(me: string | undefined): DMThread[] {
  const [threads, setThreads] = useState<DMThread[]>([]);
  const [readTick, setReadTick] = useState(0);

  useEffect(() => {
    const onRead = () => setReadTick((n) => n + 1);
    window.addEventListener("dm-read", onRead);
    return () => window.removeEventListener("dm-read", onRead);
  }, []);

  useEffect(() => {
    if (!me) { setThreads([]); return; }
    let cancel = false;
    const refresh = async () => {
      const rows = await listThreads({ data: { me } }).catch(() => []);
      if (cancel) return;
      setThreads(rows.map((r: any) => ({
        ...r,
        unread: r.lastSender !== me.toLowerCase() && r.lastTs > readUpTo(me, r.channelId) ? 1 : 0,
      })));
    };
    void refresh();
    const id = setInterval(refresh, 4_000);
    return () => { cancel = true; clearInterval(id); };
  }, [me, readTick]);

  return threads;
}

export function useDMMessages(me: string | undefined, partner: string | undefined): DMMessage[] {
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const channelId = useMemo(() => me && partner ? dmChannelId(me, partner) : "", [me, partner]);
  useEffect(() => {
    if (!me || !partner) { setMessages([]); return; }
    let cancel = false;
    const refresh = async () => {
      const rows = await listMessages({ data: { me, partner } }).catch(() => []);
      if (!cancel) setMessages(rows as DMMessage[]);
    };
    void refresh();
    const id = setInterval(refresh, 3_000);
    return () => { cancel = true; clearInterval(id); };
  }, [me, partner, channelId]);
  return messages;
}

export async function sendDM(me: string, partner: string, body: string, opts?: { kind?: "text" | "image" }) {
  await sendMessage({ data: { me, partner, body, kind: opts?.kind ?? "text" } });
}

export async function startDMThread(me: string, partner: string) {
  return createThread({ data: { me, partner } });
}

export async function deleteDMMessage(me: string, partner: string, msg: Pick<DMMessage, "id">) {
  await deleteMessage({ data: { me, partner, id: msg.id } });
}

export async function editDMMessage(
  me: string,
  partner: string,
  msg: Pick<DMMessage, "id">,
  newBody: string,
) {
  await editMessage({ data: { me, partner, id: msg.id, body: newBody } });
}

export async function deleteDMThread(me: string, partner: string) {
  await removeThread({ data: { me, partner } });
}
