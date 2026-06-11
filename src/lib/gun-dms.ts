// Decentralized DMs on Gun.js (encrypted). No Supabase.

import { useEffect, useMemo, useState } from "react";
import { GUN_ENABLED, NS, getGun } from "@/lib/gun-client";
import { gunPutAck, gunSend, useGunChat, gunDeleteMessage, gunEditMessage } from "@/lib/gun";

export { GUN_ENABLED };

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

function readStorageKey(me: string, channelId: string) {
  return `gun.read.${me.toLowerCase()}.${channelId}`;
}

const DM_MSG_CACHE = "gun.dm.messages.v1";
const DM_THREAD_CACHE = "gun.dm.threads.v1";

function loadMsgCache(channelId: string): DMMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const all = JSON.parse(localStorage.getItem(DM_MSG_CACHE) ?? "{}") as Record<string, DMMessage[]>;
    return all[channelId] ?? [];
  } catch { return []; }
}

function saveMsgCache(channelId: string, messages: DMMessage[]) {
  if (typeof window === "undefined") return;
  try {
    const all = JSON.parse(localStorage.getItem(DM_MSG_CACHE) ?? "{}") as Record<string, DMMessage[]>;
    all[channelId] = messages.slice(-300);
    localStorage.setItem(DM_MSG_CACHE, JSON.stringify(all));
  } catch { /* quota */ }
}

function loadThreadCache(me: string): DMThread[] {
  if (typeof window === "undefined") return [];
  try {
    const all = JSON.parse(localStorage.getItem(DM_THREAD_CACHE) ?? "{}") as Record<string, DMThread[]>;
    return all[me.toLowerCase()] ?? [];
  } catch { return []; }
}

function saveThreadCache(me: string, threads: DMThread[]) {
  if (typeof window === "undefined") return;
  try {
    const all = JSON.parse(localStorage.getItem(DM_THREAD_CACHE) ?? "{}") as Record<string, DMThread[]>;
    all[me.toLowerCase()] = threads.slice(0, 100);
    localStorage.setItem(DM_THREAD_CACHE, JSON.stringify(all));
  } catch { /* quota */ }
}

export function markThreadRead(me: string, partner: string) {
  const channelId = dmChannelId(me, partner);
  if (typeof window !== "undefined") {
    localStorage.setItem(readStorageKey(me, channelId), String(Date.now()));
    window.dispatchEvent(new Event("gun-dm-read"));
  }
}

function unreadFor(me: string, channelId: string, lastSender: string, lastTs: number, partner: string) {
  if (!lastTs || lastSender === me.toLowerCase()) return 0;
  if (lastSender !== partner.toLowerCase()) return 0;
  const readUp = typeof window !== "undefined"
    ? Number(localStorage.getItem(readStorageKey(me, channelId)) ?? 0)
    : 0;
  return lastTs > readUp ? 1 : 0;
}

// Optimistic overlay so sent messages appear instantly while Gun syncs.
const optimisticByChannel = new Map<string, DMMessage[]>();
const optimisticSubs = new Set<() => void>();

function bumpOptimistic() {
  optimisticSubs.forEach((fn) => fn());
}

function persistDmMessage(channelId: string, msg: DMMessage) {
  const existing = loadMsgCache(channelId);
  const byId = new Map(existing.map((m) => [m.id, m]));
  byId.set(msg.id, msg);
  saveMsgCache(channelId, [...byId.values()].sort((a, b) => a.ts - b.ts));
}

function toDmMessage(m: {
  id: string;
  sender: string;
  body: string;
  kind?: string;
  ts: number;
  edited_at?: number | null;
  deleted?: boolean;
  deleted_by?: string | null;
  deleted_at?: number | null;
}): DMMessage {
  return {
    id: m.id,
    sender: m.sender,
    body: m.body,
    kind: (m.kind === "image" ? "image" : "text") as "text" | "image",
    ts: m.ts,
    edited_at: m.edited_at ?? null,
    deleted: m.deleted,
    deleted_by: m.deleted_by ?? null,
    deleted_at: m.deleted_at ?? null,
  };
}

