// Token page — live Nad.fun / DexScreener / GeckoTerminal data.
// Supabase is only used for token chat writes (landing discovery is live API).
// Header, chart, trades, and holders all hit external APIs directly so any
// token address works even if the bot hasn't indexed it yet.

import { useEffect, useState } from "react";
import { createServerFn } from "@tanstack/react-start";
import { supabase, supabaseAdmin } from "./supabase";
import { SUPABASE_ENABLED } from "./supabase-hooks";
import { fetchChart, fetchTokenMetadata, fetchMetrics } from "./nadfun/server";
import type { BarResponse, ChartResolution, TokenMetadataResponse } from "./nadfun/types";
import { getMonUsdPrice, volumeToUsd } from "./mon-usd";
import { defaultAccountHandle, defaultDisplayName } from "./handles";

/** UI + bot poll interval — keep in sync with bot TOKEN_SYNC_INTERVAL_MS */
export const TOKEN_TAB_REFRESH_MS = 5_000;

export type TokenMarketSnap = {
  price_usd: number | null;
  volume_usd: number | null;
  liquidity_usd: number | null;
  pct_change_1h: number | null;
  pct_change_24h: number | null;
  reserve_native: number | null;
  price_native: number | null;
  quote_price_usd: number | null;
};

export type TokenSnapshot = {
  address: string;
  symbol: string;
  name: string;
  image_uri: string | null;
  banner_uri: string | null;
  creator_address: string | null;
  is_graduated: boolean;
  total_supply: string | null;
  market: TokenMarketSnap | null;
  description: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  created_at: number | null;   // unix seconds — token launch time
  holder_count: number | null;
};

export type IndexedTrade = {
  tx_hash: string;
  account_address: string;
  side: "BUY" | "SELL";
  token_amount: string;
  price_usd: number | null;
  value_usd: number | null;
  created_at_chain: string;
};

export type IndexedHolder = {
  account_address: string;
  balance: string;
};

export type IndexedChatMessage = {
  id: string;
  sender_address: string;
  body: string;
  created_at: string;
};

