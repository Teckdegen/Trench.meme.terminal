// Unified swap router. Dirol is the primary Monad route aggregator and already
// includes NadFun as a liquidity source. Direct Nad.fun quotes stay as fallback.

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, type Address } from "viem";
import {
  MONAD_MAINNET,
  NAD_FUN_LEGACY_LENS_ABI,
  NAD_FUN_ROUTER_ABI,
  NADFUN_MAINNET,
} from "@/lib/abis";
import { COMMON_TOKENS, useDirolQuote } from "@/lib/dirol";
import { type FeeKind } from "@/lib/fees";

export type Venue = "nadfun" | "dirol";

const nadfunClient = createPublicClient({
  chain: MONAD_MAINNET,
  transport: http(import.meta.env.VITE_MONAD_RPC_URL || "https://rpc.monad.xyz"),
});

export interface UnifiedQuote {
  venue: Venue;
  amountIn: string;
  amountOut: string;
  amountOutUsd?: string;
  priceImpactBps?: number;
  routes?: unknown;
  isLoading: boolean;
  error?: Error | null;
}

export function useUnifiedQuote(params: {
  token: string | undefined;
  side: "buy" | "sell";
  amount: string;
  slippageBps?: number;
  feeKind?: FeeKind;
  isGraduated?: boolean;
}): UnifiedQuote {
  const { token, side, amount } = params;
  const forceNadfun = params.isGraduated === false;
  const venue: Venue = forceNadfun ? "nadfun" : "dirol";

  // The full amount is swapped — the platform fee is charged EXTRA (on top),
  // not carved out of the input, so the quote uses the gross amount.
  const grossIn = (() => {
    try { return BigInt(amount || "0"); } catch { return 0n; }
  })();
  const quoteAmount = grossIn.toString();

  const dirol = useDirolQuote({
    tokenIn: side === "buy" ? COMMON_TOKENS.WMON : token,
    tokenOut: side === "buy" ? token : COMMON_TOKENS.WMON,
    amount: quoteAmount,
    slippageBps: params.slippageBps,
    enabled: !forceNadfun,
  });

  const directNadfun = useQuery({
    queryKey: ["nadfun-router-quote-fallback", token, side, quoteAmount, dirol.error ? "dirol-error" : "dirol-ok"],
    queryFn: async () => {
      if (!token || !/^0x[a-fA-F0-9]{40}$/.test(token)) return "0";
      const amountIn = BigInt(quoteAmount);
      const isBuy = side === "buy";
      try {
        const out = await nadfunClient.readContract({
          address: NADFUN_MAINNET.V2_NAD_FUN_ROUTER,
          abi: NAD_FUN_ROUTER_ABI,
          functionName: "getAmountOut",
          args: [token as Address, amountIn, isBuy],
        });
        return out.toString();
      } catch {
        const [, out] = await nadfunClient.readContract({
          address: NADFUN_MAINNET.LEGACY_LENS,
          abi: NAD_FUN_LEGACY_LENS_ABI,
          functionName: "getAmountOut",
          args: [token as Address, amountIn, isBuy],
        });
        return out.toString();
      }
    },
    enabled: !!token && quoteAmount !== "0" && (forceNadfun || !!dirol.error),
    staleTime: 5_000,
  });

  if (!forceNadfun && (dirol.data || !dirol.error)) {
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
    venue: "nadfun",
    amountIn: amount,
    amountOut: directNadfun.data ?? "0",
    amountOutUsd: undefined,
    priceImpactBps: undefined,
    routes: undefined,
    isLoading: directNadfun.isLoading,
    error: (directNadfun.error as Error | null) ?? null,
  };
}
