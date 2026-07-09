// Gun.js message streams for cabals, DMs, and token chats (encrypted bodies).

import { useEffect, useState } from "react";
import {
  GUN_ENABLED,
  NS,
  getGun,
  encryptText,
  decryptText,
  type GunPutMessage,
} from "@/lib/gun-client";

export type { GunPutMessage as GunMessage };
export { GUN_ENABLED };

function messagesNode(gun: any, scope: "cabal" | "dm" | "token", id: string) {
  return gun.get(NS).get(scope).get(id).get("messages");
}

export function gunPutAck(node: any, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn("[gun] relay did not acknowledge the write; continuing with local state.");
      resolve();
    }, 8_000);
    node.put(payload, (ack: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ack?.err) reject(new Error(String(ack.err)));
      else resolve();
    });
  });
}

export function useGunChat(
  scope: "cabal" | "dm" | "token",
  id: string | undefined,
): GunPutMessage[] | null {
  const [messages, setMessages] = useState<GunPutMessage[] | null>(GUN_ENABLED ? null : []);

  useEffect(() => {
    if (!GUN_ENABLED || !id) {
      setMessages([]);
      return;
    }
    let cancel = false;
    let gen = 0;
    let detachFocus: (() => void) | null = null;
    let repullInterval: ReturnType<typeof setInterval> | null = null;
    const map = new Map<string, GunPutMessage>();

    (async () => {
      const gun = await getGun();
      if (!gun || cancel) return;
      const node = messagesNode(gun, scope, id);
      const myGen = ++gen;
      const publish = () => {
        if (!cancel && myGen === gen) {
          setMessages([...map.values()].sort((a, b) => a.ts - b.ts));
        }
      };

      const ingest = async (data: any, key: string) => {
        if (cancel || myGen !== gen) return;
        if (key === "_") return;
        if (data == null) {
          map.delete(key);
          publish();
          return;
        }
        // Gun sometimes delivers a soul ref before the object is hydrated.
        if (typeof data !== "object") {
          node.get(key).once((resolved: any) => {
            if (resolved && typeof resolved === "object") void ingest(resolved, key);
          });
          return;
        }

        const ts = Number(data.ts ?? 0);
        const sender = (data.sender ?? "").toLowerCase();
        const msgId = data.id ?? key;

        if (data.deleted) {
          map.set(msgId, {
            id: msgId,
            sender,
            body: "",
            kind: data.kind,
            meta: data.meta,
            ts,
            reply_to: data.reply_to ?? null,
            reply_preview: null,
            sig: data.sig ?? null,
            deleted: true,
            deleted_by: data.deleted_by ?? null,
            deleted_at: data.deleted_at ?? null,
          });
          publish();
          return;
        }

        const storedBody = data.body ?? "";
        // Wait for the body field on the FIRST sighting — Gun delivers
        // node fields piecemeal so a missing body just means "not
        // hydrated yet". A later ingest with the body will land.
        // BUT: if we've already seen this msgId before (e.g. it was
        // already in `map` from an earlier delivery), don't silently
        // drop it now — Gun re-emits the node when other fields change,
        // and we want to keep the existing entry visible. So we only
        // bail when we don't yet have a body AND the entry isn't known.
        const hadEntry = map.has(msgId);
        if (!storedBody && data.kind !== "trade" && !hadEntry) return;

        let body = storedBody ? await decryptText(id, storedBody) : "";
        // Empty body after decrypt = key mismatch or partner sent
        // under a different encryption scheme (e.g. mid-deploy). Don't
        // silently swallow — show a placeholder so the user knows a
        // message arrived but couldn't be read on their side.
        if (!body && data.kind !== "trade" && data.kind !== "image") {
          if (hadEntry) return; // already have a good copy
          body = "(message couldn't be decrypted)";
        }
        const reply_preview = data.reply_preview
          ? await decryptText(id, data.reply_preview)
          : null;
        // Verify the message signature (impersonation guard).
        let verified = false;
        if (data.sig && data.kind !== "trade" && data.kind !== "system") {
          try {
            const { verifyMessageBody } = await import("@/lib/cabal-crypto");
            verified = await verifyMessageBody(sender, body, ts, data.sig);
          } catch { verified = false; }
        } else if (data.kind === "trade" || data.kind === "system") {
          verified = true; // indexer/system posts aren't signed
        }
        const m: GunPutMessage = {
          id: msgId,
          sender,
          body,
          kind: data.kind,
          meta: data.meta,
          ts,
          reply_to: data.reply_to ?? null,
          reply_preview,
          sig: data.sig ?? null,
          verified,
          edited_at: data.edited_at ?? null,
        };
        map.set(m.id, m);
        publish();
      };

      // Pull current state from the relay (existing children that were
      // written before we subscribed — partner messages sent while we
      // were offline). `.on()` alone is NOT reliable for this with
      // radisk-backed relays: in practice it often only emits future
      // changes. The `.once()` seed call walks the messages node and
      // delivers each child synchronously, which is exactly what we
      // need to populate the panel on first open.
      node.map().once((data: any, key: string) => { void ingest(data, key); });
      // Then subscribe to future updates.
      node.map().on((data: any, key: string) => { void ingest(data, key); });

      // Re-pull aggressively: a periodic `.once()` walk catches any
      // partner message that the relay's WS push missed (some Gun
      // versions silently drop pushes when the tab was backgrounded
      // or the WS hiccupped). Cheap because radisk serves from local
      // cache when nothing changed.
      const repull = () => {
        if (cancel || myGen !== gen) return;
        node.map().once((data: any, key: string) => { void ingest(data, key); });
      };
      repullInterval = setInterval(repull, 4_000);
      const onFocus = () => repull();
      if (typeof window !== "undefined") {
        window.addEventListener("focus", onFocus);
        detachFocus = () => window.removeEventListener("focus", onFocus);
      }
    })();

    return () => {
      cancel = true;
      gen++;
      detachFocus?.();
      if (repullInterval) clearInterval(repullInterval);
    };
  }, [scope, id]);

  return messages;
}

