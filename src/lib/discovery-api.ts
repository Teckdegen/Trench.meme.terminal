// Landing-page discovery — live APIs only (no Supabase).
// Sources: NadFun V2 BondingCurve Create/Graduate events, NadFunFactory
// PairCreated, NadFunRouter.isGraduated, Lens progress, DexScreener (DEX
// pairs sorted by recency), Nad.fun /token/metadata enrichment.

import { createServerFn } from "@tanstack/react-start";
import { createPublicClient, http, type Address } from "viem";
import {
  BONDING_CURVE_ABI,
  BONDING_CURVE_V1_CREATE_ABI,
  NAD_FUN_FACTORY_ABI,
  NAD_FUN_ROUTER_ABI,
  NAD_LENS_ABI,
  NAD_LENS_MAINNET,
  NADFUN_V1_MAINNET_CURVE,
  NADFUN_V2_MAINNET,
  progressBpsFromCurve,
} from "@/lib/nadfun/v2-contracts";

const MONAD_RPC = process.env.MONAD_RPC_URL ?? "https://rpc.monad.xyz";
const NADFUN_BASE = process.env.NADFUN_API_BASE ?? "https://api.nad.fun";
const NADFUN_KEY = process.env.NADFUN_API_KEY ?? "";
const DS_BASE = "https://api.dexscreener.com/latest/dex";

const monad = {
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC] } },
} as const;

// Lowered from 40% → 5% because Nad.fun mainnet currently has almost
// no tokens in the 40–99% band (we scanned the top 500 most-traded —
// zero hits). 5%+ surfaces the tokens that are actually making real
// progress toward graduation, instead of leaving the column empty.
const FINAL_MIN_BPS = 500;
const FINAL_MAX_BPS = 9900;
const NEW_WINDOW_MS = 72 * 60 * 60 * 1000; // 3 days
const CHUNK = 2500n;

export type LandingToken = {
  address: string;
  symbol: string;
  name: string;
  imageUri: string | null;
  creatorAddress: string | null;
  column: "new" | "final" | "migrated" | "latest";
  createdAt: string | null;
  progressBps: number;
  priceUsd: number | null;
  volumeUsd: number | null;
  holderCount: number | null;
  liquidityUsd: number | null;
  isGraduated: boolean;
  marketCapUsd: number | null;
  priceChange24h: number | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
};

type RawAddr = {
  address: string;
  creator: string | null;
  blockNumber: bigint;
  graduatedAtBlock?: bigint;
};

type DexMeta = RawAddr & {
  symbol?: string;
  name?: string;
  imageUri?: string | null;
  priceUsd?: number | null;
  volumeUsd?: number | null;
  liquidityUsd?: number | null;
  marketCapUsd?: number | null;
  priceChange24h?: number | null;
  /** DEX pair creation (DexScreener) — implies graduated. */
  pairCreatedAt?: number | null;
  /** Nad.fun token launch time — NOT graduation. */
  launchedAtMs?: number | null;
  /** Bonding curve completion 0–1 from Nad.fun /order/* `percent`. */
  bondingPercent?: number | null;
  nfGraduated?: boolean;
  twitter?: string | null;
  telegram?: string | null;
  website?: string | null;
};

function nadfunUsdFields(mi: Record<string, unknown>) {
  const quoteUsd = Number(mi.quote_price ?? mi.native_price ?? 0) || 0;
  const volWei = Number(mi.volume ?? 0) || 0;
  const reserveWei = Number(mi.reserve_quote ?? mi.reserve_native ?? 0) || 0;
  return {
    price_usd: Number(mi.price_usd) || null,
    price_native: Number(mi.price_native) || null,
    volume_usd: volWei > 0 && quoteUsd > 0 ? (volWei / 1e18) * quoteUsd : null,
    liquidity_usd: reserveWei > 0 && quoteUsd > 0 ? (reserveWei / 1e18) * quoteUsd : null,
    total_supply: mi.total_supply != null ? String(mi.total_supply) : null,
    holder_count: mi.holder_count != null ? Number(mi.holder_count) : null,
  };
}

type NfOrderItem = {
  token_info?: Record<string, any>;
  market_info?: Record<string, any>;
  percent?: number;
};

/** Nad.fun `percent` is usually 0–1 (0.409 = 40.9%) but sometimes 0–100. */
function nfPercentToBps(percent: number | null | undefined): number {
  if (percent == null || !Number.isFinite(percent) || percent <= 0) return 0;
  if (percent <= 1) return Math.max(0, Math.min(10_000, Math.round(percent * 10_000)));
  if (percent <= 100) return Math.max(0, Math.min(10_000, Math.round(percent * 100)));
  return 0;
}

function dedupeDexMeta(list: DexMeta[]): DexMeta[] {
  const byAddr = new Map<string, DexMeta>();
  for (const r of list) {
    const prev = byAddr.get(r.address);
    const score = (m: DexMeta) =>
      nfPercentToBps(m.bondingPercent) + (m.volumeUsd ?? 0) + (m.imageUri ? 10 : 0);
    if (!prev || score(r) > score(prev)) byAddr.set(r.address, r);
  }
  return [...byAddr.values()];
}

