// GeckoTerminal fallback for OHLCV. Covers every Monad pool that's on any DEX
// (Uniswap V2/V3/V4, PancakeSwap, Kuru, Pinot, Taya, Capricorn, etc.) — i.e.
// every token Nad.fun doesn't index.
//
// Free public API, no key, ~30 req/min from a single IP. We call it server-side
// only so all browser traffic shares the rate limit.
//
// Docs: https://www.geckoterminal.com/dex-api

import type { BarResponse, ChartResolution } from "@/lib/nadfun/types";

const GT_BASE = "https://api.geckoterminal.com/api/v2";
const NETWORK = process.env.GECKOTERMINAL_NETWORK ?? "monad";

// GeckoTerminal accepts these timeframes:
//   timeframe=minute, aggregate=1 | 5 | 15
//   timeframe=hour,   aggregate=1 | 4 | 12
//   timeframe=day,    aggregate=1
function tvToGtParams(resolution: ChartResolution): { timeframe: "minute" | "hour" | "day"; aggregate: number } {
  switch (resolution) {
    case "1":   return { timeframe: "minute", aggregate: 1 };
    case "5":   return { timeframe: "minute", aggregate: 5 };
    case "15":  return { timeframe: "minute", aggregate: 15 };
    case "30":  return { timeframe: "minute", aggregate: 15 };   // GT has no 30m; round to 15
    case "60":
    case "1H":  return { timeframe: "hour",   aggregate: 1 };
    case "240":
    case "4H":  return { timeframe: "hour",   aggregate: 4 };
    case "D":
    case "1D":  return { timeframe: "day",    aggregate: 1 };
    case "W":
    case "1W":  return { timeframe: "day",    aggregate: 1 };    // GT has no week; UI can roll up
    case "M":
    case "1M":  return { timeframe: "day",    aggregate: 1 };
    default:    return { timeframe: "minute", aggregate: 5 };
  }
}

async function gt<T>(path: string): Promise<T> {
  const res = await fetch(`${GT_BASE}${path}`, {
    headers: { accept: "application/json;version=20230302" },
  });
  if (!res.ok) {
    throw new Error(`geckoterminal ${path} → ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return res.json() as Promise<T>;
}

// Find the highest-liquidity pool for a token on Monad.
async function topPoolForToken(tokenAddress: string): Promise<string | null> {
  type Resp = {
    data: { id: string; attributes: { address: string; reserve_in_usd?: string } }[];
  };
  const j = await gt<Resp>(`/networks/${NETWORK}/tokens/${tokenAddress}/pools?page=1`);
  if (!j.data || j.data.length === 0) return null;
  // GT returns them already sorted by liquidity; take #1.
  return j.data[0].attributes.address;
}

// Fetch OHLCV for a token by resolving its best pool then hitting /ohlcv.
// Returns data in Nad.fun's BarResponse shape so the datafeed doesn't care
// which backend served it.
export async function gtChart(params: {
  token: string;
  resolution: ChartResolution;
  from: number;            // unix seconds
  to: number;              // unix seconds
  countback?: number;
}): Promise<BarResponse> {
  const pool = await topPoolForToken(params.token);
  if (!pool) {
    return { k: "price", t: [], c: [], o: [], h: [], l: [], v: [], s: "no_data" };
  }
  const { timeframe, aggregate } = tvToGtParams(params.resolution);
  const limit = Math.min(1000, params.countback ?? 500);
  const url =
    `/networks/${NETWORK}/pools/${pool}/ohlcv/${timeframe}` +
    `?aggregate=${aggregate}` +
    `&before_timestamp=${params.to}` +
    `&limit=${limit}` +
    `&currency=usd&token=base`;

  type OhlcvResp = {
    data: { attributes: { ohlcv_list: [number, number, number, number, number, number][] } };
  };
  const j = await gt<OhlcvResp>(url);
  const list = j?.data?.attributes?.ohlcv_list ?? [];
  if (list.length === 0) {
    return { k: "price", t: [], c: [], o: [], h: [], l: [], v: [], s: "no_data" };
  }
  // GeckoTerminal returns newest-first; TradingView expects oldest-first.
  list.reverse();
  // Filter to the requested window
  const filtered = list.filter(([t]) => t >= params.from && t <= params.to);

  return {
    k: "price_usd",
    t: filtered.map((r) => r[0]),
    o: filtered.map((r) => String(r[1])),
    h: filtered.map((r) => String(r[2])),
    l: filtered.map((r) => String(r[3])),
    c: filtered.map((r) => String(r[4])),
    v: filtered.map((r) => String(r[5])),
    s: "ok",
  };
}