export async function gunSend(
  scope: "cabal" | "dm" | "token",
  id: string,
  m: Omit<GunPutMessage, "ts"> & { ts?: number },
) {
  if (!GUN_ENABLED) return;
  const gun = await getGun();
  if (!gun) return;
  const ts = m.ts ?? Date.now();
  const encBody = await encryptText(id, m.body);
  // reply_preview is encrypted with the same channel key so non-members
  // can't read the quoted snippet either.
  const replyPreview = m.reply_preview ? await encryptText(id, m.reply_preview) : null;
  // Sign the PLAINTEXT body so receivers can verify after decrypt.
  // Skip signing for trade/system messages (those come from the indexer).
  let sig: string | null = m.sig ?? null;
  if (!sig && m.sender && m.body && (m.kind === "text" || !m.kind)) {
    try {
      const { signMessageBody } = await import("@/lib/cabal-crypto");
      sig = await signMessageBody(m.sender, m.body, ts);
    } catch { sig = null; }
  }
  // Gun is allergic to `undefined` fields — it silently drops them, which
  // can leave a partner's `.map().on()` listener waiting for an ack that
  // never lands and the message effectively never propagates beyond the
  // sender's local cache. Sanitize every field to a concrete value
  // (null when we have no data) so the put is fully atomic.
  const payload: Record<string, unknown> = {
    id: m.id,
    sender: m.sender,
    body: encBody,
    kind: m.kind ?? "text",
    meta: m.meta == null ? null : (typeof m.meta === "string" ? m.meta : JSON.stringify(m.meta)),
    ts,
    reply_to: m.reply_to ?? null,
    reply_preview: replyPreview,
    sig: sig ?? null,
    edited_at: m.edited_at ?? null,
    deleted: m.deleted === true ? true : null,
    deleted_by: m.deleted_by ?? null,
    deleted_at: m.deleted_at ?? null,
  };
  await gunPutAck(messagesNode(gun, scope, id).get(m.id), payload);
}

