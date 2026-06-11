// Monad wallet helpers — MON balance, ERC-20 balances, native + token
// transfers. All transactions sign through the user's Para embedded wallet.

import { useEffect, useState, useCallback } from "react";
import {
  createPublicClient, http, parseAbi, encodeFunctionData,
  type Address, type Hex,
} from "viem";
import { MONAD_MAINNET } from "@/lib/para";
import { supabase } from "@/lib/supabase";
import { SUPABASE_ENABLED } from "@/lib/supabase-hooks";
import { DEFAULT_AVATAR as _ } from "@/lib/defaults"; // keep import side-effect clean

void _;

const publicClient = createPublicClient({
  chain: MONAD_MAINNET,
  transport: http(),
});

const ERC20 = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

// ─────────────── Native MON balance ──────────────────────────────────
export function useMonBalance(me: string | undefined) {
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!me) { setBalance(0); return; }
    setLoading(true);
    try {
      const wei = await publicClient.getBalance({ address: me as Address });
      setBalance(Number(wei) / 1e18);
    } catch (e) { console.warn("[balance]", e); }
    finally { setLoading(false); }
  }, [me]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  return { balance, loading, refresh };
}

// ─────────────── Single-token balance (for the token page) ──────────
// Used by /token/$id where we only care about ONE token, not the full
// holdings list. Polls every 15s and exposes raw + human-readable +
// decimals so the trade panel can render and a "Max" button can fill the
// input precisely.
export function useTokenBalance(me: string | undefined, token: string | undefined) {
  const [raw, setRaw] = useState<bigint>(0n);
  const [decimals, setDecimals] = useState<number>(18);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!me || !token || !/^0x[a-fA-F0-9]{40}$/.test(token)) {
      setRaw(0n);
      return;
    }
    setLoading(true);
    try {
      const [b, d] = await Promise.all([
        publicClient.readContract({
          address: token as Address, abi: ERC20, functionName: "balanceOf",
          args: [me as Address],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: token as Address, abi: ERC20, functionName: "decimals",
        }).catch(() => 18) as Promise<number>,
      ]);
      setRaw(b);
      setDecimals(Number(d));
    } catch (e) { console.warn("[token balance]", e); }
    finally { setLoading(false); }
  }, [me, token]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  const balance = Number(raw) / Math.pow(10, decimals);
  return { balance, raw, decimals, loading, refresh };
}

// ─────────────── Token holdings ──────────────────────────────────────
export type Holding = {
  address: string;          // token contract
  symbol: string;
  name: string;
  decimals: number;
  balanceRaw: bigint;
  balance: number;          // human-readable
  imageUri?: string | null;
  priceUsd?: number | null;
  valueUsd?: number | null;
};

/**
 * Wallet holdings — live from the chain via the Zerion portfolio API.
 *
 * Why Zerion and not Supabase: `position_snapshots` lags behind chain
 * state by however long the PnL worker took to catch up. Wallets need
 * to be accurate the instant a swap lands, not 30s later. Zerion polls
 * the chain directly so balances + USD values match what's onchain.
 *
 * If ZERION_API_KEY isn't set or Zerion returns no Monad positions
 * (Monad support might still be rolling out), we fall back to a viem
 * multicall against the tokens the user has traded in the last 90 days
 * — that way new users with zero trade history just see an empty list
 * and existing users still get their balances.
 */
