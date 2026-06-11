#!/usr/bin/env node
/**
 * Nad.fun API key registration — hardcoded edition.
 *
 * 1. Edit the CONFIG block below with your real values
 * 2. Run:   node scripts/register-nadfun-key.js
 * 3. Copy the printed NADFUN_API_KEY into bot/.env (and Railway prod env)
 *
 * The full key is only returned by Nad.fun once. The script also dumps the
 * complete payload to ./nadfun-key.json so you can copy it later.
 *
 * Requires Node 20+ (uses global fetch). Uses viem for EIP-191 signing —
 * already in your package.json.
 */

import { privateKeyToAccount } from "viem/accounts";
import { writeFileSync } from "node:fs";
import { lookup as dnsLookup } from "node:dns/promises";

// ════════════════════════════════════════════════════════════════════════
//   ⬇⬇⬇   EDIT THESE THREE LINES   ⬇⬇⬇
// ════════════════════════════════════════════════════════════════════════

// Your wallet's private key (0x-prefixed 32-byte hex, 66 chars total).
// Generate a fresh burner if you want — this wallet just needs to exist,
// it doesn't need to hold any MON.
const PRIVATE_KEY = "0x38e8aa761fda6d5997512cdafa2b0dc56c169a9470a293df21f63e4f34b3bd10";

// Human-readable name for this key. Shows up in your Nad.fun dashboard.
const KEY_NAME = "trench.meme";

// "mainnet" or "testnet"
const NETWORK = "mainnet";

// ════════════════════════════════════════════════════════════════════════
//   ⬆⬆⬆   THAT'S IT — DON'T EDIT BELOW   ⬆⬆⬆
// ════════════════════════════════════════════════════════════════════════

const DESCRIPTION = "trench.meme bot — indexer + sniper + executor";
const EXPIRES_DAYS = 365;
const OUT_PATH = "nadfun-key.json";

const NETS = {
  mainnet: { base: "https://api.nad.fun",        chainId: 143   },
  testnet: { base: "https://dev-api.nadapp.net", chainId: 10143 },
};

