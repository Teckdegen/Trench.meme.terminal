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
