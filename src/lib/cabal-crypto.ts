// End-to-end encryption + per-message signing for cabal chats.
//
// Threat model:
//   * Gun.js relay is untrusted — sees only ciphertext + signatures.
//   * Supabase is semi-trusted — stores public keys and ENCRYPTED blobs:
//       - user_encryption_keys.pubkey   (public ECDH key)
//       - user_encryption_keys.sig_pubkey (public ECDSA key, JSON-stuffed
//         under the same row's metadata field via "pubkey" — see notes)
//       - cabal_key_grants.wrapped_key  (cabal AES key, ECDH-wrapped to a member)
//       - user_key_backup.ciphertext    (your own private keys, AES-wrapped
//         with a key derived from a Para wallet signature)
//
// Three keys per user:
//   1. ECDH P-256 — for wrapping/unwrapping cabal AES keys
//   2. ECDSA P-256 — for signing every chat message (impersonation guard)
//   3. AES-256-GCM "backup wrap key" — derived from sign("trench.meme keys v1")
//      via HKDF. Used only to encrypt #1 and #2 for upload to user_key_backup,
//      so the user can recover their identity on any device by re-signing.

import { supabase } from "@/lib/supabase";
import { setChannelKey, clearChannelKey } from "@/lib/gun-client";
import { getParaWalletClient } from "@/lib/para";

const LOCAL_BUNDLE_KEY = "trench.cabal.keys.v2";
const BACKUP_CHALLENGE = "trench.meme keys v1 — sign to recover your chat identity";