export function useDMMessages(me: string | undefined, partner: string | undefined): DMMessage[] {
  const channelId = me && partner ? dmChannelId(me, partner) : undefined;
  const raw = useGunChat("dm", channelId);
  const [optTick, setOptTick] = useState(0);

  useEffect(() => {
    const bump = () => setOptTick((n) => n + 1);
    optimisticSubs.add(bump);
    return () => { optimisticSubs.delete(bump); };
  }, []);

  useEffect(() => {
    if (!channelId || !raw?.length) return;
    const optimistic = optimisticByChannel.get(channelId) ?? [];
    if (!optimistic.length) return;
    const synced = new Set(raw.map((m) => m.id));
    const next = optimistic.filter((m) => !synced.has(m.id));
    if (next.length === optimistic.length) return;
    if (next.length) optimisticByChannel.set(channelId, next);
    else optimisticByChannel.delete(channelId);
    bumpOptimistic();
  }, [channelId, raw]);

  const cached = channelId ? loadMsgCache(channelId) : [];
  const gunMsgs = (raw ?? []).map(toDmMessage);
  const optimistic = channelId ? (optimisticByChannel.get(channelId) ?? []) : [];
  void optTick;
  const merged = useMemo(() => {
    const byId = new Map<string, DMMessage>();
    for (const m of [...cached, ...gunMsgs, ...optimistic]) byId.set(m.id, m);
    return [...byId.values()].sort((a, b) => a.ts - b.ts);
  }, [cached, gunMsgs, optimistic, optTick]);

  useEffect(() => {
    if (!channelId || merged.length === 0) return;
    saveMsgCache(channelId, merged);
  }, [channelId, merged]);

  return merged;
}

function dmPreview(body: string, kind: "text" | "image") {
  if (kind === "image") return "📷 Photo";
  return body.length > 80 ? `${body.slice(0, 80)}…` : body;
}

export async function sendDM(
  me: string,
  partner: string,
  body: string,
  opts?: { kind?: "text" | "image" },
) {
  if (!GUN_ENABLED) return;
  if (me.toLowerCase() === partner.toLowerCase()) {
    throw new Error("Cannot message yourself");
  }
  const kind = opts?.kind ?? "text";
  const channelId = dmChannelId(me, partner);
  const id = crypto.randomUUID();
  const ts = Date.now();
  const optimistic = toDmMessage({
    id,
    sender: me.toLowerCase(),
    body,
    kind,
    ts,
  });
  const pending = optimisticByChannel.get(channelId) ?? [];
  optimisticByChannel.set(channelId, [...pending, optimistic]);
  bumpOptimistic();
  persistDmMessage(channelId, optimistic);
  try {
    await gunSend("dm", channelId, {
      id,
      sender: me.toLowerCase(),
      body,
      kind,
      ts,
    });
    const preview = dmPreview(body, kind);
    const gun = await getGun();
    if (!gun) throw new Error("Gun relay unavailable");
    const threadPut = {
      channelId,
      partner: "",
      lastBody: preview,
      lastTs: ts,
      lastSender: me.toLowerCase(),
    };
    await Promise.all([
      gunPutAck(gun.get(NS).get("threads").get(me.toLowerCase()).get(channelId), {
        ...threadPut,
        partner: partner.toLowerCase(),
      }),
      gunPutAck(gun.get(NS).get("threads").get(partner.toLowerCase()).get(channelId), {
        ...threadPut,
        partner: me.toLowerCase(),
      }),
    ]);
  } catch (e) {
    const next = (optimisticByChannel.get(channelId) ?? []).filter((m) => m.id !== id);
    if (next.length) optimisticByChannel.set(channelId, next);
    else optimisticByChannel.delete(channelId);
    saveMsgCache(channelId, loadMsgCache(channelId).filter((m) => m.id !== id));
    bumpOptimistic();
    throw e;
  }
}

