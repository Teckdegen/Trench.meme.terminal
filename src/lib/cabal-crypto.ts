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

import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/lib/supabase";
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

const getKeyBackup = createServerFn({ method: "GET" })
  .inputValidator((d: { account: string }) => d)
  .handler(async ({ data }) => {
    const { data: row } = await supabaseAdmin()
      .from("user_key_backup")
      .select("ciphertext, challenge")
      .eq("account", data.account.toLowerCase())
      .maybeSingle();
    return row as { ciphertext: string; challenge: string | null } | null;
  });

const upsertUserEncryptionKey = createServerFn({ method: "POST" })
  .inputValidator((d: { account: string; pubkey: string; algorithm: string }) => d)
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin().from("user_encryption_keys").upsert({
      account: data.account.toLowerCase(),
      pubkey: data.pubkey,
      algorithm: data.algorithm,
    }, { onConflict: "account" });
    if (error) throw new Error(error.message);
  });

const upsertUserKeyBackup = createServerFn({ method: "POST" })
  .inputValidator((d: { account: string; ciphertext: string; challenge: string }) => d)
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin().from("user_key_backup").upsert({
      account: data.account.toLowerCase(),
      ciphertext: data.ciphertext,
      challenge: data.challenge,
    }, { onConflict: "account" });
    if (error) throw new Error(error.message);
  });

const getEncryptionPubkey = createServerFn({ method: "GET" })
  .inputValidator((d: { account: string }) => d)
  .handler(async ({ data }) => {
    const { data: row } = await supabaseAdmin()
      .from("user_encryption_keys")
      .select("pubkey")
      .eq("account", data.account.toLowerCase())
      .maybeSingle();
    return row?.pubkey as string | null;
  });

const getCabalGrant = createServerFn({ method: "GET" })
  .inputValidator((d: { cabalId: string; account: string }) => d)
  .handler(async ({ data }) => {
    const { data: row } = await supabaseAdmin()
      .from("cabal_key_grants")
      .select("wrapped_key")
      .eq("cabal_id", data.cabalId)
      .eq("account", data.account.toLowerCase())
      .maybeSingle();
    return row?.wrapped_key as string | null;
  });

const upsertCabalGrant = createServerFn({ method: "POST" })
  .inputValidator((d: {
    cabalId: string;
    account: string;
    role: "owner" | "admin" | "member";
    wrappedKey: string;
    pubkey: string;
    grantedBy: string;
  }) => d)
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin().from("cabal_key_grants").upsert({
      cabal_id: data.cabalId,
      account: data.account.toLowerCase(),
      role: data.role,
      wrapped_key: data.wrappedKey,
      pubkey: data.pubkey,
      granted_by: data.grantedBy.toLowerCase(),
    }, { onConflict: "cabal_id,account" });
    if (error) throw new Error(error.message);
  });

const listCabalGrants = createServerFn({ method: "GET" })
  .inputValidator((d: { cabalId: string }) => d)
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin()
      .from("cabal_key_grants")
      .select("account, pubkey")
      .eq("cabal_id", data.cabalId);
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{ account: string; pubkey: string | null }>;
  });

const upsertPendingInvite = createServerFn({ method: "POST" })
  .inputValidator((d: { cabalId: string; invitee: string; grantedBy: string }) => d)
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin().from("pending_cabal_invites").upsert({
      cabal_id: data.cabalId,
      invitee: data.invitee.toLowerCase(),
      granted_by: data.grantedBy.toLowerCase(),
    }, { onConflict: "cabal_id,invitee" });
    if (error) throw new Error(error.message);
  });

const listPendingInvitesForGrantor = createServerFn({ method: "GET" })
  .inputValidator((d: { cabalId: string; grantedBy: string }) => d)
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin()
      .from("pending_cabal_invites")
      .select("invitee")
      .eq("cabal_id", data.cabalId)
      .eq("granted_by", data.grantedBy.toLowerCase());
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{ invitee: string }>;
  });

const deletePendingInvite = createServerFn({ method: "POST" })
  .inputValidator((d: { cabalId: string; invitee: string }) => d)
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin().from("pending_cabal_invites")
      .delete()
      .eq("cabal_id", data.cabalId)
      .eq("invitee", data.invitee.toLowerCase());
    if (error) throw new Error(error.message);
  });