// ─────────────── byte helpers ────────────────────────────────────────
function b64(u8: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
function ub64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
const enc = new TextEncoder();
const dec = new TextDecoder();

// ─────────────── HKDF: signature → AES wrap key ──────────────────────
async function deriveBackupWrapKey(signature: string): Promise<CryptoKey> {
  // Hex string from wallet → bytes
  const sigHex = signature.startsWith("0x") ? signature.slice(2) : signature;
  const sigBytes = new Uint8Array(sigHex.length / 2);
  for (let i = 0; i < sigBytes.length; i++) {
    sigBytes[i] = parseInt(sigHex.slice(i * 2, i * 2 + 2), 16);
  }
  const ikm = await crypto.subtle.importKey("raw", sigBytes, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: enc.encode("trench.meme/v1/backup-wrap"),
      info: enc.encode("aes-gcm-256"),
    },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function askWalletForBackupSignature(me: string): Promise<string | null> {
  // Show the explainer modal FIRST so the user understands why their wallet
  // is about to ask them to sign. Resolves to true if they accept, false if
  // they cancel. (Promise-based modal exposed by EncryptionConsentHost.)
  const consent = await (typeof window !== "undefined"
    ? (window as any).__trenchAskEncryptionConsent?.()
    : Promise.resolve(true));
  if (consent === false) return null;
  try {
    const wc = await getParaWalletClient(me as `0x${string}`);
    if (!wc) return null;
    const sig = await wc.signMessage({
      account: me as `0x${string}`,
      message: BACKUP_CHALLENGE,
    });
    return sig as string;
  } catch (e) {
    console.warn("[cabal-crypto] wallet signature for backup failed", e);
    return null;
  }
}

// ─────────────── keypair management ─────────────────────────────────
type KeyBundle = {
  ecdh: { priv: JsonWebKey; pub: JsonWebKey };
  ecdsa: { priv: JsonWebKey; pub: JsonWebKey };
};

type LoadedBundle = {
  ecdhPriv: CryptoKey;
  ecdhPub: CryptoKey;
  ecdsaPriv: CryptoKey;
  ecdsaPub: CryptoKey;
  ecdhPubJson: string;
  ecdsaPubJson: string;
};

let _bundle: LoadedBundle | null = null;

async function importBundle(b: KeyBundle): Promise<LoadedBundle> {
  const ecdhPriv = await crypto.subtle.importKey("jwk", b.ecdh.priv,
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
  const ecdhPub = await crypto.subtle.importKey("jwk", b.ecdh.pub,
    { name: "ECDH", namedCurve: "P-256" }, true, []);
  const ecdsaPriv = await crypto.subtle.importKey("jwk", b.ecdsa.priv,
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const ecdsaPub = await crypto.subtle.importKey("jwk", b.ecdsa.pub,
    { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  return {
    ecdhPriv, ecdhPub, ecdsaPriv, ecdsaPub,
    ecdhPubJson: JSON.stringify(b.ecdh.pub),
    ecdsaPubJson: JSON.stringify(b.ecdsa.pub),
  };
}

async function generateFreshBundle(): Promise<KeyBundle> {
  const ecdh = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
  const ecdsa = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return {
    ecdh: {
      priv: await crypto.subtle.exportKey("jwk", ecdh.privateKey),
      pub: await crypto.subtle.exportKey("jwk", ecdh.publicKey),
    },
    ecdsa: {
      priv: await crypto.subtle.exportKey("jwk", ecdsa.privateKey),
      pub: await crypto.subtle.exportKey("jwk", ecdsa.publicKey),
    },
  };
}

async function encryptBundleForBackup(bundle: KeyBundle, wrapKey: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    wrapKey,
    enc.encode(JSON.stringify(bundle)),
  );
  const packed = new Uint8Array(iv.length + ct.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ct), iv.length);
  return b64(packed);
}

async function decryptBundleFromBackup(ciphertext: string, wrapKey: CryptoKey): Promise<KeyBundle> {
  const raw = ub64(ciphertext);
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, wrapKey, ct);
  return JSON.parse(dec.decode(plain));
}

/**
 * Ensures a usable key bundle for this user. Priority:
 *   1. In-memory cache
 *   2. localStorage cache (fast path, no signature prompt)
 *   3. user_key_backup on Supabase: re-prompt wallet to sign challenge,
 *      decrypt the bundle, cache locally
 *   4. Generate fresh, publish public keys, encrypt+upload backup
 */
export async function ensureMyKeypair(me: string): Promise<CryptoKeyPair> {
  const loaded = await ensureBundle(me);
  return { privateKey: loaded.ecdhPriv, publicKey: loaded.ecdhPub };
}

async function ensureBundle(me: string): Promise<LoadedBundle> {
  if (_bundle) return _bundle;

  // 2. Try localStorage
  const cached = localStorage.getItem(LOCAL_BUNDLE_KEY);
  if (cached) {
    try {
      _bundle = await importBundle(JSON.parse(cached) as KeyBundle);
      return _bundle;
    } catch {
      localStorage.removeItem(LOCAL_BUNDLE_KEY);
    }
  }

  // 3. Try server backup (recovery on new device)
  try {
    const { data: row } = await supabase()
      .from("user_key_backup")
      .select("ciphertext, challenge")
      .eq("account", me.toLowerCase())
      .maybeSingle();
    if (row?.ciphertext) {
      const sig = await askWalletForBackupSignature(me);
      if (sig) {
        const wrap = await deriveBackupWrapKey(sig);
        const bundle = await decryptBundleFromBackup(row.ciphertext, wrap);
        localStorage.setItem(LOCAL_BUNDLE_KEY, JSON.stringify(bundle));
        _bundle = await importBundle(bundle);
        return _bundle;
      }
    }
  } catch (e) {
    console.warn("[cabal-crypto] backup recovery failed, generating fresh", e);
  }

  // 4. First-time setup: generate, publish public, back up encrypted
  const bundle = await generateFreshBundle();
  localStorage.setItem(LOCAL_BUNDLE_KEY, JSON.stringify(bundle));
  _bundle = await importBundle(bundle);

  await supabase().from("user_encryption_keys").upsert({
    account: me.toLowerCase(),
    // Bundle both pubkeys into one JSON string so we don't need a schema change
    pubkey: JSON.stringify({
      ecdh: bundle.ecdh.pub,
      ecdsa: bundle.ecdsa.pub,
    }),
    algorithm: "ecdh-p256+ecdsa-p256",
  });

  // Encrypted backup — only attempt if Para wallet can sign
  try {
    const sig = await askWalletForBackupSignature(me);
    if (sig) {
      const wrap = await deriveBackupWrapKey(sig);
      const ciphertext = await encryptBundleForBackup(bundle, wrap);
      await supabase().from("user_key_backup").upsert({
        account: me.toLowerCase(),
        ciphertext,
        challenge: BACKUP_CHALLENGE,
      });
    }
  } catch (e) {
    console.warn("[cabal-crypto] backup upload failed (local keys still work)", e);
  }

  return _bundle;
}

// ─────────────── pubkey lookup (handles new + legacy schemas) ────────
async function fetchMemberEcdhPub(account: string): Promise<string | null> {
  const { data } = await supabase()
    .from("user_encryption_keys")
    .select("pubkey")
    .eq("account", account.toLowerCase())
    .maybeSingle();
  if (!data?.pubkey) return null;
  try {
    const parsed = JSON.parse(data.pubkey);
    if (parsed.ecdh) return JSON.stringify(parsed.ecdh);
    return data.pubkey; // legacy: pubkey was just the ECDH JWK
  } catch {
    return data.pubkey;
  }
}

async function fetchMemberEcdsaPub(account: string): Promise<JsonWebKey | null> {
  const { data } = await supabase()
    .from("user_encryption_keys")
    .select("pubkey")
    .eq("account", account.toLowerCase())
    .maybeSingle();
  if (!data?.pubkey) return null;
  try {
    const parsed = JSON.parse(data.pubkey);
    return parsed.ecdsa ?? null;
  } catch {
    return null;
  }
}

async function importEcdhPub(pubJson: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk", JSON.parse(pubJson),
    { name: "ECDH", namedCurve: "P-256" },
    true, [],
  );
}

// ─────────────── cabal AES key generation + wrap/unwrap ──────────────
async function createCabalAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

async function wrapCabalKey(cabalKey: CryptoKey, memberPubJson: string): Promise<string> {
  const memberPub = await importEcdhPub(memberPubJson);
  const ephem = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  const shared = await crypto.subtle.deriveKey(
    { name: "ECDH", public: memberPub }, ephem.privateKey,
    { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const raw = await crypto.subtle.exportKey("raw", cabalKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, shared, raw);
  const ephemPubJwk = await crypto.subtle.exportKey("jwk", ephem.publicKey);
  return JSON.stringify({ ephem: ephemPubJwk, iv: b64(iv), ct: b64(new Uint8Array(ct)) });
}

async function unwrapCabalKey(wrapped: string, myPriv: CryptoKey): Promise<CryptoKey> {
  const parsed = JSON.parse(wrapped) as { ephem: JsonWebKey; iv: string; ct: string };
  const ephemPub = await crypto.subtle.importKey(
    "jwk", parsed.ephem,
    { name: "ECDH", namedCurve: "P-256" }, true, []);
  const shared = await crypto.subtle.deriveKey(
    { name: "ECDH", public: ephemPub }, myPriv,
    { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ub64(parsed.iv) }, shared, ub64(parsed.ct));
  return crypto.subtle.importKey(
    "raw", raw, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

// ─────────────── cache + public API ──────────────────────────────────
const cabalKeyCache = new Map<string, CryptoKey>();

export function clearCabalKeyCache(cabalId: string): void {
  cabalKeyCache.delete(cabalId);
  clearChannelKey(cabalId);
}

export async function loadCabalKey(cabalId: string, me: string): Promise<CryptoKey | null> {
  const cached = cabalKeyCache.get(cabalId);
  if (cached) { setChannelKey(cabalId, cached); return cached; }
  const bundle = await ensureBundle(me);
  const { data } = await supabase()
    .from("cabal_key_grants")
    .select("wrapped_key")
    .eq("cabal_id", cabalId)
    .eq("account", me.toLowerCase())
    .maybeSingle();
  if (!data?.wrapped_key) return null;
  const key = await unwrapCabalKey(data.wrapped_key, bundle.ecdhPriv);
  cabalKeyCache.set(cabalId, key);
  setChannelKey(cabalId, key);
  return key;
}

export async function bootstrapCabalKey(cabalId: string, creator: string): Promise<CryptoKey> {
  const bundle = await ensureBundle(creator);
  const cabalKey = await createCabalAesKey();
  const wrapped = await wrapCabalKey(cabalKey, bundle.ecdhPubJson);
  await supabase().from("cabal_key_grants").upsert({
    cabal_id: cabalId,
    account: creator.toLowerCase(),
    role: "owner",
    wrapped_key: wrapped,
    pubkey: bundle.ecdhPubJson,
    granted_by: creator.toLowerCase(),
  });
  cabalKeyCache.set(cabalId, cabalKey);
  setChannelKey(cabalId, cabalKey);
  return cabalKey;
}

/**
 * Invite a new member. If they have no published pubkey yet, queue a
 * pending_cabal_invite row instead — owner can call retryPendingInvites later.
 */
export async function inviteMemberToCabal(
  cabalId: string,
  me: string,
  newMember: string,
): Promise<{ status: "granted" | "pending" }> {
  const cabalKey = await loadCabalKey(cabalId, me);
  if (!cabalKey) throw new Error("not a cabal member — cannot invite");
  const memberPub = await fetchMemberEcdhPub(newMember);
  if (!memberPub) {
    await supabase().from("pending_cabal_invites").upsert({
      cabal_id: cabalId,
      invitee: newMember.toLowerCase(),
      granted_by: me.toLowerCase(),
    });
    return { status: "pending" };
  }
  const wrapped = await wrapCabalKey(cabalKey, memberPub);
  await supabase().from("cabal_key_grants").insert({
    cabal_id: cabalId,
    account: newMember.toLowerCase(),
    role: "member",
    wrapped_key: wrapped,
    pubkey: memberPub,
    granted_by: me.toLowerCase(),
  });
  await supabase().from("pending_cabal_invites")
    .delete()
    .eq("cabal_id", cabalId)
    .eq("invitee", newMember.toLowerCase());
  return { status: "granted" };
}

/** Re-attempts every pending invite the user granted; succeeds for any whose pubkey is now published. */
export async function retryPendingInvites(cabalId: string, me: string): Promise<{ granted: number; stillPending: number }> {
  const { data: pending } = await supabase()
    .from("pending_cabal_invites")
    .select("invitee")
    .eq("cabal_id", cabalId)
    .eq("granted_by", me.toLowerCase());
  if (!pending) return { granted: 0, stillPending: 0 };
  let granted = 0, stillPending = 0;
  for (const p of pending) {
    try {
      const r = await inviteMemberToCabal(cabalId, me, p.invitee);
      if (r.status === "granted") granted++; else stillPending++;
    } catch { stillPending++; }
  }
  return { granted, stillPending };
}

/** Generate a new cabal key + re-wrap for every CURRENT member. Use after kick. */
export async function rotateCabalKey(cabalId: string, _me: string): Promise<void> {
  const fresh = await createCabalAesKey();
  const { data: members } = await supabase()
    .from("cabal_key_grants")
    .select("account, pubkey")
    .eq("cabal_id", cabalId);
  if (!members) return;
  for (const m of members) {
    if (!m.pubkey) continue;
    const wrapped = await wrapCabalKey(fresh, m.pubkey);
    await supabase().from("cabal_key_grants")
      .update({ wrapped_key: wrapped })
      .eq("cabal_id", cabalId)
      .eq("account", m.account);
  }
  cabalKeyCache.set(cabalId, fresh);
  setChannelKey(cabalId, fresh);
}

/** Kick a member: delete their grant + rotate the cabal key so they can't decrypt new messages. */
export async function kickMemberFromCabal(cabalId: string, me: string, target: string): Promise<void> {
  await supabase().from("cabal_key_grants")
    .delete()
    .eq("cabal_id", cabalId)
    .eq("account", target.toLowerCase());
  await rotateCabalKey(cabalId, me);
}

// ─────────────── per-message signing (impersonation guard) ───────────

/** Sign a message body. Returns base64 ECDSA signature. */
export async function signMessageBody(me: string, body: string, ts: number): Promise<string> {
  const bundle = await ensureBundle(me);
  const payload = enc.encode(`${me.toLowerCase()}|${ts}|${body}`);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    bundle.ecdsaPriv,
    payload,
  );
  return b64(new Uint8Array(sig));
}

/** Verify a message signature. Returns true if the signature matches sender's published pubkey. */
const verifyKeyCache = new Map<string, CryptoKey>();
export async function verifyMessageBody(
  sender: string, body: string, ts: number, sig: string,
): Promise<boolean> {
  try {
    let pub = verifyKeyCache.get(sender.toLowerCase());
    if (!pub) {
      const jwk = await fetchMemberEcdsaPub(sender);
      if (!jwk) return false;
      pub = await crypto.subtle.importKey(
        "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
      verifyKeyCache.set(sender.toLowerCase(), pub);
    }
    const payload = enc.encode(`${sender.toLowerCase()}|${ts}|${body}`);
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pub,
      ub64(sig),
      payload,
    );
  } catch {
    return false;
  }
}
