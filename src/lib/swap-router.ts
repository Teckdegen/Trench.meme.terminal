// Unified swap router. Picks the right execution venue per token:
//
//   * Bonding-curve (un-graduated)   → Nad.fun (NadFunRouter v2)
//   * Graduated to DEX               → Dirol aggregator (best of 24+ sources)
//
// Both paths produce a normalized { amountOut, priceUsd, route, exec } shape
// so the buy/sell card doesn't care which venue it's hitting.

import { useQuery } from "@tanstack/react-query";
import { useTokenMetadata } from "@/lib/nadfun/hooks";
import { useDirolQuote, COMMON_TOKENS } from "@/lib/dirol";
import { computeFee, feesConfigured, type FeeKind } from "@/lib/fees";

export type Venue = "nadfun" | "dirol";

export interface UnifiedQuote {
  venue: Venue;
  amountIn: string;         // raw units
  amountOut: string;        // raw units
  amountOutUsd?: string;
  priceImpactBps?: number;
  routes?: unknown;
  isLoading: boolean;
  error?: Error | null;
}

/**
 * Get an Expected-output quote for buying or selling a token.
 *
 * @param token       Token contract address being bought or sold.
 * @param side        "buy"  = MON in, token out
 *                    "sell" = token in, MON out
 * @param amount      Raw integer string. For buys this is MON amount,
 *                    for sells this is token amount.
 * @param slippageBps Optional; defaults to 50 (0.5%).
 */
export function useUnifiedQuote(params: {
  token: string | undefined;
  side: "buy" | "sell";
  amount: string;
  slippageBps?: number;
  feeKind?: FeeKind;
  /** When set, skips the Nad.fun metadata round-trip. */
  isGraduated?: boolean;
}): UnifiedQuote {
  const { token, side, amount, slippageBps, isGraduated: graduatedOverride } = params;
  const meta = useTokenMetadata(graduatedOverride === undefined ? token : undefined);
  const isGraduated = graduatedOverride ?? !!meta.data?.token_info.is_graduated;
  const venue: Venue = isGraduated ? "dirol" : "nadfun";

  // Quote the NET amount (input minus the silent platform fee) so the
  // Expected number the user sees matches what they actually receive.
  // Disabled when no fee wallet is configured.
  const grossIn = (() => {
    try { return BigInt(amount || "0"); } catch { return 0n; }
  })();
  const { net: netIn } = feesConfigured()
    ? computeFee(grossIn, params.feeKind ?? "market")
    : { net: grossIn };
  const quoteAmount = netIn.toString();

  const dirol = useDirolQuote({
    tokenIn: side === "buy" ? COMMON_TOKENS.WMON : token,
    tokenOut: side === "buy" ? token : COMMON_TOKENS.WMON,
    amount: quoteAmount,
    slippageBps,
    enabled: venue === "dirol",
  });

  // Nad.fun price is exposed in the market_info — for now we estimate
  // amountOut = amount * priceUsdOfTokenSide (until we add the SDK call).
  // This gives the buy/sell card a reasonable Expected number on curve tokens.
  const nadfun = useQuery({
    queryKey: ["nadfun-quote", token, side, quoteAmount],
    queryFn: async () => {
      const m = meta.data!.market_info;
      const priceMon = Number(m.price_native);             // token price in MON
      const amt = Number(quoteAmount) / 1e18;              // already net of fee
      let out: number;
      if (side === "buy") {
        out = priceMon > 0 ? amt / priceMon : 0;           // MON in → token out
      } else {
        out = amt * priceMon;                              // token in → MON out
      }
      return {
        amountOut: BigInt(Math.floor(out * 1e18)).toString(),
        priceUsd: Number(m.price_usd),
      };
    },
    enabled: venue === "nadfun" && !!meta.data && !!quoteAmount && quoteAmount !== "0",
    staleTime: 5_000,
  });

  if (venue === "dirol") {
    return {
      venue,
      amountIn: amount,
      amountOut: dirol.data?.amountOut ?? "0",
      amountOutUsd: dirol.data?.amountOutUsd,
      priceImpactBps: dirol.data?.priceImpactBps,
      routes: dirol.data?.routes,
      isLoading: dirol.isLoading,
      error: (dirol.error as Error | null) ?? null,
    };
  }
  return {
    venue,
    amountIn: amount,
    amountOut: nadfun.data?.amountOut ?? "0",
    amountOutUsd: nadfun.data?.priceUsd ? String(nadfun.data.priceUsd) : undefined,
    priceImpactBps: undefined,
    routes: undefined,
    isLoading: meta.isLoading || nadfun.isLoading,
    error: (nadfun.error as Error | null) ?? null,
  };
}