function normalizeEvmAddress(address: string, label = "address") {
  const value = String(address ?? "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

async function ensureAccountRow(sb: ReturnType<typeof supabaseAdmin>, address: string) {
  const addr = normalizeEvmAddress(address, "wallet address");
  const { error } = await sb.from("accounts").upsert({
    address: addr,
    handle: defaultAccountHandle(addr),
    display_name: defaultDisplayName(addr),
  }, { onConflict: "address", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return addr;
}

async function ensureTokenRow(sb: ReturnType<typeof supabaseAdmin>, address: string) {
  const addr = normalizeEvmAddress(address, "token address");
  const fallback = addr.slice(2, 8).toUpperCase();
  const { error } = await sb.from("tokens").upsert({
    address: addr,
    symbol: fallback,
    name: `Token ${fallback}`,
  }, { onConflict: "address", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return addr;
}

function mapNadfunToSnapshot(
  meta: TokenMetadataResponse,
  token: string,
  monUsd: number,
): TokenSnapshot {
  const ti = meta.token_info;
  const mi = meta.market_info;
  const priceUsd = mi?.price_usd != null ? Number(mi.price_usd) : null;
  const reserveQuote = mi?.reserve_quote != null ? Number(mi.reserve_quote) : null;
  const reserveUsd = reserveQuote != null && reserveQuote > 0
    ? (reserveQuote >= 1e12
      ? (reserveQuote / 1e18) * (monUsd > 0 ? monUsd : Number(mi?.quote_price ?? 0) || 0)
      : reserveQuote)
    : null;
  return {
    address: token.toLowerCase(),
    symbol: ti?.symbol ?? "???",
    name: ti?.name ?? ti?.symbol ?? "Token",
    image_uri: ti?.image_uri || null,
    banner_uri: null,
    creator_address: ti?.creator?.account_id?.toLowerCase() || null,
    is_graduated: !!ti?.is_graduated,
    total_supply: mi?.total_supply != null ? String(mi.total_supply) : null,
    description: ti?.description || null,
    twitter: ti?.twitter || null,
    telegram: ti?.telegram || null,
    website: ti?.website || null,
    created_at: ti?.created_at != null ? Number(ti.created_at) : null,
    holder_count: mi?.holder_count != null ? Number(mi.holder_count) : null,
    market: {
      price_usd: priceUsd,
      volume_usd: volumeToUsd(mi?.volume, mi, monUsd),
      liquidity_usd: reserveUsd,
      pct_change_1h: null,
      pct_change_24h: null,
      reserve_native: mi?.reserve_native != null ? Number(mi.reserve_native) : null,
      price_native: mi?.price_native != null ? Number(mi.price_native) : null,
      quote_price_usd: mi?.quote_price != null ? Number(mi.quote_price) : null,
    },
  };
}

export const fetchTokenSnapshot = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    try {
      const token = data.token.toLowerCase();
      const [{ usd: monUsd }, meta] = await Promise.all([
        getMonUsdPrice(),
        fetchTokenMetadata({ data: { token } }),
      ]);
      const snap = mapNadfunToSnapshot(meta, token, monUsd);
      try {
        const m = await fetchMetrics({ data: { token, timeframes: ["1D"] } });
        const day = m.metrics?.find((x) => x.timeframe === "1D");
        if (day && snap.market) {
          snap.market.pct_change_24h = day.percent;
          const metricsVol = volumeToUsd(day.volume?.total, meta.market_info, monUsd);
          if (metricsVol != null) snap.market.volume_usd = metricsVol;
        }
      } catch { /* metrics optional */ }
      return snap;
    } catch {
      return null;
    }
  });

/** Tell the bot this token is being viewed — prioritised in the 5s sync queue. */
export const touchTokenPagePin = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const addr = data.token.toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(addr)) return;
    try {
      const sb = supabaseAdmin();
      await sb.from("tokens").upsert(
        { address: addr, symbol: "???", name: "Unknown" },
        { onConflict: "address", ignoreDuplicates: true },
      );
      await sb.from("token_page_pins").upsert({
        token_address: addr,
        last_seen_at: new Date().toISOString(),
      });
    } catch {
      /* non-fatal */
    }
  });

export const fetchTokenOhlc = createServerFn({ method: "GET" })
  .inputValidator((d: {
    token: string;
    resolution: ChartResolution;
    from: number;
    to: number;
    countback?: number;
    chart_type?: string;
  }) => d)
  .handler(async ({ data }): Promise<BarResponse> => {
    const resolution = data.resolution;
    const countback = data.countback ?? 500;
    return fetchChart({
      data: {
        token: data.token,
        resolution,
        from: data.from,
        to: data.to,
        countback,
        chart_type: "price_usd",
      },
    });
  });

export function liquidityUsd(market: TokenMarketSnap | null): number | null {
  if (!market) return null;
  if (market.liquidity_usd != null && market.liquidity_usd > 0) return market.liquidity_usd;
  if (market.reserve_native != null && market.price_native != null) {
    return (market.reserve_native / 1e18) * market.price_native * 2;
  }
  return null;
}

export function useTokenSnapshot(token: string | undefined, initial: TokenSnapshot | null = null) {
  const [snapshot, setSnapshot] = useState<TokenSnapshot | null>(initial);
  const [loading, setLoading] = useState(!initial);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    const addr = token.toLowerCase();
    let cancel = false;

    const refresh = async () => {
      try {
        const snap = await fetchTokenSnapshot({ data: { token: addr } });
        if (!cancel) {
          setSnapshot(snap);
          setLoading(false);
        }
      } catch {
        if (!cancel) setLoading(false);
      }
    };

    if (!initial) refresh();
    const poll = setInterval(refresh, TOKEN_TAB_REFRESH_MS);

    return () => { cancel = true; clearInterval(poll); };
  }, [token, initial]);

  return { snapshot, loading };
}

export type PriceChanges = {
  m5: number | null;
  h1: number | null;
  h6: number | null;
  h12: number | null;
  h24: number | null;
};

/** Live price-change deltas over 5m / 1h / 6h / 12h / 24h, computed from OHLCV. */
export function useTokenPriceChanges(token: string | undefined) {
  const [changes, setChanges] = useState<PriceChanges | null>(null);

  useEffect(() => {
    if (!token) return;
    const addr = token.toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(addr)) return;
    let cancel = false;
    const refresh = async () => {
      try {
        const { fetchPriceChanges } = await import("./nadfun/server");
        const r = await fetchPriceChanges({ data: { token: addr } });
        if (!cancel) setChanges(r);
      } catch { /* keep last value */ }
    };
    refresh();
    // Price changes move slower than the 5s tab refresh — 30s is plenty and
    // keeps us well within GeckoTerminal's rate limit.
    const poll = setInterval(refresh, 30_000);
    return () => { cancel = true; clearInterval(poll); };
  }, [token]);

  return changes;
}

