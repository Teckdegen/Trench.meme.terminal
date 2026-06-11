// Cabals — groups on Gun.js only. Voice sub-rooms + watchlist live under each cabal.
// Trade alerts are pushed by the indexer via gun-write.ts.

import { useEffect, useState } from "react";
import { GUN_ENABLED, NS, getGun } from "@/lib/gun-client";
import {
  bootstrapCabalKey,
  loadCabalKey,
  inviteMemberToCabal,
  retryPendingInvites,
  kickMemberFromCabal as revokeCabalMemberKey,
  rotateCabalKey,
  clearCabalKeyCache,
} from "@/lib/cabal-crypto";

export { GUN_ENABLED };
import {
  GUN_ENABLED as GUN_CHAT,
  useGunChat,
  gunSend,
  gunPutAck,
  gunDeleteMessage,
  gunEditMessage,
  gunToggleReaction,
  useGunReactions,
  gunSetTyping,
  useGunTyping,
  type GunMessage,
} from "@/lib/gun";
import { sendDM } from "@/lib/gun-dms";

export type CabalMeta = {
  id: string;
  name: string;
  topic: string | null;
  image_uri: string | null;
  host_address: string;
  privacy: "invite" | "public";
  invite_code: string;
  is_live: boolean;
  created_at: number;
};

export type CabalMember = {
  account_address: string;
  role: "owner" | "mod" | "member";
  trade_feed_enabled: boolean;
  joined_at: number;
};

export type CabalRoom = {
  id: string;
  cabal_id: string;
  name: string;
  topic: string | null;
  created_by: string;
  is_live: boolean;
  agora_channel: string | null;
  participant_count: number;
  created_at: number;
};

export type WatchlistEntry = {
  cabal_id: string;
  token_address: string;
  added_by: string;
  alert_on_buy: boolean;
  alert_on_sell: boolean;
  alert_on_launch: boolean;
  min_value_usd: number;
  added_at: number;
};

export type ChatMessage = {
  id: string;
  sender: string;
  sender_address: string;
  body: string;
  kind: "text" | "trade" | "system";
  meta?: Record<string, unknown> | null;
  ts: number;
  source: "gun";
  reply_to?: string | null;
  reply_preview?: string | null;
  sig?: string | null;
  verified?: boolean;
  edited_at?: number | null;
  deleted?: boolean;
  deleted_by?: string | null;
  deleted_at?: number | null;
};

function cabalNode(gun: any, cabalId: string) {
  return gun.get(NS).get("cabals").get(cabalId);
}

function genInviteCode() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

function normalizeInviteCode(code: string) {
  return String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-8);
}

async function gunPutBestEffort(node: any, payload: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve();
    }, 2_500);
    node.put(payload, (ack: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ack?.err) reject(new Error(String(ack.err)));
      else resolve();
    });
  });
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function cabalInviteMessage(inviter: string, cabal: Pick<CabalMeta, "name" | "invite_code">) {
  return [
    `${shortAddr(inviter)} invited you to join ${cabal.name}.`,
    "",
    `Invite code: ${cabal.invite_code}`,
    "",
    "Open Cabals and paste the code to join.",
  ].join("\n");
}

async function sendCabalInviteDM(inviter: string, invitee: string, cabal: CabalMeta) {
  if (inviter.toLowerCase() === invitee.toLowerCase()) return;
  try {
    await sendDM(inviter, invitee, cabalInviteMessage(inviter, cabal));
  } catch (e) {
    console.warn("[cabal] invite DM failed", e);
  }
}

// ─────────────── Cabal list / CRUD ─────────────────────────────────────