export function useDMThreads(me: string | undefined): DMThread[] {
  const [threads, setThreads] = useState<DMThread[]>(() =>
    me ? loadThreadCache(me) : [],
  );
  const [readTick, setReadTick] = useState(0);

  useEffect(() => {
    const onRead = () => setReadTick((n) => n + 1);
    window.addEventListener("gun-dm-read", onRead);
    return () => window.removeEventListener("gun-dm-read", onRead);
  }, []);

  useEffect(() => {
    if (!GUN_ENABLED || !me) return;
    let cancel = false;
    const map = new Map<string, DMThread>();

    (async () => {
      const gun = await getGun();
      if (!gun || cancel) return;
      const applyThread = (data: any, key: string) => {
        if (key === "_") return;
        if (!data || typeof data !== "object" || !data.partner) {
          map.delete(key);
        } else {
          const channelId = data.channelId ?? key;
          const partner = data.partner as string;
          const lastTs = Number(data.lastTs ?? 0);
          const lastSender = (data.lastSender ?? "") as string;
          map.set(key, {
            channelId,
            partner,
            lastBody: data.lastBody ?? "",
            lastTs,
            lastSender,
            unread: unreadFor(me, channelId, lastSender, lastTs, partner),
          });
        }
        if (!cancel) {
          const next = [...map.values()].sort((a, b) => b.lastTs - a.lastTs);
          setThreads(next);
          saveThreadCache(me, next);
        }
      };

      gun.get(NS).get("threads").get(me.toLowerCase()).map().once(applyThread);
      gun.get(NS).get("threads").get(me.toLowerCase()).map().on(applyThread);
    })();
    return () => { cancel = true; };
  }, [me, readTick]);

  return threads;
}

export async function startDMThread(me: string, partner: string) {
  if (!GUN_ENABLED) return null;
  if (me.toLowerCase() === partner.toLowerCase()) {
    throw new Error("Cannot message yourself");
  }
  const channelId = dmChannelId(me, partner);
  const ts = Date.now();
  const gun = await getGun();
  if (!gun) return null;
  const row = { channelId, partner: partner.toLowerCase(), lastBody: "", lastTs: ts, lastSender: me.toLowerCase() };
  await Promise.all([
    gunPutAck(gun.get(NS).get("threads").get(me.toLowerCase()).get(channelId), row),
    gunPutAck(gun.get(NS).get("threads").get(partner.toLowerCase()).get(channelId), {
      ...row,
      partner: me.toLowerCase(),
    }),
  ]);
  return channelId;
}

export async function deleteDMMessage(
  me: string,
  partner: string,
  msg: Pick<DMMessage, "id" | "sender" | "ts">,
) {
  if (!GUN_ENABLED) return;
  const channelId = dmChannelId(me, partner);
  const mine = msg.sender.toLowerCase() === me.toLowerCase();
  if (!mine) throw new Error("Can only delete your own messages");
  await gunDeleteMessage("dm", channelId, {
    id: msg.id,
    sender: msg.sender,
    ts: msg.ts,
    kind: "text",
  }, me);
}

export async function editDMMessage(
  me: string,
  partner: string,
  msg: Pick<DMMessage, "id" | "sender" | "ts">,
  newBody: string,
) {
  if (!GUN_ENABLED) return;
  if (msg.sender.toLowerCase() !== me.toLowerCase()) {
    throw new Error("Can only edit your own messages");
  }
  const channelId = dmChannelId(me, partner);
  await gunEditMessage("dm", channelId, {
    id: msg.id,
    sender: msg.sender,
    ts: msg.ts,
    kind: "text",
  }, newBody.trim());
}

/** Remove a DM thread from your inbox (messages stay on Gun for the other party). */
export async function deleteDMThread(me: string, partner: string) {
  if (!GUN_ENABLED) return;
  const channelId = dmChannelId(me, partner);
  const gun = await getGun();
  if (!gun) return;
  await gunPutAck(gun.get(NS).get("threads").get(me.toLowerCase()).get(channelId), null);
}