export function useTokenTrades(token: string | undefined, enabled: boolean, limit = 50) {
  const [trades, setTrades] = useState<IndexedTrade[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token || !enabled) return;
    const addr = token.toLowerCase();
    let cancel = false;
    setLoading(true);

    const refresh = async () => {
      try {
        const { fetchSwapHistory } = await import("./nadfun/server");
        const res: any = await fetchSwapHistory({ data: { token: addr, limit } });
        const mapped: IndexedTrade[] = (res?.swaps ?? []).map((s: any) => ({
          tx_hash: s.swap_info?.transaction_hash ?? "",
          account_address: s.account_info?.account_id?.toLowerCase() ?? "",
          side: s.swap_info?.event_type ?? "BUY",
          token_amount: s.swap_info?.token_amount ?? "0",
          value_usd: Number(s.swap_info?.value ?? 0) || 0,
          price_usd: Number(s.swap_info?.quote_price ?? 0) || 0,
          created_at_chain: s.swap_info?.created_at
            ? new Date(s.swap_info.created_at * 1000).toISOString()
            : new Date().toISOString(),
        }));
        if (!cancel) { setTrades(mapped); setLoading(false); }
      } catch (e) {
        console.warn("[useTokenTrades] nadfun failed:", e);
        if (!cancel) setLoading(false);
      }
    };

    refresh();
    const poll = setInterval(refresh, TOKEN_TAB_REFRESH_MS);

    return () => {
      cancel = true;
      clearInterval(poll);
    };
  }, [token, enabled, limit]);

  return { trades, loading };
}

export function useTokenHolders(token: string | undefined, enabled: boolean, limit = 100) {
  const [holders, setHolders] = useState<IndexedHolder[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token || !enabled) return;
    const addr = token.toLowerCase();
    let cancel = false;
    setLoading(true);

    const refresh = async () => {
      try {
        const { fetchHolders } = await import("./nadfun/server");
        const res: any = await fetchHolders({ data: { token: addr, limit } });
        const mapped: IndexedHolder[] = (res?.holders ?? []).map((h: any) => ({
          account_address: h.account_info?.account_id?.toLowerCase() ?? "",
          balance: h.balance_info?.balance ?? "0",
        }));
        if (!cancel) { setHolders(mapped); setLoading(false); }
      } catch (e) {
        console.warn("[useTokenHolders] nadfun failed:", e);
        if (!cancel) setLoading(false);
      }
    };

    refresh();
    const poll = setInterval(refresh, TOKEN_TAB_REFRESH_MS);

    return () => {
      cancel = true;
      clearInterval(poll);
    };
  }, [token, enabled, limit]);

  return { holders, loading };
}

export function useTokenChat(token: string | undefined, enabled: boolean, limit = 80) {
  const [messages, setMessages] = useState<IndexedChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!SUPABASE_ENABLED || !token || !enabled) return;
    const addr = token.toLowerCase();
    const sb = supabase();
    let cancel = false;
    setLoading(true);

    const refresh = () => sb
      .from("token_chat_messages")
      .select("id, sender_address, body, created_at")
      .eq("token_address", addr)
      .order("created_at", { ascending: false })
      .limit(limit)
      .then(({ data }) => {
        if (!cancel) {
          setMessages((data as IndexedChatMessage[]) ?? []);
          setLoading(false);
        }
      });

    refresh();
    const poll = setInterval(refresh, TOKEN_TAB_REFRESH_MS);
    const ch = sb
      .channel(`token:chat:${addr}:${Math.random().toString(36).slice(2, 10)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "token_chat_messages", filter: `token_address=eq.${addr}` }, (p) => {
        const row = p.new as IndexedChatMessage;
        setMessages((s) => [row, ...s].slice(0, limit));
      })
      .subscribe();

    return () => { cancel = true; clearInterval(poll); sb.removeChannel(ch); };
  }, [token, enabled, limit]);

  return { messages, loading };
}

// Server fn — token chat goes through the admin client to bypass RLS
// (the `auth post token chat` policy needs `sender_address = auth_addr()`,
// and we don't issue Supabase JWTs anymore).
export const sendTokenChatMessage = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; me: string; body: string }) => d)
  .handler(async ({ data }) => {
    const body = String(data.body ?? "").trim();
    if (!body) return;
    const sb = supabaseAdmin();
    const [token, me] = await Promise.all([
      ensureTokenRow(sb, data.token),
      ensureAccountRow(sb, data.me),
    ]);
    const { error } = await sb.from("token_chat_messages").insert({
      token_address: token,
      sender_address: me,
      body,
    });
    if (error) throw new Error(error.message);
  });

export async function updateTokenBanner(token: string, me: string, bannerUri: string | null) {
  if (!SUPABASE_ENABLED) return;
  const { error } = await supabase()
    .from("tokens")
    .update({ banner_uri: bannerUri })
    .eq("address", token.toLowerCase())
    .eq("creator_address", me.toLowerCase());
  if (error) throw error;
}