export function useMyCabals(me: string | undefined) {
  const [cabals, setCabals] = useState<CabalMeta[]>([]);

  useEffect(() => {
    if (!GUN_ENABLED || !me) return;
    let cancel = false;
    const ids = new Set<string>();

    const loadMeta = async (gun: any, cabalId: string) => {
      const meta = await new Promise<CabalMeta | null>((res) => {
        cabalNode(gun, cabalId).get("meta").once((d: CabalMeta) => res(d ?? null));
      });
      return meta;
    };

    (async () => {
      const gun = await getGun();
      if (!gun || cancel) return;

      const refresh = async () => {
        const metas: CabalMeta[] = [];
        for (const id of ids) {
          const m = await loadMeta(gun, id);
          if (m) metas.push(m);
        }
        if (!cancel) {
          setCabals(metas.sort((a, b) => b.created_at - a.created_at));
        }
      };

      // Personal cabal list — both add AND remove. Gun fires the listener
      // with `data === null` when a cabal is removed (via leaveCabal). The
      // previous code only added, so left cabals stuck around forever.
      gun.get(NS).get("users").get(me.toLowerCase()).get("cabals").map().on((data: any, key: string) => {
        if (key === "_") return;
        if (data) ids.add(key);
        else ids.delete(key);
        void refresh();
      });

    })();

    return () => { cancel = true; };
  }, [me]);

  return cabals;
}

export async function createCabal(input: {
  name: string;
  topic?: string;
  image_uri?: string;
  host_address: string;
  privacy: "invite" | "public";
  invitees?: string[];
}): Promise<CabalMeta | null> {
  if (!GUN_ENABLED) return null;
  const gun = await getGun();
  if (!gun) return null;

  const id = crypto.randomUUID();
  const invite_code = genInviteCode();
  const host = input.host_address.toLowerCase();
  const meta: CabalMeta = {
    id,
    name: input.name.trim() || "Cabal",
    topic: input.topic?.trim() || null,
    image_uri: input.image_uri?.trim() || null,
    host_address: host,
    privacy: input.privacy,
    invite_code,
    is_live: true,
    created_at: Date.now(),
  };

  await gunPutAck(cabalNode(gun, id).get("meta"), meta);
  await gunPutAck(gun.get(NS).get("cabals").get("by-code").get(invite_code), id);
  await joinCabal(id, host, "owner");

  // Mint the cabal's symmetric AES-256 key and wrap it for the creator.
  // From this point on, all chat bodies are AES-GCM encrypted with this key
  // — the Gun relay only ever sees ciphertext.
  try {
    await bootstrapCabalKey(id, host);
  } catch (e) {
    console.warn("[cabal] bootstrapCabalKey failed", e);
  }

  for (const inv of input.invitees ?? []) {
    const addr = inv.replace(/^@/, "").trim().toLowerCase();
    if (addr && /^0x[a-f0-9]{40}$/.test(addr)) {
      try {
        await inviteAddressToCabal(meta, host, addr);
      } catch (e) {
        console.warn("[cabal] invite failed", e);
      }
    }
  }

  return meta;
}

