// Dirol API — Monad Mainnet routing aggregator.
// Used for:
//   * Token search (Topbar)              → /tokens
//   * Pricing graduated tokens           → /quote
//   * Executing swaps on graduated tokens → /swap
// Pre-graduation bonding-curve tokens go through Nad.fun (see ./nadfun) instead.

import { createServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";

const BASE = "https://api.dirol.io/api/v1";
export const DIROL_AGGREGATOR = "0x646462f4d0168A94fE1884c8ae82148a3618A18d" as const;
export const MONAD_CHAIN_ID = 143 as const;

// Common token addresses on Monad mainnet
export const COMMON_TOKENS = {
  WMON: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
  USDC: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  USDT: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D",
  WETH: "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242",
  WBTC: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
} as const;

export interface DirolToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string;
  isVerified: boolean;
}

export interface DirolRouteStep {
  pool: string;
  poolType: string;
  tokenIn: string;
  tokenOut: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  factory: string;
  factoryAddress: string;
  amountIn: string;
  amountOut: string;
  weight: number;
}

export interface DirolQuote {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  routes: DirolRouteStep[];
  priceImpactBps: number;
  amountInUsd: string;
  amountOutUsd: string;
}

export interface DirolSwap extends DirolQuote {
  tx: {
    to: string;
    data: `0x${string}`;
    value: string;
    estimatedGas: string;
  };
}

export const searchTokens = createServerFn({ method: "GET" })
  .inputValidator((d: { search?: string; limit?: number }) => d)
  .handler(async ({ data }) => {
    const q = new URLSearchParams();
    if (data.search) q.set("search", data.search);
    q.set("limit", String(data.limit ?? 20));
    const res = await fetch(`${BASE}/tokens?${q}`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`dirol /tokens → ${res.status}`);
    const j = (await res.json()) as { tokens: DirolToken[] };
    return j.tokens ?? [];
  });

// Full Monad token universe — what powers the landing page.
//
// Dirol's /tokens endpoint returns every token they've indexed across
// Monad's bonding curves + DEXs. We page through it (their API caps
// each page at a few hundred) and concatenate. Cached server-side for
// 60s — the universe doesn't churn that fast.
export const fetchAllDirolTokens = createServerFn({ method: "GET" })
  .inputValidator((d: { force?: boolean } | undefined) => d ?? {})
  .handler(async ({ data }): Promise<DirolToken[]> => {
    const now = Date.now();
    if (!data.force && _allTokensCache && _allTokensCache.expires > now) {
      return _allTokensCache.value;
    }
    // Pull a big page first. Dirol's max appears to be ~500 per call —
    // we try 1000 and accept whatever they return.
    const out: DirolToken[] = [];
    const seen = new Set<string>();
    try {
      const r = await fetch(`${BASE}/tokens?limit=1000`, {
        headers: { accept: "application/json" },
      });
      if (r.ok) {
        const j: any = await r.json();
        for (const t of (j?.tokens ?? []) as DirolToken[]) {
          const a = t.address?.toLowerCase();
          if (!a || seen.has(a)) continue;
          seen.add(a);
          out.push({ ...t, address: a });
        }
      }
    } catch (e) {
      console.warn("[dirol] /tokens fetch failed:", e);
    }
    _allTokensCache = { value: out, expires: now + 60_000 };
    return out;
  });

let _allTokensCache: { value: DirolToken[]; expires: number } | null = null;

// Debounced search hook. Returns [] until the input has ≥ 2 chars.
//
// Uses the multi-source resolveToken server fn under the hood so the
// search bar can find ANY token, not just ones Dirol indexes:
//   1. Dirol (preferred — fast, has logos, returns multiple matches for text)
//   2. Nad.fun /token/<addr>    (fallback for fresh bonding-curve launches)
//   3. RPC ERC-20 reads          (last resort — name/symbol/decimals)
//
// For pure text queries (not an address) we still hit Dirol's text
// search and stop there — fallbacks only fire when the query is a 0x
// address AND Dirol came up empty.
export function useTokenSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["token-search", trimmed.toLowerCase()],
    queryFn: async () => {
      // Lazy-import the resolver so the search component doesn't pull
      // in the viem RPC dep until the user actually opens search.
      const { resolveToken } = await import("@/lib/token-resolver");
      return resolveToken({ data: { query: trimmed } });
    },
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
  });
}

// ---------- /quote ------------------------------------------------------
export const dirolQuote = createServerFn({ method: "GET" })
  .inputValidator((d: {
    tokenIn: string;
    tokenOut: string;
    amount: string;             // raw units
    slippageBps?: number;
    excludeSources?: string;
  }) => d)
  .handler(async ({ data }) => {
    const q = new URLSearchParams({
      tokenIn: data.tokenIn,
      tokenOut: data.tokenOut,
      amount: data.amount,
    });
    if (data.slippageBps != null) q.set("slippageBps", String(data.slippageBps));
    if (data.excludeSources) q.set("excludeSources", data.excludeSources);
    const res = await fetch(`${BASE}/quote?${q}`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`dirol /quote → ${res.status}: ${await res.text().catch(() => "")}`);
    return (await res.json()) as DirolQuote;
  });

export function useDirolQuote(params: {
  tokenIn?: string;
  tokenOut?: string;
  amount?: string;
  slippageBps?: number;
  enabled?: boolean;
}) {
  const ready = !!params.tokenIn && !!params.tokenOut && !!params.amount && params.amount !== "0";
  return useQuery({
    queryKey: ["dirol", "quote", params],
    queryFn: () => dirolQuote({
      data: {
        tokenIn: params.tokenIn!,
        tokenOut: params.tokenOut!,
        amount: params.amount!,
        slippageBps: params.slippageBps,
      },
    }),
    enabled: ready && (params.enabled ?? true),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

// ---------- /swap (signable tx) -----------------------------------------
export const dirolSwap = createServerFn({ method: "GET" })
  .inputValidator((d: {
    tokenIn: string;
    tokenOut: string;
    amount: string;
    recipient: string;
    slippageBps?: number;
    excludeSources?: string;
  }) => d)
  .handler(async ({ data }) => {
    const q = new URLSearchParams({
      tokenIn: data.tokenIn,
      tokenOut: data.tokenOut,
      amount: data.amount,
      recipient: data.recipient,
    });
    if (data.slippageBps != null) q.set("slippageBps", String(data.slippageBps));
    if (data.excludeSources) q.set("excludeSources", data.excludeSources);
    const res = await fetch(`${BASE}/swap?${q}`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`dirol /swap → ${res.status}: ${await res.text().catch(() => "")}`);
    return (await res.json()) as DirolSwap;
  });