/** Hard-delete a message — node is removed (null) so it vanishes on both
 * sides instead of leaving a "Message deleted" tombstone. The receiving
 * `ingest` handler treats `data == null` as a removal and drops the
 * map entry, so the bubble disappears from the partner's chat panel
 * within the same Gun .on() tick. */
export async function gunDeleteMessage(
  scope: "cabal" | "dm" | "token",
  channelId: string,
  msg: Pick<GunPutMessage, "id">,
  _deleter: string,
) {
  if (!GUN_ENABLED) return;
  const gun = await getGun();
  if (!gun) return;
  await gunPutAck(messagesNode(gun, scope, channelId).get(msg.id), null);
}

/** Edit a text message in place (keeps original ts for ordering). */
export async function gunEditMessage(
  scope: "cabal" | "dm" | "token",
  channelId: string,
  msg: Pick<GunPutMessage, "id" | "sender" | "ts" | "kind" | "reply_to" | "reply_preview">,
  newBody: string,
) {
  await gunSend(scope, channelId, {
    id: msg.id,
    sender: msg.sender,
    body: newBody,
    kind: msg.kind ?? "text",
    ts: msg.ts,
    reply_to: msg.reply_to ?? null,
    reply_preview: msg.reply_preview ?? null,
    edited_at: Date.now(),
  });
}

// ─────────────── Discord-style chat extras ─────────────────────────────

// Flat-key encoding for reactions so a single Gun .map().on() covers all
// changes without walking nested keys (which is fragile in Gun's event API).
// Key:    `${messageId}|${emoji}|${sender}`  →  ts | null
function reactionKey(messageId: string, emoji: string, sender: string) {
  return `${messageId}|${emoji}|${sender.toLowerCase()}`;
}

export async function gunToggleReaction(
  scope: "cabal" | "dm" | "token",
  id: string,
  messageId: string,
  emoji: string,
  sender: string,
  on: boolean,
) {
  if (!GUN_ENABLED) return;
  const gun = await getGun();
  if (!gun) return;
  gun.get(NS).get(scope).get(id).get("reactions")
    .get(reactionKey(messageId, emoji, sender))
    .put(on ? Date.now() : null);
}

export type ReactionMap = Record<string, string[]>; // emoji → list of sender addresses

/** Reactions keyed by messageId → emoji → list of senders. */
export function useGunReactions(
  scope: "cabal" | "dm" | "token",
  id: string | undefined,
): Record<string, ReactionMap> {
  const [byMsg, setByMsg] = useState<Record<string, ReactionMap>>({});
  useEffect(() => {
    if (!GUN_ENABLED || !id) { setByMsg({}); return; }
    let cancel = false;
    const state: Record<string, ReactionMap> = {};
    (async () => {
      const gun = await getGun();
      if (!gun || cancel) return;
      gun.get(NS).get(scope).get(id).get("reactions").map().on((val: any, key: string) => {
        if (!key || key === "_") return;
        const [messageId, emoji, sender] = key.split("|");
        if (!messageId || !emoji || !sender) return;
        const m = state[messageId] ?? (state[messageId] = {});
        const list = m[emoji] ?? (m[emoji] = []);
        if (val) {
          if (!list.includes(sender)) list.push(sender);
        } else {
          m[emoji] = list.filter((a) => a !== sender);
          if (m[emoji].length === 0) delete m[emoji];
        }
        if (!cancel) setByMsg({ ...state });
      });
    })();
    return () => { cancel = true; };
  }, [scope, id]);
  return byMsg;
}

/**
 * Typing indicator — write to `typing/{sender}` with a timestamp. Listeners
 * filter out anything older than 5 seconds, so a stale entry expires on its
 * own without needing a janitor.
 */