export async function inviteAddressToCabal(
  cabal: CabalMeta,
  inviter: string,
  invitee: string,
): Promise<{ status: "granted" | "pending" | "dm_only" }> {
  const host = inviter.toLowerCase();
  const addr = invitee.replace(/^@/, "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) throw new Error("Invalid invitee address");

  await joinCabal(cabal.id, addr, "member");
  let status: "granted" | "pending" | "dm_only" = "dm_only";
  try {
    const res = await inviteMemberToCabal(cabal.id, host, addr);
    status = res.status;
  } catch (e) {
    console.warn("[cabal] key grant failed; invite code DM still sent", e);
  }
  await sendCabalInviteDM(host, addr, cabal);
  return { status };
}

/** Patch a cabal's editable meta fields (name, topic, image_uri). Owner
 *  only — Gun has no auth, so we just refuse client-side if me ≠ host. */
export async function updateCabalMeta(
  id: string,
  me: string,
  patch: { name?: string; topic?: string | null; image_uri?: string | null },
): Promise<void> {
  if (!GUN_ENABLED) return;
  const gun = await getGun();
  if (!gun) return;
  // Read the current meta synchronously off the cache, then merge.
  await new Promise<void>((resolve) => {
    cabalNode(gun, id).get("meta").once((cur: any) => {
      if (!cur) return resolve();
      const host = (cur.host_address ?? "").toLowerCase();
      if (host !== me.toLowerCase()) {
        console.warn("[updateCabalMeta] refused — not host");
        return resolve();
      }
      const next: CabalMeta = {
        id: cur.id,
        host_address: host,
        privacy: cur.privacy,
        invite_code: cur.invite_code,
        is_live: cur.is_live ?? true,
        created_at: cur.created_at,
        name: (patch.name ?? cur.name ?? "Cabal").trim() || "Cabal",
        topic: patch.topic !== undefined ? (patch.topic ?? null) : (cur.topic ?? null),
        image_uri: patch.image_uri !== undefined ? (patch.image_uri ?? null) : (cur.image_uri ?? null),
      };
      cabalNode(gun, id).get("meta").put(next, () => resolve());
    });
  });
}

export async function joinCabalByCode(code: string, me: string): Promise<CabalMeta | null> {
  if (!GUN_ENABLED) return null;
  const gun = await getGun();
  if (!gun) return null;
  const cleanCode = normalizeInviteCode(code);
  if (!cleanCode) throw new Error("Enter a valid invite code");
  const cabalId = await new Promise<string | null>((res) => {
    gun.get(NS).get("cabals").get("by-code").get(cleanCode).once((id: string) => res(id ?? null));
  });
  const resolvedId = cabalId || await findCabalIdByInviteCode(gun, cleanCode);
  if (!resolvedId) return null;
  await joinCabal(resolvedId, me, "member");
  const meta = await new Promise<CabalMeta | null>((res) => {
    cabalNode(gun, resolvedId).get("meta").once((d: CabalMeta) => res(d ?? null));
  });
  return meta;
}

async function findCabalIdByInviteCode(gun: any, code: string): Promise<string | null> {
  return await new Promise<string | null>((resolve) => {
    let done = false;
    const finish = (id: string | null) => {
      if (done) return;
      done = true;
      resolve(id);
    };
    gun.get(NS).get("cabals").map().once((node: any, id: string) => {
      if (done || id === "_" || id === "by-code" || id === "public" || !node) return;
      cabalNode(gun, id).get("meta").once((meta: CabalMeta | null) => {
        if (normalizeInviteCode(meta?.invite_code ?? "") === code) finish(id);
      });
    });
    setTimeout(() => finish(null), 1_200);
  });
}

export async function joinCabal(cabalId: string, me: string, role: CabalMember["role"] = "member") {
  if (!GUN_ENABLED) return;
  const gun = await getGun();
  if (!gun) return;
  const addr = me.toLowerCase();
  const row: CabalMember = {
    account_address: addr,
    role,
    trade_feed_enabled: true,
    joined_at: Date.now(),
  };
  await gunPutBestEffort(cabalNode(gun, cabalId).get("members").get(addr), row);
  await gunPutBestEffort(gun.get(NS).get("users").get(addr).get("cabals").get(cabalId), {
    joined_at: row.joined_at,
    trade_feed_enabled: row.trade_feed_enabled,
  });
}

export async function leaveCabal(cabalId: string, me: string) {
  if (!GUN_ENABLED) return;
  const gun = await getGun();
  if (!gun) return;
  const addr = me.toLowerCase();
  cabalNode(gun, cabalId).get("members").get(addr).put(null);
  gun.get(NS).get("users").get(addr).get("cabals").get(cabalId).put(null);
  try {
    const { supabase } = await import("@/lib/supabase");
    await supabase().from("cabal_key_grants").delete().eq("cabal_id", cabalId).eq("account", addr);
  } catch { /* offline */ }
  clearCabalKeyCache(cabalId);
}

/** Owner-only: disband the cabal for everyone. */
export async function deleteCabal(cabalId: string, me: string, meta: CabalMeta) {
  if (!GUN_ENABLED) {
    throw new Error("Chat relay not configured — set VITE_GUN_PEERS in your env.");
  }
  if (me.toLowerCase() !== meta.host_address.toLowerCase()) {
    throw new Error("Only the cabal owner can delete it");
  }
  const gun = await getGun();
  if (!gun) {
    throw new Error("Couldn't connect to chat relay. Check VITE_GUN_PEERS URL.");
  }

  const memberAddrs = await new Promise<string[]>((res) => {
    const addrs: string[] = [];
    cabalNode(gun, cabalId).get("members").map().once((data: CabalMember | null, key: string) => {
      if (key === "_") return;
      if (data?.account_address) addrs.push(data.account_address.toLowerCase());
    });
    setTimeout(() => res(addrs), 400);
  });

  for (const addr of memberAddrs) {
    cabalNode(gun, cabalId).get("members").get(addr).put(null);
    gun.get(NS).get("users").get(addr).get("cabals").get(cabalId).put(null);
  }

  cabalNode(gun, cabalId).get("meta").put(null);
  if (meta.invite_code) {
    gun.get(NS).get("cabals").get("by-code").get(meta.invite_code).put(null);
  }
  if (meta.privacy === "public") {
    gun.get(NS).get("cabals").get("public").get(cabalId).put(null);
  }

  try {
    const { supabase } = await import("@/lib/supabase");
    await supabase().from("cabal_key_grants").delete().eq("cabal_id", cabalId);
    await supabase().from("pending_cabal_invites").delete().eq("cabal_id", cabalId);
  } catch { /* offline */ }
  clearCabalKeyCache(cabalId);
}

/** Kick a member: revoke encryption key, rotate, and remove Gun membership. */
export async function kickMemberFromCabal(cabalId: string, me: string, target: string) {
  await revokeCabalMemberKey(cabalId, me, target);
  if (!GUN_ENABLED) return;
  const gun = await getGun();
  if (!gun) return;
  const addr = target.toLowerCase();
  cabalNode(gun, cabalId).get("members").get(addr).put(null);
  gun.get(NS).get("users").get(addr).get("cabals").get(cabalId).put(null);
}

export function useCabalMembers(cabalId: string | undefined) {
  const [members, setMembers] = useState<CabalMember[]>([]);
  useEffect(() => {
    if (!GUN_ENABLED || !cabalId) return;
    let cancel = false;
    const map = new Map<string, CabalMember>();
    (async () => {
      const gun = await getGun();
      if (!gun || cancel) return;
      cabalNode(gun, cabalId).get("members").map().on((data: CabalMember | null, key: string) => {
        if (key === "_") return;
        if (data?.account_address) map.set(key, data);
        else map.delete(key);
        if (!cancel) setMembers([...map.values()]);
      });
    })();
    return () => { cancel = true; };
  }, [cabalId]);
  return members;
}

// ─────────────── Voice sub-rooms (inside a cabal only) ───────────────

export function useCabalRooms(cabalId: string | undefined) {
  const [rooms, setRooms] = useState<CabalRoom[]>([]);
  useEffect(() => {
    if (!GUN_ENABLED || !cabalId) return;
    let cancel = false;
    const map = new Map<string, CabalRoom>();
    (async () => {
      const gun = await getGun();
      if (!gun || cancel) return;
      cabalNode(gun, cabalId).get("voice").map().on((data: CabalRoom, key: string) => {
        if (key === "_") return;
        // Add when data exists, remove on tombstone (Gun null) — otherwise
        // deleted rooms linger in the sidebar forever.
        if (data?.name) map.set(key, { ...data, id: data.id ?? key, cabal_id: cabalId });
        else map.delete(key);
        if (!cancel) {
          setRooms([...map.values()].sort((a, b) => b.created_at - a.created_at));
        }
      });
    })();
    return () => { cancel = true; };
  }, [cabalId]);
  return rooms;
}

export async function createCabalRoom(
  cabalId: string,
  me: string,
  name: string,
  topic?: string,
): Promise<CabalRoom | null> {
  if (!GUN_ENABLED) return null;
  const gun = await getGun();
  if (!gun) return null;
  const id = crypto.randomUUID();
  const room: CabalRoom = {
    id,
    cabal_id: cabalId,
    name: name.trim(),
    topic: topic ?? null,
    created_by: me.toLowerCase(),
    is_live: true,
    agora_channel: crypto.randomUUID(),
    participant_count: 0,
    created_at: Date.now(),
  };
  cabalNode(gun, cabalId).get("voice").get(id).put(room);
  return room;
}

export async function endCabalRoom(cabalId: string, roomId: string) {
  if (!GUN_ENABLED) return;
  const gun = await getGun();
  if (!gun) return;
  cabalNode(gun, cabalId).get("voice").get(roomId).get("is_live").put(false);
  cabalNode(gun, cabalId).get("voice").get(roomId).get("agora_channel").put(null);
}

/** Fully delete a voice room. Only the cabal owner (or the room creator) should call this. */
export async function deleteCabalRoom(cabalId: string, roomId: string) {
  if (!GUN_ENABLED) return;
  const gun = await getGun();
  if (!gun) return;
  cabalNode(gun, cabalId).get("voice").get(roomId).put(null);
}

// ─────────────── Watchlist (owner pins tokens → indexer alerts) ───────

export function useCabalWatchlist(cabalId: string | undefined) {
  const [list, setList] = useState<WatchlistEntry[]>([]);
  useEffect(() => {
    if (!GUN_ENABLED || !cabalId) return;
    let cancel = false;
    const map = new Map<string, WatchlistEntry>();
    (async () => {
      const gun = await getGun();
      if (!gun || cancel) return;
      cabalNode(gun, cabalId).get("watchlist").map().on((data: WatchlistEntry, key: string) => {
        if (data?.token_address) map.set(key, data);
        if (!cancel) setList([...map.values()].sort((a, b) => b.added_at - a.added_at));
      });
    })();
    return () => { cancel = true; };
  }, [cabalId]);
  return list;
}

export async function addWatchlist(
  cabalId: string,
  me: string,
  tokenAddress: string,
  opts: Partial<Pick<WatchlistEntry, "alert_on_buy" | "alert_on_sell" | "alert_on_launch" | "min_value_usd">> = {},
) {
  if (!GUN_ENABLED) return;
  const gun = await getGun();
  if (!gun) return;
  const token = tokenAddress.toLowerCase();
  const entry: WatchlistEntry = {
    cabal_id: cabalId,
    token_address: token,
    added_by: me.toLowerCase(),
    alert_on_buy: opts.alert_on_buy ?? true,
    alert_on_sell: opts.alert_on_sell ?? true,
    alert_on_launch: opts.alert_on_launch ?? false,
    min_value_usd: opts.min_value_usd ?? 50,
    added_at: Date.now(),
  };
  cabalNode(gun, cabalId).get("watchlist").get(token).put(entry);
  gun.get(NS).get("index").get("watch").get("tokens").get(token).get("cabals").get(cabalId).put({
    alert_on_buy: entry.alert_on_buy,
    alert_on_sell: entry.alert_on_sell,
    min_value_usd: entry.min_value_usd,
  });
}

export async function removeWatchlist(cabalId: string, tokenAddress: string) {
  if (!GUN_ENABLED) return;
  const gun = await getGun();
  if (!gun) return;
  const token = tokenAddress.toLowerCase();
  cabalNode(gun, cabalId).get("watchlist").get(token).put(null);
  gun.get(NS).get("index").get("watch").get("tokens").get(token).get("cabals").get(cabalId).put(null);
}

// ─────────────── Cabal chat (Gun + SEA, trades from indexer) ─────────

function safeJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch { return {}; }
}