function dexMetaToLanding(r: DexMeta, column: LandingToken["column"]): LandingToken {
  const progressBps = nfPercentToBps(r.bondingPercent);
  const createdAtMs = r.launchedAtMs;
  return {
    address: r.address,
    symbol: r.symbol ?? r.address.slice(2, 6),
    name: r.name ?? r.symbol ?? "Token",
    imageUri: r.imageUri ?? null,
    creatorAddress: r.creator,
    column,
    createdAt: createdAtMs ? new Date(createdAtMs).toISOString() : null,
    progressBps,
    priceUsd: r.priceUsd ?? null,
    volumeUsd: r.volumeUsd ?? null,
    holderCount: null,
    liquidityUsd: r.liquidityUsd ?? null,
    isGraduated: false,
    marketCapUsd: r.marketCapUsd ?? null,
    priceChange24h: r.priceChange24h ?? null,
    twitter: r.twitter ?? null,
    telegram: r.telegram ?? null,
    website: r.website ?? null,
  };
}

// ─────────────────── Nad.fun list endpoints ─────────────────────────────
// Nad.fun rate-limits hard (~10 req/burst). NEVER fan out parallel /order/*
// calls — one cached creation_time fetch feeds both New Pairs + Final Stretch.
const NF_CREATION_TTL_MS = 25_000;
const NF_MARKET_TTL_MS = 25_000;
const NF_DEEP_SCAN_INTERVAL_MS = 90_000;

let nfCreationCache: DexMeta[] = [];
let nfCreationCacheAt = 0;
let nfDeepScanAt = 0;
let nfMarketCache: DexMeta[] = [];
let nfMarketCacheAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function nfOrderOnce(
  // `almost_bonded` is documented but returns "nothing to see here" in
  // practice — Nad.fun never wired the handler. We work around it by
  // deep-scanning `creation_time` (which already includes the live
  // `percent` field per token) and filtering client-side.
  bucket: "creation_time" | "market_cap" | "latest_trade",
  limit: number,
  page = 1,
): Promise<DexMeta[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(
        `${NADFUN_BASE}/order/${bucket}?page=${page}&limit=${limit}`,
        { headers: { accept: "application/json", ...(NADFUN_KEY ? { "X-API-Key": NADFUN_KEY } : {}) } },
      );
      if (r.status === 429) {
        const body = (await r.json().catch(() => ({}))) as { retry_after?: number };
        if (attempt === 0) {
          await sleep(Math.max(500, (body.retry_after ?? 2) * 1000));
          continue;
        }
        console.warn(`[discovery] nad.fun /order/${bucket} rate limited`);
        return [];
      }
      if (!r.ok) return [];
      const j = (await r.json()) as {
        tokens?: NfOrderItem[];
        order_token?: NfOrderItem[];
      };
      const rows: DexMeta[] = [];
      for (const o of j.tokens ?? j.order_token ?? []) {
        const ti = o.token_info ?? {};
        const mi = o.market_info ?? {};
        const address = String(ti.token_id ?? ti.token_address ?? ti.address ?? "").toLowerCase();
        if (!/^0x[a-f0-9]{40}$/.test(address)) continue;
        const usd = nadfunUsdFields(mi);
        const supply = usd.total_supply ? Number(usd.total_supply) / 1e18 : null;
        const mcap =
          mi.market_cap_usd != null
            ? Number(mi.market_cap_usd)
            : usd.price_usd != null && supply != null
              ? usd.price_usd * supply
              : null;
        rows.push({
          address,
          creator: (ti.creator?.account_id ?? null)?.toLowerCase() ?? null,
          blockNumber: 0n,
          symbol: ti.symbol ?? undefined,
          name: ti.name ?? undefined,
          imageUri: ti.image_uri ?? null,
          priceUsd: usd.price_usd,
          volumeUsd: usd.volume_usd,
          liquidityUsd: usd.liquidity_usd,
          marketCapUsd: mcap,
          priceChange24h: mi.price_change_24h != null ? Number(mi.price_change_24h) : null,
          launchedAtMs: ti.created_at ? Number(ti.created_at) * 1000 : null,
          bondingPercent: o.percent != null ? Number(o.percent) : null,
          nfGraduated: !!ti.is_graduated,
          twitter: typeof ti.twitter === "string" && ti.twitter ? ti.twitter : null,
          telegram: typeof ti.telegram === "string" && ti.telegram ? ti.telegram : null,
          website: typeof ti.website === "string" && ti.website ? ti.website : null,
        });
      }
      return rows;
    } catch {
      if (attempt === 0) continue;
      return [];
    }
  }
  return [];
}

// ─────────────────── Latest trades feed (trench 3rd column) ─────────────
// The client polls every 5s, so cache hard server-side — one upstream call
// per TTL window keeps us inside Nad.fun's rate limits no matter how many
// tabs are open. A failed/empty refresh serves the last good list.
const NF_LATEST_TTL_MS = 4_000;
let nfLatestCache: { rows: LandingToken[]; at: number } | null = null;

export const fetchLatestTradeFeed = createServerFn({ method: "GET" })
  .inputValidator((d: Record<string, never> | undefined) => d ?? {})
  .handler(async (): Promise<{ rows: LandingToken[]; fetchedAt: string }> => {
    if (nfLatestCache && Date.now() - nfLatestCache.at < NF_LATEST_TTL_MS) {
      return { rows: nfLatestCache.rows, fetchedAt: new Date(nfLatestCache.at).toISOString() };
    }
    const metas = await nfOrderOnce("latest_trade", 30);
    if (metas.length === 0 && nfLatestCache) {
      return { rows: nfLatestCache.rows, fetchedAt: new Date(nfLatestCache.at).toISOString() };
    }
    const rows = dedupeDexMeta(metas).map((r) => {
      const row = dexMetaToLanding(r, "latest");
      row.isGraduated = !!r.nfGraduated;
      return row;
    });
    nfLatestCache = { rows, at: Date.now() };
    return { rows, fetchedAt: new Date(nfLatestCache.at).toISOString() };
  });