export function useTokenHoldings(me: string | undefined) {
  const [items, setItems] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!me) { setItems([]); return; }
    setLoading(true);
    try {
      // ─ Primary: Zerion ───────────────────────────────────────────
      const { fetchZerionPositions } = await import("@/lib/zerion");
      const { positions, source } = await fetchZerionPositions({ data: { address: me } });
      if (source === "zerion" && positions.length > 0) {
        const holdings: Holding[] = positions.map((p) => ({
          address: p.address,
          decimals: p.decimals,
          symbol: p.symbol,
          name: p.name,
          imageUri: p.imageUri,
          balanceRaw: BigInt(p.balanceRaw || "0"),
          balance: p.balance,
          priceUsd: p.priceUsd,
          valueUsd: p.valueUsd,
        }));
        setItems(holdings);
        return;
      }

      // ─ Fallback: derive from recent trade history + multicall ────
      // Used when Zerion has no Monad positions for this wallet (e.g.
      // brand-new launches Zerion hasn't indexed yet). NOT the source
      // of truth — just a "show something" path so the wallet page
      // isn't empty for memecoin-only traders.
      let tokenAddrs: string[] = [];
      if (SUPABASE_ENABLED) {
        const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
        const { data: trades } = await supabase()
          .from("trades")
          .select("token_address")
          .eq("account_address", me.toLowerCase())
          .gte("created_at_chain", since);
        tokenAddrs = [...new Set((trades ?? []).map((r: any) => r.token_address))];
      }
      if (tokenAddrs.length === 0) { setItems([]); return; }

      const reads = tokenAddrs.flatMap((t) => ([
        { address: t as Address, abi: ERC20, functionName: "balanceOf", args: [me as Address] } as const,
        { address: t as Address, abi: ERC20, functionName: "decimals" } as const,
        { address: t as Address, abi: ERC20, functionName: "symbol" } as const,
        { address: t as Address, abi: ERC20, functionName: "name" } as const,
      ]));
      const results = await publicClient.multicall({ contracts: reads, allowFailure: true });

      let metaBy: Map<string, { image_uri?: string; symbol?: string; name?: string; price_usd?: number }> = new Map();
      if (SUPABASE_ENABLED && tokenAddrs.length > 0) {
        const sb = supabase();
        const [{ data: toks }, { data: mkts }] = await Promise.all([
          sb.from("tokens").select("address, symbol, name, image_uri").in("address", tokenAddrs),
          sb.from("token_markets").select("token_address, price_usd").in("token_address", tokenAddrs),
        ]);
        for (const t of toks ?? []) metaBy.set(t.address, { image_uri: t.image_uri, symbol: t.symbol, name: t.name });
        for (const m of mkts ?? []) metaBy.set(m.token_address, { ...(metaBy.get(m.token_address) ?? {}), price_usd: Number(m.price_usd) });
      }

      const holdings: Holding[] = tokenAddrs.map((t, i) => {
        const off = i * 4;
        const balanceRaw = (results[off]?.result as bigint) ?? 0n;
        const decimals = Number((results[off + 1]?.result as number) ?? 18);
        const symbolOnchain = (results[off + 2]?.result as string) ?? "";
        const nameOnchain = (results[off + 3]?.result as string) ?? "";
        const meta = metaBy.get(t) ?? {};
        const balance = Number(balanceRaw) / 10 ** decimals;
        const priceUsd = meta.price_usd ?? null;
        return {
          address: t, decimals,
          symbol: meta.symbol ?? symbolOnchain ?? "—",
          name: meta.name ?? nameOnchain ?? "",
          imageUri: meta.image_uri ?? null,
          balanceRaw, balance,
          priceUsd,
          valueUsd: priceUsd ? balance * priceUsd : null,
        };
      }).filter((h) => h.balance > 0)
        .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

      setItems(holdings);
    } catch (e) {
      console.warn("[holdings]", e);
    } finally { setLoading(false); }
  }, [me]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  return { holdings: items, loading, refresh };
}

// ─────────────── Native MON send ─────────────────────────────────────
export async function sendMon(p: {
  from: Address; to: Address; amountMon: number;
}): Promise<Hex> {
  const { getParaWalletClient } = await import("@/lib/para");
  const client = await getParaWalletClient(p.from);
  if (!client) throw new Error("Wallet client unavailable");
  const wei = BigInt(Math.floor(p.amountMon * 1e18));
  return client.sendTransaction({
    to: p.to, value: wei,
    chain: MONAD_MAINNET, account: p.from,
  } as any);
}

// ─────────────── ERC-20 send ─────────────────────────────────────────
export async function sendErc20(p: {
  from: Address; to: Address; tokenAddress: Address;
  amount: number; decimals: number;
}): Promise<Hex> {
  const { getParaWalletClient } = await import("@/lib/para");
  const client = await getParaWalletClient(p.from);
  if (!client) throw new Error("Wallet client unavailable");
  const raw = BigInt(Math.floor(p.amount * 10 ** p.decimals));
  const data = encodeFunctionData({
    abi: ERC20, functionName: "transfer", args: [p.to, raw],
  });
  return client.sendTransaction({
    to: p.tokenAddress, data, value: 0n,
    chain: MONAD_MAINNET, account: p.from,
  } as any);
}