/**
 * Subscribe to a cabal's chat. Loads the per-cabal AES key first (unwrapped
 * from cabal_key_grants with the user's private key) so message bodies
 * decrypt automatically. Without the key, the user sees ciphertext.
 */
export function useCabalChat(cabalId: string | undefined, me?: string): ChatMessage[] {
  const [keyReady, setKeyReady] = useState(false);
  useEffect(() => {
    if (!cabalId || !me) return;
    let cancel = false;
    loadCabalKey(cabalId, me)
      .then(() => { if (!cancel) setKeyReady(true); })
      .catch(() => { /* user not a member — gun layer falls through */ });
    return () => { cancel = true; };
  }, [cabalId, me]);
  // Only subscribe once the key is loaded (or if no `me` was passed — legacy callers)
  const gun = useGunChat("cabal", (me && !keyReady) ? undefined : cabalId);
  return (gun ?? []).map((m: GunMessage) => ({
    id: m.id,
    sender: m.sender,
    sender_address: m.sender,
    body: m.body,
    kind: m.kind ?? "text",
    meta: typeof m.meta === "string" ? safeJson(m.meta) : (m.meta as Record<string, unknown> | null),
    ts: m.ts,
    source: "gun" as const,
    reply_to: m.reply_to ?? null,
    reply_preview: m.reply_preview ?? null,
    sig: m.sig ?? null,
    verified: m.verified,
    edited_at: m.edited_at ?? null,
    deleted: m.deleted,
    deleted_by: m.deleted_by ?? null,
    deleted_at: m.deleted_at ?? null,
  }));
}

