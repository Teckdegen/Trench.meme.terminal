// Trade entry point. Buy/Sell goes through the server fn so Para signs with
// the exported embedded-wallet session and never opens a transaction popup.

import { useState, useCallback } from "react";
import {
  createPublicClient,
  http,
  parseAbi,
  type Hex,
  type Address,
} from "viem";
import { MONAD_MAINNET } from "@/lib/para";
import { executeServerSwap } from "@/lib/para-session";
import { supabase } from "@/lib/supabase";
import { notifyTrade, notifyTradeFailed } from "@/lib/trade-fx";
import { autoShowPnLCard } from "@/components/PnLShareCard";

const publicClient = createPublicClient({
  chain: MONAD_MAINNET,
  transport: http(import.meta.env.VITE_MONAD_RPC_URL || "https://rpc.monad.xyz"),
});

const ERC20_BALANCE_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function tokenBalance(token: Address, owner: Address) {
  return await publicClient.readContract({
    address: token,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
}

async function waitForBuyBalanceIncrease(p: ExecParams, before: bigint | null) {
  if (before === null) return;
  await sleep(4_000);
  for (let i = 0; i < 4; i += 1) {
    const after = await tokenBalance(p.tokenAddress, p.recipient);
    if (after > before) return;
    await sleep(1_500);
  }
  throw new Error("Buy transaction confirmed, but token balance did not increase yet.");
}

export type ExecParams = {
  venue: "nadfun" | "dirol";
  side: "buy" | "sell";
  tokenAddress: Address;
  rawAmount: bigint;
  recipient: Address;
  slippageBps: number;
  source?: "market" | "limit" | "copy";
  // Optional: used purely for the toast title — pass the token symbol you
  // already display in the buy/sell card so the user sees "Bought 120 $MOON"
  // instead of "Bought 0x123…789".
  symbol?: string;
  // Optional USD value for the toast subtitle.
  usdValue?: number;
  // Accepted but currently ignored — the server fn computes slippage from
  // slippageBps. Kept on the type so existing callers don't break.
  amountOutMin?: bigint;
};

export async function executeSwap(p: ExecParams): Promise<Hex> {
  const hash = await executeServerSwap({ data: {
    owner: p.recipient,
    venue: p.venue,
    side: p.side === "buy" ? "BUY" : "SELL",
    tokenAddress: p.tokenAddress,
    amountIn: p.rawAmount.toString(),
    slippageBps: p.slippageBps,
    source: p.source ?? "market",
  }});
  return hash as Hex;
}

// React hook wrapper with state
export function useSwapExecute() {
  const [pending, setPending] = useState(false);
  const [hash, setHash] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (p: ExecParams) => {
    setPending(true); setError(null); setHash(null);
    try {
      const beforeTokenBalance = p.side === "buy"
        ? await tokenBalance(p.tokenAddress, p.recipient).catch(() => null)
        : null;
      const h = await executeSwap(p);
      if (p.side === "buy") await waitForBuyBalanceIncrease(p, beforeTokenBalance);
      setHash(h);
      // Sound + toast — fire-and-forget so a UI hiccup never blocks the
      // successful trade signal.
      try {
        notifyTrade({
          side: p.side,
          symbol: p.symbol ?? `${p.tokenAddress.slice(0, 6)}…${p.tokenAddress.slice(-4)}`,
          amount: p.side === "buy"
            ? Number(p.rawAmount) / 1e18 + " MON spent"
            : Number(p.rawAmount) / 1e18,
          usdValue: p.usdValue,
          txHash: h,
        });
      } catch {}

      // On a SELL we can compute realized PnL from the user's position →
      // auto-pop the PnL share card. On a BUY there's no realized PnL yet,
      // so skip (user can still hit Share from their position later).
      if (p.side === "sell") {
        showPnLForSell(p).catch(() => {});
      }
      return h;
    } catch (e: any) {
      const raw = e?.shortMessage ?? e?.message ?? String(e);
      // Strip JSON-RPC noise so the toast description reads cleanly.
      const msg = raw
        .replace(/^Error: /, "")
        .replace(/\(.*?\)$/, "")
        .trim();
      const friendly =
        /insufficient (funds|balance)/i.test(msg) ? "Insufficient funds in all selected wallets" :
        /reverted/i.test(msg)                      ? "Transaction reverted" :
        /rejected|denied/i.test(msg)               ? "Transaction rejected" :
        /session/i.test(msg)                       ? "Session expired — sign in again" :
        msg.length > 80                            ? msg.slice(0, 80) + "…"
        : msg;

      setError(msg);
      try {
        notifyTradeFailed({
          side: p.side,
          symbol: p.symbol ?? `${p.tokenAddress.slice(0, 6)}…${p.tokenAddress.slice(-4)}`,
          reason: friendly,
        });
      } catch {}
      throw e;
    } finally { setPending(false); }
  }, []);

  return { run, pending, hash, error };
}

// Look up the user's position to compute realized PnL on this sell, then
// pop the PnL share card. Best-effort — silently no-ops if Supabase isn't
// wired or there's no position row yet.
async function showPnLForSell(p: ExecParams) {
  try {
    const me = p.recipient.toLowerCase();
    const tok = p.tokenAddress.toLowerCase();
    const sb = supabase();
    // Pull cost basis + symbol/image
    const [{ data: pos }, { data: tokRow }, { data: mkt }] = await Promise.all([
      sb.from("position_snapshots").select("avg_cost_usd, realized_usd, balance")
        .eq("account_address", me).eq("token_address", tok).maybeSingle(),
      sb.from("tokens").select("symbol, image_uri").eq("address", tok).maybeSingle(),
      sb.from("token_markets").select("price_usd").eq("token_address", tok).maybeSingle(),
    ]);
    const symbol = (tokRow as any)?.symbol ?? p.symbol ?? "???";
    const image  = (tokRow as any)?.image_uri ?? null;
    const avgCost = Number((pos as any)?.avg_cost_usd ?? 0);
    const exitPrice = Number((mkt as any)?.price_usd ?? 0);
    const soldTokens = Number(p.rawAmount) / 1e18;

    if (!avgCost || !exitPrice || !soldTokens) {
      // Not enough data to compute PnL — show the card with no headline
      autoShowPnLCard({ symbol, tokenImage: image, side: "Sell" });
      return;
    }

    const cost = avgCost * soldTokens;
    const proceeds = exitPrice * soldTokens;
    const pnlUsd = proceeds - cost;
    const pnlPct = cost > 0 ? (pnlUsd / cost) * 100 : 0;
    const multiplier = avgCost > 0 ? exitPrice / avgCost : 0;

    autoShowPnLCard({
      symbol, tokenImage: image, side: "Sell",
      pnlUsd, pnlPct,
      multiplier: multiplier >= 2 ? multiplier : undefined,
      entry: `$${avgCost.toPrecision(3)}`,
      exit:  `$${exitPrice.toPrecision(3)}`,
    });
  } catch {
    /* silent — share card is a nice-to-have */
  }
}

// ─────────────── Limit orders (queued for the keeper) ──────────────
export async function createLimitOrder(input: {
  owner: string;
  tokenAddress: string;
  side: "BUY" | "SELL";
  amountIn: bigint;
  limitPriceUsd: number;
  slippageBps: number;
  expiresAt?: Date;
}) {
  const { error } = await supabase().from("limit_orders").insert({
    owner_address: input.owner.toLowerCase(),
    token_address: input.tokenAddress.toLowerCase(),
    side: input.side,
    amount_in: input.amountIn.toString(),
    limit_price_usd: input.limitPriceUsd,
    slippage_pct: input.slippageBps / 100,
    expires_at: input.expiresAt?.toISOString() ?? null,
    status: "open",
  });
  if (error) throw error;
}