/** Cached creation_time list — page 1 hot, plus a parallel deep scan
 *  of pages 2-N that surfaces older tokens (the ones actually making
 *  bonding-curve progress, since brand-new tokens sit at <1%).
 *
 *  The user's request: "list ALL tokens on Nads then check bonding
 *  curve and put it up there". Nad.fun's /order/creation_time already
 *  includes the live `percent` field per token in the SAME response,
 *  so a deep page scan is a single batch — no per-token follow-up. We
 *  pull up to NF_DEEP_PAGES × 100 = enough to cover the last several
 *  months of launches (28k total tokens, ~95% are sub-1%).
 */
const NF_DEEP_PAGES = 15;        // 100 × 15 = 1500 tokens per refresh
const NF_DEEP_PARALLEL = 5;      // pages fetched concurrently

async function nfFetchCreationList(): Promise<DexMeta[]> {
  const now = Date.now();
  if (nfCreationCache.length > 0 && now - nfCreationCacheAt < NF_CREATION_TTL_MS) {
    return nfCreationCache;
  }

  // Page 1 always — fast path for the latest launches.
  const head = await nfOrderOnce("creation_time", 100, 1);
  if (head.length === 0) return nfCreationCache;

  // Deep scan in parallel batches. This is where we discover the
  // tokens with real progress (15%, 30%, 60%+) — they're rarely on
  // page 1 because page 1 is sorted by creation time, and tokens that
  // bonded usually launched days/weeks ago.
  let rows = head;
  if (now - nfDeepScanAt >= NF_DEEP_SCAN_INTERVAL_MS) {
    nfDeepScanAt = now;
    for (let start = 2; start <= NF_DEEP_PAGES; start += NF_DEEP_PARALLEL) {
      const batch: Promise<DexMeta[]>[] = [];
      for (let i = 0; i < NF_DEEP_PARALLEL && start + i <= NF_DEEP_PAGES; i++) {
        batch.push(nfOrderOnce("creation_time", 100, start + i));
      }
      const results = await Promise.all(batch);
      const merged = results.flat();
      if (merged.length === 0) break; // hit end of list
      rows = dedupeDexMeta([...rows, ...merged]);
    }
  }

  if (rows.length > 0) {
    nfCreationCache = rows;
    nfCreationCacheAt = now;
    return rows;
  }
  return nfCreationCache;
}

async function nfFetchMarketCap(): Promise<DexMeta[]> {
  const now = Date.now();
  if (nfMarketCache.length > 0 && now - nfMarketCacheAt < NF_MARKET_TTL_MS) {
    return nfMarketCache;
  }
  // market_cap is the primary Migrated feed — sorted by mcap so the
  // hottest graduated tokens land first. Deep creation_time covers
  // bonding-curve progress separately, so we don't need latest_trade.
  const rows = await nfOrderOnce("market_cap", 100, 1);
  if (rows.length > 0) {
    nfMarketCache = rows;
    nfMarketCacheAt = now;
    return rows;
  }
  return nfMarketCache;
}

function buildNfCoreLanding(nfCreation: DexMeta[]): LandingToken[] {
  const byAddr = new Map<string, LandingToken>();
  for (const r of landingNewFromNf(nfCreation)) byAddr.set(r.address, r);
  for (const r of landingFinalFromNf(nfCreation)) byAddr.set(r.address, r);
  return [...byAddr.values()];
}

function mergeLandingRows(
  pipeline: LandingToken[],
  core: LandingToken[],
  stale?: LandingToken[],
): LandingToken[] {
  const merged = new Map<string, LandingToken>();
  for (const r of pipeline) {
    if (r.column === "migrated") merged.set(r.address, r);
  }
  for (const r of core) merged.set(r.address, r);
  if (core.length === 0 && stale?.length) {
    for (const r of stale) {
      if (r.column === "new" || r.column === "final") merged.set(r.address, r);
    }
  }
  return [...merged.values()];
}

/** New Pairs — newest launches from page 1, still on curve below 40%. */
function landingNewFromNf(list: DexMeta[]): LandingToken[] {
  const out: LandingToken[] = [];
  for (const r of list) {
    if (r.nfGraduated) continue;
    const progressBps = nfPercentToBps(r.bondingPercent);
    const col = classify({
      isGraduated: false,
      progressBps,
      createdAtMs: r.launchedAtMs ?? null,
    });
    if (col !== "new") continue;
    out.push(dexMetaToLanding(r, "new"));
  }
  return out;
}

/** Final Stretch — `/order/almost_bonded` is dead; scan creation_time pages. */
function landingFinalFromNf(list: DexMeta[]): LandingToken[] {
  const out: LandingToken[] = [];
  for (const r of list) {
    if (r.nfGraduated) continue;
    const progressBps = nfPercentToBps(r.bondingPercent);
    if (progressBps < FINAL_MIN_BPS || progressBps > FINAL_MAX_BPS) continue;
    out.push(dexMetaToLanding(r, "final"));
  }
  return out.sort((a, b) => b.progressBps - a.progressBps);
}