const deleteCabalGrant = createServerFn({ method: "POST" })
  .inputValidator((d: { cabalId: string; account: string }) => d)
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin().from("cabal_key_grants")
      .delete()
      .eq("cabal_id", data.cabalId)
      .eq("account", data.account.toLowerCase());
    if (error) throw new Error(error.message);
  });

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
    const row = await getKeyBackup({ data: { account: me } });
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

  await upsertUserEncryptionKey({ data: {
    account: me,
    pubkey: JSON.stringify({
      ecdh: bundle.ecdh.pub,
      ecdsa: bundle.ecdsa.pub,
    }),
    algorithm: "ecdh-p256+ecdsa-p256",
  } });

  // Encrypted backup — only attempt if Para wallet can sign
  try {
    const sig = await askWalletForBackupSignature(me);
    if (sig) {
      const wrap = await deriveBackupWrapKey(sig);
      const ciphertext = await encryptBundleForBackup(bundle, wrap);
      await upsertUserKeyBackup({ data: {
        account: me,
        ciphertext,
        challenge: BACKUP_CHALLENGE,
      } });
    }
  } catch (e) {
    console.warn("[cabal-crypto] backup upload failed (local keys still work)", e);
  }

  return _bundle;
}

// ─────────────── pubkey lookup (handles new + legacy schemas) ────────
async function fetchMemberEcdhPub(account: string): Promise<string | null> {
  const pubkey = await getEncryptionPubkey({ data: { account } });
  if (!pubkey) return null;
  try {
    const parsed = JSON.parse(pubkey);
    if (parsed.ecdh) return JSON.stringify(parsed.ecdh);
    return pubkey; // legacy: pubkey was just the ECDH JWK
  } catch {
    return pubkey;
  }
}

async function fetchMemberEcdsaPub(account: string): Promise<JsonWebKey | null> {
  const pubkey = await getEncryptionPubkey({ data: { account } });
  if (!pubkey) return null;
  try {
    const parsed = JSON.parse(pubkey);
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
  const wrappedKey = await getCabalGrant({ data: { cabalId, account: me } });
  if (!wrappedKey) return null;
  const key = await unwrapCabalKey(wrappedKey, bundle.ecdhPriv);
  cabalKeyCache.set(cabalId, key);
  setChannelKey(cabalId, key);
  return key;
}

export async function bootstrapCabalKey(cabalId: string, creator: string): Promise<CryptoKey> {
  const bundle = await ensureBundle(creator);
  const cabalKey = await createCabalAesKey();
  const wrapped = await wrapCabalKey(cabalKey, bundle.ecdhPubJson);
  await upsertCabalGrant({ data: {
    cabalId,
    account: creator,
    role: "owner",
    wrappedKey: wrapped,
    pubkey: bundle.ecdhPubJson,
    grantedBy: creator,
  } });
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
    await upsertPendingInvite({ data: { cabalId, invitee: newMember, grantedBy: me } });
    return { status: "pending" };
  }
  const wrapped = await wrapCabalKey(cabalKey, memberPub);
  await upsertCabalGrant({ data: {
    cabalId,
    account: newMember,
    role: "member",
    wrappedKey: wrapped,
    pubkey: memberPub,
    grantedBy: me,
  } });
  await deletePendingInvite({ data: { cabalId, invitee: newMember } });
  return { status: "granted" };
}

/** Re-attempts every pending invite the user granted; succeeds for any whose pubkey is now published. */
export async function retryPendingInvites(cabalId: string, me: string): Promise<{ granted: number; stillPending: number }> {
  const pending = await listPendingInvitesForGrantor({ data: { cabalId, grantedBy: me } });
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
  const members = await listCabalGrants({ data: { cabalId } });
  if (!members) return;
  for (const m of members) {
    if (!m.pubkey) continue;
    const wrapped = await wrapCabalKey(fresh, m.pubkey);
    await upsertCabalGrant({ data: {
      cabalId,
      account: m.account,
      role: m.account.toLowerCase() === _me.toLowerCase() ? "owner" : "member",
      wrappedKey: wrapped,
      pubkey: m.pubkey,
      grantedBy: _me,
    } });
  }
  cabalKeyCache.set(cabalId, fresh);
  setChannelKey(cabalId, fresh);
}

/** Kick a member: delete their grant + rotate the cabal key so they can't decrypt new messages. */
export async function kickMemberFromCabal(cabalId: string, me: string, target: string): Promise<void> {
  await deleteCabalGrant({ data: { cabalId, account: target } });
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
