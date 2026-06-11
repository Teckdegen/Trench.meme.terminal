// Shared Gun.js client for all decentralized chat (cabals, DMs, token chat).
// Requires VITE_GUN_PEERS pointing at the bot-hosted relay (see bot/scripts/gun-relayer.ts).
// Message bodies are AES-GCM encrypted with a key derived from the channel id.

export const NS = "trench.meme";

// Normalize each peer URL so users can't accidentally set
//   VITE_GUN_PEERS=my-bot.up.railway.app
// and have the browser resolve it as a path on the current host.
// We auto-prefix wss:// (or ws:// on localhost) and ensure /gun is at the end.
function normalizeGunPeer(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  // Skip placeholder values like "<URL>" or "your-domain"
  if (/[<>]/.test(s) || s.toLowerCase() === "your-domain") return null;
  // Add protocol if missing
  if (!/^(wss?:\/\/|https?:\/\/)/i.test(s)) {
    const isLocal = /^(localhost|127\.|0\.0\.0\.0)/i.test(s);
    s = (isLocal ? "ws://" : "wss://") + s;
  }
  // Convert https://host → wss://host (Gun wants websocket scheme)
  s = s.replace(/^https:\/\//i, "wss://").replace(/^http:\/\//i, "ws://");
  // Append /gun if missing
  try {
    const u = new URL(s);
    if (!u.pathname || u.pathname === "/") u.pathname = "/gun";
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

const PEERS = (import.meta.env.VITE_GUN_PEERS ?? "")
  .split(",")
  .map((p: string) => normalizeGunPeer(p))
  .filter((p): p is string => !!p);

if (typeof window !== "undefined" && import.meta.env.VITE_GUN_PEERS && PEERS.length === 0) {
  console.warn(
    "[gun] VITE_GUN_PEERS is set but no valid URL parsed. Got:",
    import.meta.env.VITE_GUN_PEERS,
    "→ chat features disabled.",
  );
}

export const GUN_ENABLED = PEERS.length > 0;

let _gun: any | null = null;

type TimeoutWithGunHelpers = typeof globalThis.setTimeout & {
  each?: (
    list: unknown,
    cb?: (value: unknown, key: string | number) => void,
    opt?: number | { wait?: number; chunk?: number },
  ) => void;
  turn?: ((cb?: () => void) => void) & { s?: Array<() => void> };
};

type GunTimerEach = NonNullable<TimeoutWithGunHelpers["each"]>;
type GunTimerTurn = NonNullable<TimeoutWithGunHelpers["turn"]>;

const gunTimerEach: GunTimerEach = (list, cb, opt) => {
  if (typeof cb !== "function") return;
  const source = (list ?? {}) as Record<string, unknown> | unknown[];
  const keys = Array.isArray(source)
    ? source.map((_, i) => i)
    : Object.keys(source);
  const wait = typeof opt === "number" ? opt : opt?.wait ?? 0;
  const chunk = typeof opt === "object" ? opt?.chunk ?? 256 : 256;
  let i = 0;

  const run = () => {
    const end = Math.min(i + chunk, keys.length);
    for (; i < end; i++) {
      const key = keys[i];
      cb((source as any)[key], key);
    }
    if (i < keys.length) globalThis.setTimeout(run, wait);
  };

  run();
};

const gunTimerTurn: GunTimerTurn = Object.assign(
  (cb?: () => void) => {
    if (typeof cb !== "function") return;
    gunTimerTurn.s?.push(cb);
    if (gunTimerTurn.s?.length === 1) globalThis.setTimeout(flushGunTimerTurn, 0);
  },
  { s: [] as Array<() => void> },
);

function flushGunTimerTurn(): void {
  const queue = gunTimerTurn.s ?? [];
  const next = queue.shift();
  if (next) next();
  if (queue.length) globalThis.setTimeout(flushGunTimerTurn, 0);
}

function installGunTimerCompat(): void {
  if (typeof window === "undefined") return;
  const timer = globalThis.setTimeout as TimeoutWithGunHelpers;
  if (typeof timer.each !== "function") timer.each = gunTimerEach;
  if (typeof timer.turn !== "function") timer.turn = gunTimerTurn;

  // Some browser extensions/polyfills wrap setTimeout after app startup.
  // Gun calls `setTimeout.each/turn(...)` directly, so give wrapped timer
  // functions the same helpers through the function prototype as a fallback.
  const fnProto = Function.prototype as Function & {
    each?: GunTimerEach;
    turn?: GunTimerTurn;
  };
  if (typeof fnProto.each !== "function") {
    Object.defineProperty(fnProto, "each", {
      configurable: true,
      value: gunTimerEach,
    });
  }
  if (typeof fnProto.turn !== "function") {
    Object.defineProperty(fnProto, "turn", {
      configurable: true,
      value: gunTimerTurn,
    });
  }
}

export async function getGun(): Promise<any | null> {
  if (!GUN_ENABLED) return null;
  if (_gun) return _gun;
  try {
    installGunTimerCompat();
    const Gun: any = await import(/* @vite-ignore */ "gun");
    const G = Gun.default ?? Gun;
    _gun = G({ peers: PEERS, localStorage: true, radisk: true });
    return _gun;
  } catch (e) {
    console.warn("[gun] failed to init — set VITE_GUN_PEERS to your relay URL", e);
    return null;
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

// Per-channel key overrides. cabal-crypto.ts calls setChannelKey(cabalId, k)
// once the member unwraps the shared AES key — that real key takes precedence
// over the PBKDF2 fallback below. DMs / token chats still use the fallback
// (channelId is itself a shared secret for DMs since it embeds both addresses).
const channelKeyOverrides = new Map<string, CryptoKey>();

export function setChannelKey(channelId: string, key: CryptoKey): void {
  channelKeyOverrides.set(channelId, key);
}

export function clearChannelKey(channelId: string): void {
  channelKeyOverrides.delete(channelId);
}

async function deriveAesKey(channelId: string): Promise<CryptoKey> {
  const override = channelKeyOverrides.get(channelId);
  if (override) return override;
  const material = await crypto.subtle.importKey(
    "raw",
    enc.encode(channelId),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(NS), iterations: 120_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptText(channelId: string, plain: string): Promise<string> {
  if (!plain) return plain;
  const key = await deriveAesKey(channelId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
  const packed = new Uint8Array(iv.length + cipher.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(cipher), iv.length);
  return `enc:${btoa(String.fromCharCode(...packed))}`;
}

export async function decryptText(channelId: string, stored: string): Promise<string> {
  if (!stored?.startsWith("enc:")) return stored ?? "";
  try {
    const raw = Uint8Array.from(atob(stored.slice(4)), (c) => c.charCodeAt(0));
    const iv = raw.slice(0, 12);
    const data = raw.slice(12);
    const key = await deriveAesKey(channelId);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return dec.decode(plain);
  } catch {
    return "";
  }
}

export type GunPutMessage = {
  id: string;
  sender: string;
  body: string;
  kind?: "text" | "image" | "trade" | "system";
  meta?: Record<string, unknown> | string | null;
  ts: number;
  reply_to?: string | null;       // id of message being replied to
  reply_preview?: string | null;  // short snippet of the replied-to body (plaintext)
  sig?: string | null;            // base64 ECDSA signature over sender|ts|plaintext-body
  verified?: boolean;             // hydrated client-side after sig check
  edited_at?: number | null;
  deleted?: boolean;
  deleted_by?: string | null;
  deleted_at?: number | null;
};
