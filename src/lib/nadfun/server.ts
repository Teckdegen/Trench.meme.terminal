// Server-side Nad.fun proxy. Keeps the API key off the browser and lets us
// add caching / rate limiting in one place. Hits api.nad.fun (mainnet).

import { createServerFn } from "@tanstack/react-start";
import type {
  TokenMetadataResponse, MarketResponse, BarResponse,
  MetricsBatchResponse, TokenSwapResponse, TokenHolderResponse,
  ChartResolution, ChartType, MetricTimeframe,
} from "./types";
import { dsTokenMetadata, dsMarketOnly } from "./dexscreener";
import { gtChart } from "@/lib/geckoterminal";

const BASE = process.env.NADFUN_API_BASE ?? "https://api.nad.fun";
const KEY = process.env.NADFUN_API_KEY ?? "";

async function nf<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "accept": "application/json",
      ...(KEY ? { "X-API-Key": KEY } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`nadfun ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// --- Token metadata + market in one call ---------------------------------
export const fetchTokenMetadata = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    try {
      return await nf<TokenMetadataResponse>(`/token/metadata/${data.token}`);
    } catch (e) {
      // Fall back to DexScreener for tokens nad.fun doesn't index
      // (e.g. tokens not launched through their launchpad).
      console.warn(`[nadfun] metadata fallback → dexscreener for ${data.token}`, e);
      return await dsTokenMetadata(data.token);
    }
  });

// --- Latest market snapshot (cheaper than /metadata) ---------------------
export const fetchMarket = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    try {
      return await nf<MarketResponse>(`/trade/market/${data.token}`);
    } catch (e) {
      console.warn(`[nadfun] market fallback → dexscreener for ${data.token}`, e);
      return await dsMarketOnly(data.token);
    }
  });

// --- OHLCV candles -------------------------------------------------------
// 1. Try Nad.fun (covers curve + their graduated tokens with full per-second data)
// 2. Fall back to GeckoTerminal (covers every other Monad pool — Uniswap, Pancake,
//    Kuru, Pinot, Taya, Capricorn, etc.)
export const fetchChart = createServerFn({ method: "GET" })
  .inputValidator((d: {
    token: string;
    resolution?: ChartResolution;
    from: number;
    to: number;
    countback?: number;
    chart_type?: ChartType;
  }) => d)
  .handler(async ({ data }) => {
    const resolution = data.resolution ?? "5";
    try {
      const q = new URLSearchParams({
        from: String(data.from),
        to: String(data.to),
        resolution,
        countback: String(data.countback ?? 500),
        chart_type: data.chart_type ?? "price_usd",
      });
      const r = await nf<BarResponse>(`/trade/chart/${data.token}?${q}`);
      if (r.s === "ok" && r.t.length > 0) return r;
      // Nad.fun returned no_data — try GT
      throw new Error("nadfun returned no_data");
    } catch (e) {
      console.warn(`[chart] nadfun → gecko fallback for ${data.token}`, e instanceof Error ? e.message : e);
      return gtChart({
        token: data.token,
        resolution,
        from: data.from,
        to: data.to,
        countback: data.countback,
      });
    }
  });

// --- Price change over arbitrary windows (from OHLCV) -------------------
// Computes % price change for 5m / 1h / 6h / 12h / 24h straight from 5-minute
// candles (Nad.fun first, GeckoTerminal fallback). Returns null per window
// when the token is younger than that window.
async function ohlcv(token: string, resolution: ChartResolution, from: number, to: number, countback: number): Promise<BarResponse> {
  try {
    const q = new URLSearchParams({
      from: String(from), to: String(to), resolution,
      countback: String(countback), chart_type: "price_usd",
    });
    const r = await nf<BarResponse>(`/trade/chart/${token}?${q}`);
    if (r.s === "ok" && r.t.length > 0) return r;
    throw new Error("no_data");
  } catch {
    return gtChart({ token, resolution, from, to, countback });
  }
}

export type PriceChanges = {
  m5: number | null;
  h1: number | null;
  h6: number | null;
  h12: number | null;
  h24: number | null;
};

const EMPTY_CHANGES: PriceChanges = { m5: null, h1: null, h6: null, h12: null, h24: null };

// Server-side cache so the Explore list (many tokens) doesn't re-fetch OHLCV
// every poll and blow past the GeckoTerminal/Nad.fun rate limits.
const _pcCache = new Map<string, { v: PriceChanges; at: number }>();
const PC_TTL_MS = 60_000;

async function computePriceChanges(token: string): Promise<PriceChanges> {
  const key = token.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(key)) return EMPTY_CHANGES;
  const cached = _pcCache.get(key);
  if (cached && Date.now() - cached.at < PC_TTL_MS) return cached.v;

  const now = Math.floor(Date.now() / 1000);
  const from = now - 25 * 3600; // a touch over 24h of headroom
  // 5-min candles over ~25h ≈ 300 candles in ONE response — fine granularity.
  const bars = await ohlcv(key, "5", from, now, 320).catch(() => null);
  if (!bars || bars.s !== "ok" || bars.t.length === 0) {
    _pcCache.set(key, { v: EMPTY_CHANGES, at: Date.now() });
    return EMPTY_CHANGES;
  }

  const t = bars.t;
  const c = bars.c.map((x) => Number(x));
  const last = c[c.length - 1];
  if (!(last > 0)) { _pcCache.set(key, { v: EMPTY_CHANGES, at: Date.now() }); return EMPTY_CHANGES; }
  const nowTs = t[t.length - 1];

  const changeFor = (windowSec: number): number | null => {
    const target = nowTs - windowSec;
    if (t[0] > target) return null; // not enough history for this window
    let idx = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] <= target) idx = i;
      else break;
    }
    const past = c[idx];
    if (!(past > 0)) return null;
    return ((last - past) / past) * 100;
  };

  const v: PriceChanges = {
    m5: changeFor(5 * 60),
    h1: changeFor(60 * 60),
    h6: changeFor(6 * 3600),
    h12: changeFor(12 * 3600),
    h24: changeFor(24 * 3600),
  };
  _pcCache.set(key, { v, at: Date.now() });
  return v;
}

export const fetchPriceChanges = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data }): Promise<PriceChanges> => computePriceChanges(data.token));

// Batched price changes for the Explore list. Caps the set, runs limited
// concurrency, and leans on the per-token cache so repeat polls are cheap.
export const fetchPriceChangesBatch = createServerFn({ method: "GET" })
  .inputValidator((d: { tokens: string[] }) => d)
  .handler(async ({ data }): Promise<Record<string, PriceChanges>> => {
    const tokens = [...new Set((data.tokens ?? [])
      .map((x) => String(x).toLowerCase())
      .filter((x) => /^0x[a-f0-9]{40}$/.test(x)))].slice(0, 50);

    const out: Record<string, PriceChanges> = {};
    const CONCURRENCY = 5;
    let cursor = 0;
    async function worker() {
      while (cursor < tokens.length) {
        const tk = tokens[cursor++];
        try { out[tk] = await computePriceChanges(tk); }
        catch { out[tk] = EMPTY_CHANGES; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tokens.length) }, worker));
    return out;
  });

// --- Multi-timeframe metrics --------------------------------------------
export const fetchMetrics = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string; timeframes?: MetricTimeframe[] }) => d)
  .handler(async ({ data }) => {
    const tfs = (data.timeframes ?? ["1", "5", "15", "30", "60", "240", "1D"]).join(",");
    return nf<MetricsBatchResponse>(
      `/trade/metrics/${data.token}?timeframes=${tfs}`,
    );
  });

// --- Swap history (with optional account filter for profile pages) -------
export const fetchSwapHistory = createServerFn({ method: "GET" })
  .inputValidator((d: {
    token: string;
    page?: number;
    limit?: number;
    account_id?: string;
    trade_type?: "BUY" | "SELL" | "ALL";
  }) => d)
  .handler(async ({ data }) => {
    const q = new URLSearchParams({
      page: String(data.page ?? 1),
      limit: String(data.limit ?? 50),
    });
    if (data.account_id) q.set("account_id", data.account_id);
    if (data.trade_type) q.set("trade_type", data.trade_type);
    return nf<TokenSwapResponse>(`/trade/swap-history/${data.token}?${q}`);
  });

// --- Holders -------------------------------------------------------------
export const fetchHolders = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string; page?: number; limit?: number }) => d)
  .handler(async ({ data }) => {
    const q = new URLSearchParams({
      page: String(data.page ?? 1),
      limit: String(data.limit ?? 50),
    });
    return nf<TokenHolderResponse>(`/trade/holder/${data.token}?${q}`);
  });
