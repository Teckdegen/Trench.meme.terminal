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

async function waitForConfirmedTransaction(hash: Hex) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`Transaction reverted (${hash})`);
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
      await waitForConfirmedTransaction(h);
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
        showPnLForSell(p, h).catch(() => {});
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

// Build the PnL share card from REAL recorded trades, not price snapshots:
//   - "Sold for"  = the actual USD value of this sell tx (the server records
//     every swap in `trades` with the MON received × live MON/USD price)
//   - "Invested"  = average cost basis of the sold tokens, replayed from the
//     user's full buy/sell history of this token
//   - "Held"      = time since the position was opened (the last time the
//     balance went from zero to holding — not the first buy ever)
// Best-effort — silently degrades if Supabase isn't wired or history is thin.
async function showPnLForSell(p: ExecParams, txHash: Hex) {
  try {
    const me = p.recipient.toLowerCase();
    const tok = p.tokenAddress.toLowerCase();
    const sb = supabase();

    const [{ data: tokRow }, { data: mkt }, { data: acct }] = await Promise.all([
      sb.from("tokens").select("symbol, image_uri").eq("address", tok).maybeSingle(),
      sb.from("token_markets").select("price_usd").eq("token_address", tok).maybeSingle(),
      sb.from("accounts").select("handle, image_uri").eq("address", me).maybeSingle(),
    ]);
    const symbol = (tokRow as any)?.symbol ?? p.symbol ?? "???";
    const image  = (tokRow as any)?.image_uri ?? null;
    const pfp    = (acct as any)?.image_uri ?? null;
    // Fresh accounts default their handle to the raw wallet address — show
    // the truncated address instead of "@0x49ab8a25…" in that case.
    const rawHandle = (acct as any)?.handle as string | undefined;
    const handle = rawHandle && !/^0x[a-fA-F0-9]{40}$/.test(rawHandle) ? rawHandle : undefined;

    // The server writes the sell into `trades` before the swap fn returns,
    // but give it a few retries in case the row lands a moment later.
    let sell: { token_amount: string; value_usd: number | null } | null = null;
    for (let i = 0; i < 6 && !sell; i += 1) {
      const { data } = await sb.from("trades")
        .select("token_amount, value_usd")
        .eq("tx_hash", txHash).maybeSingle();
      if (data) sell = data as any;
      else await sleep(1_500);
    }

    // Replay the full trade history (oldest first) to get the average cost
    // basis and the timestamp the current position was opened.
    const { data: hist } = await sb.from("trades")
      .select("tx_hash, side, token_amount, value_usd, created_at_chain")
      .eq("account_address", me).eq("token_address", tok)
      .order("created_at_chain", { ascending: true })
      .limit(1000);

    let bal = 0;                       // tokens held
    let costUsd = 0;                   // USD paid for those tokens
    let openedAt: number | null = null;
    for (const t of (hist ?? []) as any[]) {
      if (t.tx_hash === txHash) continue;     // state as-of just before this sell
      const qty = Number(t.token_amount) / 1e18;
      const usd = Number(t.value_usd ?? 0);
      if (!isFinite(qty) || qty <= 0) continue;
      if (t.side === "BUY") {
        if (bal <= 1e-9) openedAt = +new Date(t.created_at_chain);
        bal += qty;
        costUsd += usd;
      } else {
        const sellQty = Math.min(qty, bal);
        if (bal > 0) costUsd -= costUsd * (sellQty / bal);  // avg-cost reduction
        bal -= sellQty;
        if (bal <= 1e-9) { bal = 0; costUsd = 0; openedAt = null; }
      }
    }

    // Actual amounts for THIS sell — prefer the recorded tx over UI floats.
    const exitPrice = Number((mkt as any)?.price_usd ?? 0);
    const soldTokens = sell ? Number(sell.token_amount) / 1e18 : Number(p.rawAmount) / 1e18;
    const proceeds = sell?.value_usd != null && Number(sell.value_usd) > 0
      ? Number(sell.value_usd)
      : exitPrice > 0 ? exitPrice * soldTokens : 0;
    const avgCost = bal > 0 ? costUsd / bal : 0;
    const invested = avgCost * Math.min(soldTokens, bal > 0 ? bal : soldTokens);

    if (!(invested > 0) || !(proceeds > 0)) {
      // Not enough history for PnL — still show what they walked out with.
      autoShowPnLCard({
        symbol, tokenImage: image, side: "Sell",
        pfp, handle, address: me,
        soldUsd: proceeds > 0 ? proceeds : undefined,
      });
      return;
    }

    const pnlUsd = proceeds - invested;
    const pnlPct = (pnlUsd / invested) * 100;
    const multiplier = proceeds / invested;

    let holdingTime: string | undefined;
    if (openedAt && openedAt < Date.now()) {
      let mins = Math.floor((Date.now() - openedAt) / 60_000);
      const d = Math.floor(mins / 1440); mins -= d * 1440;
      const h = Math.floor(mins / 60); const m = mins - h * 60;
      holdingTime = d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    autoShowPnLCard({
      symbol, tokenImage: image, side: "Sell",
      pfp, handle, address: me,
      pnlUsd, pnlPct,
      multiplier: multiplier >= 2 ? multiplier : undefined,
      investedUsd: invested,
      soldUsd: proceeds,
      holdingTime,
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
