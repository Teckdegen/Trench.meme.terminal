// Free MON/USD price via CoinGecko (no API key). Cached server-side ~60s.

import { createServerFn } from "@tanstack/react-start";

const CG_URL = "https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd";
const DS_FALLBACK = "https://api.dexscreener.com/latest/dex/search?q=WMON";

let cache: { usd: number; at: number } | null = null;
const TTL_MS = 60_000;

async function fetchFromCoinGecko(): Promise<number | null> {
  try {
    const r = await fetch(CG_URL, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json() as { monad?: { usd?: number } };
    const p = Number(j?.monad?.usd);
    return p > 0 && isFinite(p) ? p : null;
  } catch {
    return null;
  }
}

async function fetchFromDexScreener(): Promise<number | null> {
  try {
    const r = await fetch(DS_FALLBACK, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json() as {
      pairs?: Array<{ chainId: string; priceUsd?: string; baseToken?: { symbol?: string } }>;
    };
    const pair = (j.pairs ?? []).find(
      (p) => p.chainId === "monad" && (p.baseToken?.symbol === "WMON" || p.baseToken?.symbol === "MON"),
    );
    const p = Number(pair?.priceUsd);
    return p > 0 && isFinite(p) ? p : null;
  } catch {
    return null;
  }
}

export async function getMonUsdPrice(): Promise<{ usd: number; source: "coingecko" | "dexscreener" | "cache" }> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return { usd: cache.usd, source: "cache" };
  }
  const cg = await fetchFromCoinGecko();
  if (cg != null) {
    cache = { usd: cg, at: now };
    return { usd: cg, source: "coingecko" };
  }
  const ds = await fetchFromDexScreener();
  if (ds != null) {
    cache = { usd: ds, at: now };
    return { usd: ds, source: "dexscreener" };
  }
  if (cache) return { usd: cache.usd, source: "cache" };
  return { usd: 0, source: "cache" };
}

export const fetchMonUsd = createServerFn({ method: "GET" })
  .handler(async () => getMonUsdPrice());

/** Convert Nad.fun volume field (often quote-token wei) to USD. */
export function volumeToUsd(
  volRaw: number | string | null | undefined,
  mi: { quote_price?: string | number; native_price?: string | number; market_type?: string } | null | undefined,
  monUsd: number,
): number | null {
  const vol = Number(volRaw ?? 0);
  if (!vol || !isFinite(vol)) return null;

  const marketType = String(mi?.market_type ?? "");
  // DexScreener fallback — volume.h24 is already USD.
  if (marketType.includes("DEX") && vol < 1e12) return vol;

  // On-chain wei volume — divide by 1e18 and multiply by MON/quote USD (CoinGecko).
  if (vol >= 1e9) {
    const quotePx = Number(mi?.quote_price ?? mi?.native_price ?? 0);
    const quoteUsd = quotePx > 0 && quotePx < 10_000 ? quotePx : monUsd;
    if (quoteUsd <= 0) return null;
    return (vol / 1e18) * quoteUsd;
  }

  return vol;
}