// dirol.io — Monad community trending feed. ONLY used to pad the
// Migrated column with already-trading DEX tokens. New Pairs + Final
// Stretch are driven by Nad.fun /order/* exclusively, since dirol
// doesn't track bonding-curve state. Each row is forcibly marked as
// graduated (graduatedAtBlock = 1n) so classify() routes it to migrated.
async function scanDirolTokens(): Promise<DexMeta[]> {
  try {
    const r = await fetch("https://api.dirol.io/api/v1/tokens", {
      headers: { accept: "application/json" },
    });
    if (!r.ok) return [];
    const j = (await r.json()) as any;
    const list: any[] = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : Array.isArray(j?.tokens) ? j.tokens : [];
    const rows: DexMeta[] = [];
    for (const t of list) {
      const address = String(t.address ?? t.token_address ?? t.contract ?? "").toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(address)) continue;
      rows.push({
        address,
        creator: null,
        blockNumber: 0n,
        // Marker that forces classify() → "migrated". Real block number
        // doesn't matter; we just need the truthy `graduatedAtBlock` so
        // the enrichment flips isGraduated=true.
        graduatedAtBlock: 1n,
        symbol: t.symbol ?? undefined,
        name: t.name ?? undefined,
        imageUri: t.image ?? t.image_uri ?? t.logo ?? t.icon ?? null,
        priceUsd: t.price_usd != null ? Number(t.price_usd) : t.priceUsd != null ? Number(t.priceUsd) : null,
        volumeUsd: t.volume_24h != null ? Number(t.volume_24h) : t.volume != null ? Number(t.volume) : null,
        liquidityUsd: t.liquidity_usd != null ? Number(t.liquidity_usd) : t.liquidity != null ? Number(t.liquidity) : null,
        marketCapUsd: t.market_cap != null ? Number(t.market_cap) : t.mcap != null ? Number(t.mcap) : null,
        priceChange24h: t.price_change_24h != null ? Number(t.price_change_24h) : t.change_24h != null ? Number(t.change_24h) : null,
        // Use synthetic old timestamp so it never lands in "new" by mistake.
        pairCreatedAt: 1,
        twitter: typeof t.twitter === "string" && t.twitter ? t.twitter : typeof t.twitter_url === "string" ? t.twitter_url : null,
        telegram: typeof t.telegram === "string" && t.telegram ? t.telegram : typeof t.telegram_url === "string" ? t.telegram_url : null,
        website: typeof t.website === "string" && t.website ? t.website : typeof t.website_url === "string" ? t.website_url : null,
      });
    }
    return rows;
  } catch {
    return [];
  }
}

async function nfMetadata(token: string) {
  const r = await fetch(`${NADFUN_BASE}/token/metadata/${token}`, {
    headers: { accept: "application/json", ...(NADFUN_KEY ? { "X-API-Key": NADFUN_KEY } : {}) },
  });
  if (!r.ok) return null;
  return r.json() as Promise<{ token_info?: Record<string, unknown>; market_info?: Record<string, unknown> }>;
}

async function scanLogsChunked(
  client: ReturnType<typeof createPublicClient>,
  opts: {
    address: Address;
    // Any parsed-ABI events array — V1 Create, V2 Create, or Factory
    // PairCreated. Kept loose so we can pass any of the parseAbi exports.
    events: readonly any[];
    fromBlock: bigint;
    toBlock: bigint;
  },
) {
  // Build the chunk windows up front, then fire all of them in parallel.
  // Serial chunks (the old impl) compounded latency — 8 chunks × 500ms RTT
  // = 4s just for the chunk loop. In parallel it's a single round trip
  // bounded by the slowest chunk.
  const windows: Array<{ from: bigint; to: bigint }> = [];
  for (let start = opts.fromBlock; start <= opts.toBlock; start += CHUNK) {
    const end = start + CHUNK - 1n > opts.toBlock ? opts.toBlock : start + CHUNK - 1n;
    windows.push({ from: start, to: end });
  }
  const results = await Promise.all(
    windows.map((w) =>
      client.getLogs({
        address: opts.address,
        events: opts.events,
        fromBlock: w.from,
        toBlock: w.to,
      }).catch(() => [] as any[]),
    ),
  );
  return results.flat();
}

/** Bonding-curve Create events — V1 + V2 mainnet curves. */
async function scanChainCreates(client: ReturnType<typeof createPublicClient>, lookback: bigint): Promise<RawAddr[]> {
  const head = await client.getBlockNumber();
  const from = head > lookback ? head - lookback : NADFUN_V2_MAINNET.deploymentBlocks.bondingCurve;
  const byToken = new Map<string, RawAddr>();

  // Each curve uses its own ABI bundle — they share the event name
  // `Create` but with different parameter shapes, so we can't put them
  // in a single parseAbi call (viem rejects duplicate event names).
  const allLogs = await Promise.all([
    scanLogsChunked(client, {
      address: NADFUN_V1_MAINNET_CURVE,
      events: BONDING_CURVE_V1_CREATE_ABI,
      fromBlock: from,
      toBlock: head,
    }),
    scanLogsChunked(client, {
      address: NADFUN_V2_MAINNET.bondingCurve,
      events: BONDING_CURVE_ABI,
      fromBlock: from,
      toBlock: head,
    }),
  ]);

  for (const log of allLogs.flat()) {
    const args = log.args as Record<string, unknown> | undefined;
    const address = String(args?.token ?? "").toLowerCase();
    const creator = String(args?.creator ?? "").toLowerCase() || null;
    if (!/^0x[a-f0-9]{40}$/.test(address)) continue;
    const prev = byToken.get(address);
    const blockNumber = log.blockNumber as bigint;
    if (!prev || blockNumber > prev.blockNumber) {
      byToken.set(address, { address, creator, blockNumber });
    }
  }
  return [...byToken.values()];
}