// ─────────── pretty output ────────────────────────────────────────────
const c = {
  reset: "\x1b[0m", dim: "\x1b[2m", cyan: "\x1b[36m",
  green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", bold: "\x1b[1m",
};
const say  = (m) => process.stdout.write(`${c.cyan}❯${c.reset} ${m}\n`);
const ok   = (m) => process.stdout.write(`${c.green}✓${c.reset} ${m}\n`);
const warn = (m) => process.stdout.write(`${c.yellow}!${c.reset} ${m}\n`);
const fail = (m) => { process.stderr.write(`${c.red}✗${c.reset} ${m}\n`); process.exit(1); };

// ─────────── validate config ──────────────────────────────────────────
if (!PRIVATE_KEY || PRIVATE_KEY.includes("REPLACE_ME")) {
  fail("Edit PRIVATE_KEY at the top of scripts/register-nadfun-key.js first.");
}
if (!/^0x[a-fA-F0-9]{64}$/.test(PRIVATE_KEY)) {
  fail("PRIVATE_KEY must be 0x + 64 hex chars (66 total).");
}
if (!NETS[NETWORK]) {
  fail(`NETWORK must be 'mainnet' or 'testnet' (got '${NETWORK}').`);
}

const { base: BASE_URL, chainId: CHAIN_ID } = NETS[NETWORK];

// Pre-flight DNS + reachability check — surfaces real cause when fetch times
// out (otherwise undici just says "Connect Timeout Error" with no detail).
async function preflight() {
  const host = new URL(BASE_URL).hostname;
  try {
    const r = await dnsLookup(host);
    console.log(`  ${c.dim}resolved${c.reset} ${host} → ${r.address}`);
  } catch (e) {
    fail(`DNS for ${host} failed (${e.code ?? e.message}).
       The ${NETWORK} API may not exist yet — try NETWORK = "testnet"
       at the top of this script, or check Nad.fun's current docs/Discord
       for the right URL.`);
  }
}

// ─────────── tiny cookie-jar fetch wrapper ────────────────────────────
class Jar {
  constructor() { this.cookies = new Map(); }
  setFromResponse(res) {
    const raws = res.headers.getSetCookie?.()
      ?? (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
    for (const raw of raws) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}
const jar = new Jar();

async function jfetch(path, init = {}) {
  const url = new URL(path, BASE_URL).toString();
  const headers = {
    "content-type": "application/json",
    "accept": "application/json",
    ...(init.headers ?? {}),
  };
  const cookie = jar.header();
  if (cookie) headers["cookie"] = cookie;
  // 30s timeout — bumped from undici's 10s default so flakey connections work
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  let res;
  try {
    res = await fetch(url, { ...init, headers, signal: ctrl.signal });
  } catch (e) {
    if (e?.name === "AbortError" || /timeout/i.test(e?.message ?? "")) {
      throw new Error(`Timeout reaching ${url}.
       The Nad.fun ${NETWORK} API may be down or unreachable from your network.
       Try: 1) testnet,  2) a VPN,  3) check status in their Discord.`);
    }
    throw e;
  } finally { clearTimeout(timer); }
  jar.setFromResponse(res);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; }
  catch { body = text; }
  if (!res.ok) {
    const msg = body?.error ?? body?.message ?? `HTTP ${res.status}`;
    throw new Error(`${init.method ?? "GET"} ${path} → ${msg}`);
  }
  return body;
}

// ─────────── main ─────────────────────────────────────────────────────
say(`${c.bold}Nad.fun API key registration${c.reset}`);
console.log(`  ${c.dim}network ${c.reset}${NETWORK}`);
console.log(`  ${c.dim}base    ${c.reset}${BASE_URL}`);
console.log(`  ${c.dim}chainId ${c.reset}${CHAIN_ID}`);
console.log(`  ${c.dim}name    ${c.reset}${KEY_NAME}`);
console.log("");

await preflight();

const account = privateKeyToAccount(PRIVATE_KEY);
say(`Authenticating as ${account.address}…`);

// 1. nonce
const nonceRes = await jfetch("/auth/nonce", {
  method: "POST",
  body: JSON.stringify({ address: account.address }),
});
if (!nonceRes?.nonce) fail("server returned no nonce");
ok("nonce received");

// 2. sign — exact bytes, no whitespace normalisation
const signature = await account.signMessage({ message: nonceRes.nonce });
ok("nonce signed");

// 3. session — server sets HttpOnly cookie
const session = await jfetch("/auth/session", {
  method: "POST",
  body: JSON.stringify({
    signature,
    nonce: nonceRes.nonce,
    chain_id: CHAIN_ID,
    wallet_address: null,
  }),
});
if (jar.cookies.size === 0) {
  warn("session response had no Set-Cookie — API may have changed; key creation may fail.");
}
ok(`session established (account_id=${session?.account_info?.account_id ?? "?"})`);

// 4. mint the key
console.log("");
say(`Creating API key '${KEY_NAME}'…`);
const created = await jfetch("/api-key", {
  method: "POST",
  body: JSON.stringify({
    name: KEY_NAME,
    description: DESCRIPTION,
    expires_in_days: EXPIRES_DAYS,
  }),
});
ok(`API key created (id=${created.id})`);

// 5. persist
const payload = {
  issued_at: new Date().toISOString(),
  network: NETWORK,
  base_url: BASE_URL,
  chain_id: CHAIN_ID,
  wallet_address: account.address,
  id: created.id,
  name: created.name,
  key_prefix: created.key_prefix,
  api_key: created.api_key,
  expires_in_days: EXPIRES_DAYS,
};
writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
ok(`Saved full payload to ${OUT_PATH}`);

console.log("");
console.log(`${c.bold}NADFUN_API_KEY${c.reset}=${c.green}${created.api_key}${c.reset}`);
console.log("");
warn("This key will NEVER be shown again. Save it now.");
warn("Paste it into bot/.env (and Railway env vars in production).");