export async function gunSetTyping(
  scope: "cabal" | "dm" | "token",
  id: string,
  sender: string,
) {
  if (!GUN_ENABLED) return;
  const gun = await getGun();
  if (!gun) return;
  gun.get(NS).get(scope).get(id).get("typing").get(sender.toLowerCase()).put(Date.now());
}

export function useGunTyping(
  scope: "cabal" | "dm" | "token",
  id: string | undefined,
  me: string | undefined,
): string[] {
  const [typers, setTypers] = useState<string[]>([]);
  useEffect(() => {
    if (!GUN_ENABLED || !id) { setTypers([]); return; }
    let cancel = false;
    const last: Record<string, number> = {};
    const recompute = () => {
      const now = Date.now();
      const live = Object.entries(last)
        .filter(([addr, ts]) => addr !== me?.toLowerCase() && now - ts < 5000)
        .map(([addr]) => addr);
      if (!cancel) setTypers(live);
    };
    (async () => {
      const gun = await getGun();
      if (!gun || cancel) return;
      gun.get(NS).get(scope).get(id).get("typing").map().on((ts: number, sender: string) => {
        if (typeof ts === "number") last[sender] = ts;
        recompute();
      });
    })();
    const iv = setInterval(recompute, 1500);
    return () => { cancel = true; clearInterval(iv); };
  }, [scope, id, me]);
  return typers;
}

// ─────────── Call control signals (raise hand + admin mute-all) ────────────
// Ephemeral, same namespace as chat. Hands are per-address timestamps; mute-all
// is a single timestamp the admin bumps, which non-admin clients react to.

export async function gunSetHand(
  scope: "cabal" | "dm" | "token", id: string, sender: string, up: boolean,
) {
  if (!GUN_ENABLED) return;
  const gun = await getGun();
  if (!gun) return;
  gun.get(NS).get(scope).get(id).get("callHands").get(sender.toLowerCase()).put(up ? Date.now() : null);
}

export function useGunHands(scope: "cabal" | "dm" | "token", id: string | undefined): string[] {
  const [hands, setHands] = useState<string[]>([]);
  useEffect(() => {
    if (!GUN_ENABLED || !id) { setHands([]); return; }
    let cancel = false;
    const last: Record<string, number | null> = {};
    const recompute = () => {
      const now = Date.now();
      const live = Object.entries(last)
        .filter(([, ts]) => typeof ts === "number" && now - (ts as number) < 60_000)
        .map(([addr]) => addr);
      if (!cancel) setHands(live);
    };
    (async () => {
      const gun = await getGun();
      if (!gun || cancel) return;
      gun.get(NS).get(scope).get(id).get("callHands").map().on((ts: number | null, sender: string) => {
        last[sender] = typeof ts === "number" ? ts : null;
        recompute();
      });
    })();
    const iv = setInterval(recompute, 2000);
    return () => { cancel = true; clearInterval(iv); };
  }, [scope, id]);
  return hands;
}

export async function gunMuteAll(scope: "cabal" | "dm" | "token", id: string) {
  if (!GUN_ENABLED) return;
  const gun = await getGun();
  if (!gun) return;
  gun.get(NS).get(scope).get(id).get("callMuteAll").put(Date.now());
}

export function useGunMuteAll(scope: "cabal" | "dm" | "token", id: string | undefined): number {
  const [ts, setTs] = useState(0);
  useEffect(() => {
    if (!GUN_ENABLED || !id) { setTs(0); return; }
    let cancel = false;
    (async () => {
      const gun = await getGun();
      if (!gun || cancel) return;
      gun.get(NS).get(scope).get(id).get("callMuteAll").on((v: number) => {
        if (!cancel && typeof v === "number") setTs(v);
      });
    })();
    return () => { cancel = true; };
  }, [scope, id]);
  return ts;
}