export async function sendCabalChat(
  cabalId: string,
  me: string,
  body: string,
  opts: { reply_to?: string | null; reply_preview?: string | null } = {},
) {
  if (!GUN_CHAT) {
    console.warn("[cabal] Gun not configured — set VITE_GUN_PEERS to your relay.");
    return;
  }
  // Ensure the cabal key is loaded so gunSend's encryptText uses the real
  // shared key, not the PBKDF2 fallback.
  try { await loadCabalKey(cabalId, me); } catch { /* not a member */ }
  await gunSend("cabal", cabalId, {
    id: crypto.randomUUID(),
    sender: me.toLowerCase(),
    body,
    kind: "text",
    reply_to: opts.reply_to ?? null,
    reply_preview: opts.reply_preview ?? null,
  });
}

export async function deleteCabalMessage(
  cabalId: string,
  me: string,
  msg: Pick<ChatMessage, "id" | "sender_address" | "ts" | "kind" | "reply_to">,
  opts: { isOwner?: boolean } = {},
) {
  const mine = msg.sender_address.toLowerCase() === me.toLowerCase();
  if (!mine && !opts.isOwner) throw new Error("Cannot delete this message");
  try { await loadCabalKey(cabalId, me); } catch { /* best effort */ }
  await gunDeleteMessage("cabal", cabalId, {
    id: msg.id,
    sender: msg.sender_address,
    ts: msg.ts,
    kind: msg.kind,
    reply_to: msg.reply_to ?? null,
  }, me);
}