/** Recently graduated tokens — V2 BondingCurve.Graduate events. */
async function scanGraduations(client: ReturnType<typeof createPublicClient>, lookback: bigint): Promise<RawAddr[]> {
  const head = await client.getBlockNumber();
  const from = head > lookback ? head - lookback : NADFUN_V2_MAINNET.deploymentBlocks.bondingCurve;
  const logs = await scanLogsChunked(client, {
    address: NADFUN_V2_MAINNET.bondingCurve,
    events: BONDING_CURVE_ABI,
    fromBlock: from,
    toBlock: head,
  });

  const byToken = new Map<string, RawAddr>();
  for (const log of logs) {
    if (log.eventName !== "Graduate") continue;
    const args = log.args as Record<string, unknown> | undefined;
    const address = String(args?.token ?? "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) continue;
    const blockNumber = log.blockNumber as bigint;
    const prev = byToken.get(address);
    if (!prev || blockNumber > (prev.graduatedAtBlock ?? 0n)) {
      byToken.set(address, {
        address,
        creator: null,
        blockNumber: prev?.blockNumber ?? blockNumber,
        graduatedAtBlock: blockNumber,
      });
    }
  }
  return [...byToken.values()].sort((a, b) => Number((b.graduatedAtBlock ?? 0n) - (a.graduatedAtBlock ?? 0n)));
}

/** DEX PairCreated — meme token is the non-WMON side. */
async function scanDexPairs(client: ReturnType<typeof createPublicClient>, lookback: bigint): Promise<RawAddr[]> {
  const head = await client.getBlockNumber();
  const from = head > lookback ? head - lookback : NADFUN_V2_MAINNET.deploymentBlocks.nadFunFactory;
  const logs = await scanLogsChunked(client, {
    address: NADFUN_V2_MAINNET.nadFunFactory,
    events: NAD_FUN_FACTORY_ABI,
    fromBlock: from,
    toBlock: head,
  });

  const wmon = NADFUN_V2_MAINNET.wmon.toLowerCase();
  const rows: RawAddr[] = [];
  for (const log of logs) {
    if (log.eventName !== "PairCreated") continue;
    const args = log.args as Record<string, unknown> | undefined;
    const t0 = String(args?.token0 ?? "").toLowerCase();
    const t1 = String(args?.token1 ?? "").toLowerCase();
    const address = t0 === wmon ? t1 : t1 === wmon ? t0 : t0;
    if (!/^0x[a-f0-9]{40}$/.test(address)) continue;
    rows.push({
      address,
      creator: null,
      blockNumber: log.blockNumber as bigint,
      graduatedAtBlock: log.blockNumber as bigint,
    });
  }
  return rows;
}

/** DexScreener — Monad pairs, harvested via many query terms + token-boosts.
 *
 * DexScreener has no `list all pairs on chain X` endpoint; `/search` caps at
 * ~30 results per query. So we fan out over a long list of likely quote
 * tokens and stablecoins and dedupe. The token-boosts feed catches the
 * paid-trending tokens that are actively moving but might not surface in
 * any one search term. Combined, this typically yields 80–150 unique Monad
 * pairs per refresh — enough to make Migrated feel like DS-trending. */
async function scanDexScreenerRecent(): Promise<Map<string, DexMeta>> {
  const queries = [
    "monad", "nad.fun", "nad", "WMON", "MON",
    "USDC", "USDT", "WETH", "WBTC", "ETH", "BTC",
    "wnUSDC", "wnUSDT",
    // Topical / meme buckets — DS search is keyword-fuzzy so these
    // surface tokens whose name/symbol contains the term.
    "meme", "doge", "pepe", "cat", "moon", "pump", "ai",
  ];
  const byAddr = new Map<string, DexMeta>();

  type DsPair = {
    chainId: string;
    baseToken: { address: string; symbol?: string; name?: string };
    priceUsd?: string;
    marketCap?: number;
    fdv?: number;
    liquidity?: { usd?: number };
    volume?: { h24?: number };
    priceChange?: { h24?: number };
    info?: {
      imageUrl?: string;
      websites?: Array<{ label?: string; url?: string }>;
      socials?: Array<{ type?: string; url?: string }>;
    };
    pairCreatedAt?: number;
  };

  const ingest = (p: DsPair) => {
    if (p.chainId !== "monad") return;
    const address = p.baseToken.address.toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) return;
    const liq = Number(p.liquidity?.usd ?? 0) || 0;
    const pairCreatedAt = p.pairCreatedAt ?? null;
    // DexScreener splits social links into `socials[{type,url}]` (twitter,
    // telegram, discord, etc) and `websites[{label,url}]`. Pull what we
    // can — the icon row in the card uses whichever fields are set.
    const socials = p.info?.socials ?? [];
    const twitter = socials.find((s) => s.type?.toLowerCase() === "twitter")?.url ?? null;
    const telegram = socials.find((s) => s.type?.toLowerCase() === "telegram")?.url ?? null;
    const website = p.info?.websites?.[0]?.url ?? null;
    const row: DexMeta = {
      address,
      creator: null,
      blockNumber: 0n,
      symbol: p.baseToken.symbol,
      name: p.baseToken.name,
      imageUri: p.info?.imageUrl ?? null,
      twitter,
      telegram,
      website,
      priceUsd: Number(p.priceUsd) || null,
      volumeUsd: Number(p.volume?.h24) || null,
      liquidityUsd: liq || null,
      marketCapUsd: Number(p.marketCap ?? p.fdv) || null,
      priceChange24h: p.priceChange?.h24 != null ? Number(p.priceChange.h24) : null,
      pairCreatedAt,
    };
    const prev = byAddr.get(address);
    // Keep the row with the most data — prefer one that has volume/liq numbers.
    const score = (r: DexMeta) => (r.volumeUsd ?? 0) + (r.liquidityUsd ?? 0);
    if (!prev || score(row) > score(prev)) byAddr.set(address, row);
  };

  // Fan out — fire ALL search queries in parallel, ignore individual failures.
  await Promise.all(
    queries.map(async (q) => {
      try {
        const r = await fetch(`${DS_BASE}/search?q=${encodeURIComponent(q)}`);
        if (!r.ok) return;
        const j = (await r.json()) as { pairs?: DsPair[] };
        for (const p of j.pairs ?? []) ingest(p);
      } catch { /* skip */ }
    }),
  );

  // Token-boosts — DexScreener's "tokens getting attention" feed (paid +
  // organic). It's the closest thing to a chain-wide trending list. We
  // filter to Monad and then do a single batched /tokens/<addrs> lookup
  // to hydrate price/volume/liquidity for those that weren't covered by
  // the search queries above.
  try {
    const r = await fetch("https://api.dexscreener.com/token-boosts/latest/v1");
    if (r.ok) {
      const boosts = (await r.json()) as Array<{ chainId: string; tokenAddress: string }>;
      const monadAddrs = (Array.isArray(boosts) ? boosts : [])
        .filter((b) => b.chainId === "monad")
        .map((b) => b.tokenAddress.toLowerCase())
        .filter((a) => /^0x[a-f0-9]{40}$/.test(a) && !byAddr.has(a))
        .slice(0, 30);
      if (monadAddrs.length > 0) {
        // /tokens/<comma-separated> returns up to 30 tokens with all their pairs
        const hydrate = await fetch(`${DS_BASE}/tokens/${monadAddrs.join(",")}`);
        if (hydrate.ok) {
          const hj = (await hydrate.json()) as { pairs?: DsPair[] };
          for (const p of hj.pairs ?? []) ingest(p);
        }
      }
    }
  } catch { /* boosts is best-effort */ }

  return byAddr;
}

function classify(t: {
  isGraduated: boolean;
  progressBps: number;
  createdAtMs: number | null;
}): LandingToken["column"] | null {
  if (t.isGraduated) return "migrated";
  if (t.progressBps >= FINAL_MIN_BPS && t.progressBps <= FINAL_MAX_BPS) return "final";
  if (t.createdAtMs != null && Date.now() - t.createdAtMs <= NEW_WINDOW_MS) return "new";
  if (t.createdAtMs == null && t.progressBps < FINAL_MIN_BPS) return "new";
  return null;
}

let serverCache: { rows: LandingToken[]; at: number } | null = null;
const SERVER_TTL_MS = 25_000;
// Hard ceiling on how long the whole handler can run before we give up
// and return what we have. Vercel server fns have a ~10s wall by default.
const HANDLER_BUDGET_MS = 8_500;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => {
      console.warn(`[discovery] ${label} → timeout after ${ms}ms, using fallback`);
      resolve(fallback);
    }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); })
     .catch((e) => {
       clearTimeout(t);
       console.warn(`[discovery] ${label} → rejected:`, e?.message ?? e);
       resolve(fallback);
     });
  });
}

export const fetchDiscoveryLanding = createServerFn({ method: "GET" })
  .inputValidator((d: Record<string, never> | undefined) => d ?? {})
  .handler(async (): Promise<{ rows: LandingToken[]; fetchedAt: string }> => {
    // Serve the cache aggressively if anything goes wrong below.
    if (serverCache && Date.now() - serverCache.at < SERVER_TTL_MS) {
      return { rows: serverCache.rows, fetchedAt: new Date(serverCache.at).toISOString() };
    }

    // EVERYTHING below is wrapped — the route MUST NOT 500 the landing
    // page when the chain or an external API is misbehaving. If we hit
    // the budget we serve stale cache (if any) or just an empty array.
    const started = Date.now();
    try {
      // Phase 1 — Nad.fun core (New Pairs + Final Stretch). Must run before
      // chain/DexScreener work and must NOT be parallel-bursted (429 wipes UI).
      const [nfCreation, nfTopMcap] = await Promise.all([
        nfFetchCreationList(),
        nfFetchMarketCap(),
      ]);
      const nfCore = buildNfCoreLanding(nfCreation);
      const nfSeed = dedupeDexMeta([...nfCreation, ...nfTopMcap]);

      const client = createPublicClient({ chain: monad as any, transport: http(MONAD_RPC) }) as any;
      const lookback = 20_000n;

      // Phase 2 — migrated column enrichment (chain + DexScreener). Failures
      // here must never erase Phase 1 new/final rows.
      const [
        chainAddrs,
        graduations,
        dexPairs,
        dsMap,
        dirol,
      ] = await Promise.all([
        withTimeout(scanChainCreates(client, lookback), 4_000, [], "scanChainCreates"),
        withTimeout(scanGraduations(client, lookback),  4_000, [], "scanGraduations"),
        withTimeout(scanDexPairs(client, lookback),     4_000, [], "scanDexPairs"),
        withTimeout(scanDexScreenerRecent(),            5_000, new Map(), "scanDexScreenerRecent"),
        withTimeout(scanDirolTokens(),             4_000, [], "scanDirolTokens"),
      ]);

      // Fold Nad.fun + dirol rows into dsMap so the enrichment loop below
      // can read symbol/name/image/price without per-token HTTP calls.
      const seedDex = (m: DexMeta) => {
        const prev = dsMap.get(m.address);
        const score = (r: DexMeta) =>
          (r.volumeUsd ?? 0) + (r.liquidityUsd ?? 0) + (r.imageUri ? 1 : 0);
        if (!prev || score(m) > score(prev)) dsMap.set(m.address, m);
      };
      for (const m of nfSeed)          seedDex(m);
      for (const m of dirol)          seedDex(m);

    const addrMap = new Map<string, RawAddr>();
    const add = (a: RawAddr) => {
      const prev = addrMap.get(a.address);
      if (!prev) {
        addrMap.set(a.address, a);
        return;
      }
      if (a.blockNumber > prev.blockNumber) prev.blockNumber = a.blockNumber;
      if (a.graduatedAtBlock && (!prev.graduatedAtBlock || a.graduatedAtBlock > prev.graduatedAtBlock)) {
        prev.graduatedAtBlock = a.graduatedAtBlock;
      }
      if (!prev.creator && a.creator) prev.creator = a.creator;
    };
    for (const a of chainAddrs) add(a);
    for (const a of graduations) add(a);
    for (const a of dexPairs) add(a);
    for (const a of dsMap.values()) add(a);

    // Wider candidate cap — Nad.fun /order/* + dirol + DexScreener +
    // chain scans together can produce 300+ unique addresses. Cap at
    // 300 to fit the handler budget; per-token enrichment is mostly
    // skipped now (data pre-seeded from /order/*) so this is cheap.
    // Prioritise near-graduation tokens so on-chain enrichment doesn't drop them.
    const finalPriority = new Set(
      nfCreation
        .filter((r) => !r.nfGraduated && nfPercentToBps(r.bondingPercent) >= FINAL_MIN_BPS)
        .map((r) => r.address),
    );
    const allCandidates = [...addrMap.values()];
    const candidates = [
      ...allCandidates.filter((c) => finalPriority.has(c.address)),
      ...allCandidates.filter((c) => !finalPriority.has(c.address)),
    ].slice(0, 300);

    type Enriched = {
      address: string;
      creator: string | null;
      symbol: string;
      name: string;
      imageUri: string | null;
      createdAt: string | null;
      graduatedAt: string | null;
      isGraduated: boolean;
      priceUsd: number | null;
      volumeUsd: number | null;
      liquidityUsd: number | null;
      holderCount: number | null;
      totalSupply: string | null;
      progressBps: number;
      priceChange24h: number | null;
      marketCapUsd: number | null;
      twitter: string | null;
      telegram: string | null;
      website: string | null;
    };

    const enriched: Enriched[] = [];
    const BATCH = 10;
    for (let i = 0; i < candidates.length; i += BATCH) {
      const batch = candidates.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async (c): Promise<Enriched | null> => {
        const ds = dsMap.get(c.address);
        // Skip per-token /token/metadata if we already have what we need
        // from the bulk Nad.fun /order/* or dirol calls. Saves ~100ms ×
        // 200 candidates = 20s of latency we don't have.
        const hasFullDs = !!ds && !!ds.symbol && !!ds.imageUri;
        const meta = hasFullDs ? null : await nfMetadata(c.address);
        const ti = meta?.token_info;
        const mi = meta?.market_info ?? {};
        if (!ti && !ds && !c.graduatedAtBlock) return null;
        const usd = nadfunUsdFields(mi);
        const tokenReserve = Number(mi.reserve_token ?? 0);
        const totalSupply = Number(mi.total_supply ?? 0);
        const derivedProgress = totalSupply > 0
          ? Math.max(0, Math.min(10_000, Math.round((1 - tokenReserve / totalSupply) * 10_000)))
          : 0;

        const launchAt = ti?.created_at
          ? new Date(Number(ti.created_at) * 1000).toISOString()
          : ds?.launchedAtMs
            ? new Date(ds.launchedAtMs).toISOString()
            : null;
        const dexAt = ds?.pairCreatedAt ? new Date(ds.pairCreatedAt).toISOString() : null;
        const gradBlock = c.graduatedAtBlock;

        return {
          address: c.address,
          creator: c.creator ?? (ti?.creator as any)?.account_id?.toLowerCase() ?? null,
          symbol: String(ti?.symbol ?? ds?.symbol ?? c.address.slice(2, 6)),
          name: String(ti?.name ?? ds?.name ?? ti?.symbol ?? "Token"),
          imageUri: (ti?.image_uri as string) || ds?.imageUri || null,
          createdAt: launchAt ?? dexAt,
          graduatedAt: dexAt,
          isGraduated: !!ti?.is_graduated || !!ds?.nfGraduated || !!gradBlock || !!dexAt,
          priceUsd: usd.price_usd ?? ds?.priceUsd ?? null,
          volumeUsd: usd.volume_usd ?? ds?.volumeUsd ?? null,
          liquidityUsd: usd.liquidity_usd ?? ds?.liquidityUsd ?? null,
          holderCount: usd.holder_count,
          totalSupply: usd.total_supply,
          progressBps:
            ds?.bondingPercent != null
              ? nfPercentToBps(ds.bondingPercent)
              : derivedProgress,
          priceChange24h: ds?.priceChange24h ?? null,
          marketCapUsd: ds?.marketCapUsd ?? null,
          // Prefer Nad.fun's strings when present (richest source), then
          // anything DexScreener/dirol left in the seeded DexMeta.
          twitter: (typeof ti?.twitter === "string" && ti.twitter ? ti.twitter : null) ?? ds?.twitter ?? null,
          telegram: (typeof ti?.telegram === "string" && ti.telegram ? ti.telegram : null) ?? ds?.telegram ?? null,
          website: (typeof ti?.website === "string" && ti.website ? ti.website : null) ?? ds?.website ?? null,
        };
      }));
      enriched.push(...results.filter((x): x is Enriched => x !== null));
    }

    // On-chain graduation + curve progress (V2 router + getCurve + Lens).
    if (enriched.length > 0) {
      const calls = enriched.flatMap((t) => ([
        { address: NADFUN_V2_MAINNET.nadFunRouter, abi: NAD_FUN_ROUTER_ABI, functionName: "isGraduated" as const, args: [t.address as Address] },
        { address: NADFUN_V2_MAINNET.bondingCurve, abi: BONDING_CURVE_ABI, functionName: "getCurve" as const, args: [t.address as Address] },
        { address: NAD_LENS_MAINNET, abi: NAD_LENS_ABI, functionName: "getProgress" as const, args: [t.address as Address] },
      ]));
      try {
        const results = await client.multicall({ contracts: calls, allowFailure: true });
        for (let i = 0; i < enriched.length; i++) {
          const grad = results[i * 3];
          const curve = results[i * 3 + 1];
          const lens = results[i * 3 + 2];
          if (grad?.status === "success" && grad.result === true) {
            enriched[i].isGraduated = true;
            enriched[i].progressBps = 10_000;
          }
          if (curve?.status === "success" && curve.result) {
            const c = curve.result as {
              virtualTokenReserve: bigint;
              minTokenReserve: bigint;
              graduated: boolean;
            };
            if (c.graduated) {
              enriched[i].isGraduated = true;
              enriched[i].progressBps = 10_000;
            } else if (c.virtualTokenReserve > 0n) {
              enriched[i].progressBps = progressBpsFromCurve(
                c.virtualTokenReserve,
                c.minTokenReserve,
              );
            }
          }
          if (!enriched[i].isGraduated && lens?.status === "success") {
            enriched[i].progressBps = Math.max(0, Math.min(10_000, Number(lens.result) || 0));
          }
        }
      } catch { /* on-chain reads optional */ }
    }

    // Block timestamps for graduated tokens missing pairCreatedAt.
    const gradNeedingTs = enriched.filter((t) => t.isGraduated && !t.graduatedAt);
    const gradBlocks = candidates
      .filter((c) => c.graduatedAtBlock)
      .map((c) => c.graduatedAtBlock!)
      .filter((b, i, arr) => arr.indexOf(b) === i)
      .slice(0, 20);
    const blockTs = new Map<bigint, string>();
    await Promise.all(gradBlocks.map(async (bn) => {
      try {
        const b = await client.getBlock({ blockNumber: bn });
        blockTs.set(bn, new Date(Number(b.timestamp) * 1000).toISOString());
      } catch { /* skip */ }
    }));
    for (const t of gradNeedingTs) {
      const raw = candidates.find((c) => c.address === t.address);
      if (raw?.graduatedAtBlock) {
        const ts = blockTs.get(raw.graduatedAtBlock);
        if (ts) t.graduatedAt = ts;
      }
    }

    const rows: LandingToken[] = enriched.map((t) => {
      const createdAtMs = t.createdAt ? +new Date(t.createdAt) : null;
      const graduatedAtMs = t.graduatedAt ? +new Date(t.graduatedAt) : null;
      const col = classify({
        isGraduated: t.isGraduated,
        progressBps: t.progressBps,
        createdAtMs: t.isGraduated ? graduatedAtMs ?? createdAtMs : createdAtMs,
      });
      if (!col) return null;
      const supply = t.totalSupply ? Number(t.totalSupply) / 1e18 : null;
      const derivedMcap = t.priceUsd != null && supply != null ? t.priceUsd * supply : null;
      return {
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        imageUri: t.imageUri,
        creatorAddress: t.creator,
        column: col,
        createdAt: col === "migrated"
          ? (t.graduatedAt ?? t.createdAt)
          : t.createdAt,
        progressBps: t.progressBps,
        priceUsd: t.priceUsd,
        volumeUsd: t.volumeUsd,
        holderCount: t.holderCount,
        liquidityUsd: t.liquidityUsd,
        isGraduated: t.isGraduated,
        marketCapUsd: t.marketCapUsd ?? derivedMcap,
        priceChange24h: t.priceChange24h,
        twitter: t.twitter,
        telegram: t.telegram,
        website: t.website,
      };
    }).filter((x): x is LandingToken => x !== null);

    const allRows = mergeLandingRows(rows, nfCore, serverCache?.rows);

      serverCache = { rows: allRows, at: Date.now() };
      const elapsed = Date.now() - started;
      const newN = allRows.filter((r) => r.column === "new").length;
      const finalN = allRows.filter((r) => r.column === "final").length;
      console.log(
        `[discovery] built feed in ${elapsed}ms — ${allRows.length} rows`
        + ` (${newN} new, ${finalN} final from nad.fun)`,
      );
      return { rows: allRows, fetchedAt: new Date().toISOString() };
    } catch (e: any) {
      console.error("[discovery] handler crashed:", e?.message ?? e);
      if (serverCache) {
        // Serve stale rather than 500. Better something than nothing.
        return { rows: serverCache.rows, fetchedAt: new Date(serverCache.at).toISOString() };
      }
      return { rows: [], fetchedAt: new Date().toISOString() };
    } finally {
      const elapsed = Date.now() - started;
      if (elapsed > HANDLER_BUDGET_MS) {
        console.warn(`[discovery] handler ran ${elapsed}ms — over budget`);
      }
    }
  });