export async function editCabalMessage(
  cabalId: string,
  me: string,
  msg: Pick<ChatMessage, "id" | "sender_address" | "ts" | "kind" | "reply_to" | "reply_preview">,
  newBody: string,
) {
  if (msg.sender_address.toLowerCase() !== me.toLowerCase()) {
    throw new Error("Can only edit your own messages");
  }
  try { await loadCabalKey(cabalId, me); } catch { /* not a member */ }
  await gunEditMessage("cabal", cabalId, {
    id: msg.id,
    sender: msg.sender_address,
    ts: msg.ts,
    kind: msg.kind,
    reply_to: msg.reply_to ?? null,
    reply_preview: msg.reply_preview ?? null,
  }, newBody.trim());
}

// ─────────────── Discord-style extras (reactions, typing) ────────────
export function toggleCabalReaction(cabalId: string, messageId: string, emoji: string, me: string, on: boolean) {
  return gunToggleReaction("cabal", cabalId, messageId, emoji, me, on);
}
export function useCabalReactions(cabalId: string | undefined) {
  return useGunReactions("cabal", cabalId);
}
export function setCabalTyping(cabalId: string, me: string) {
  return gunSetTyping("cabal", cabalId, me);
}
export function useCabalTyping(cabalId: string | undefined, me: string | undefined) {
  return useGunTyping("cabal", cabalId, me);
}

// Re-export crypto-side ops so UI can call them
export { inviteMemberToCabal, retryPendingInvites, rotateCabalKey };

// ─────────────── Pending invites (Supabase-backed) ───────────────────
export function usePendingInvites(cabalId: string | undefined, me: string | undefined) {
  const [pending, setPending] = useState<Array<{ invitee: string; created_at: string }>>([]);
  useEffect(() => {
    if (!cabalId || !me) return;
    let cancel = false;
    const load = async () => {
      const { supabase } = await import("@/lib/supabase");
      const { data } = await supabase().from("pending_cabal_invites")
        .select("invitee, created_at")
        .eq("cabal_id", cabalId)
        .eq("granted_by", me.toLowerCase());
      if (!cancel) setPending((data as any) ?? []);
    };
    void load();
    const iv = setInterval(load, 15_000);
    return () => { cancel = true; clearInterval(iv); };
  }, [cabalId, me]);
  return pending;
}

export function updateChatMessageType() { /* type re-export hook for callers */ }

export function useCabalPreview(cabalId: string) {
  const messages = useCabalChat(cabalId);
  const last = messages.length ? messages[messages.length - 1] : null;
  return last;
}
