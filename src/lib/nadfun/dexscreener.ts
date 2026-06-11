// DexScreener fallback. Free public API, no key. We only call this from the
// server proxy so we can normalize the shape into Nad.fun's response.

import type { TokenMetadataResponse, MarketResponse } from "./types";

const DS_BASE = "https://api.dexscreener.com/latest/dex";

interface DsPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative: string;
  priceUsd: string;
  fdv?: number;
  marketCap?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  info?: { imageUrl?: string; websites?: { url: string }[]; socials?: { type: string; url: string }[] };
  pairCreatedAt?: number;     // ms
}

interface DsTokensResp { pairs: DsPair[] | null }

async function dsTokenPairs(token: string): Promise<DsPair[]> {
  const r = await fetch(`${DS_BASE}/tokens/${token}`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`dexscreener ${r.status}`);
  const j = (await r.json()) as DsTokensResp;
  const pairs = (j.pairs ?? []).filter((p) => p.chainId === "monad");
  if (pairs.length === 0) throw new Error("dexscreener: no monad pair");
  // Pick highest liquidity pair
  pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  return pairs;
}

export async function dsTokenMetadata(token: string): Promise<TokenMetadataResponse> {
  const [p] = await dsTokenPairs(token);
  const twitter = p.info?.socials?.find((s) => s.type === "twitter")?.url ?? null;
  const telegram = p.info?.socials?.find((s) => s.type === "telegram")?.url ?? null;
  const website = p.info?.websites?.[0]?.url ?? null;

  return {
    token_info: {
      token_id: p.baseToken.address,
      name: p.baseToken.name,
      symbol: p.baseToken.symbol,
      image_uri: p.info?.imageUrl ?? "",
      description: null,
      is_graduated: true,                     // listed on a DEX
      is_nsfw: false,
      twitter, telegram, website,
      created_at: Math.floor((p.pairCreatedAt ?? Date.now()) / 1000),
      creator: { account_id: "", nickname: "", bio: "", image_uri: "" },
      is_cto: false,
      version: "V2",
    },
    market_info: dsMarket(p),
  };
}

export async function dsMarketOnly(token: string): Promise<MarketResponse> {
  const [p] = await dsTokenPairs(token);
  return { market_info: dsMarket(p) };
}

function dsMarket(p: DsPair) {
  return {
    market_type: "V2_DEX" as const,
    token_id: p.baseToken.address,
    quote_id: p.quoteToken.address,
    market_id: p.pairAddress,
    reserve_native: "0",
    reserve_quote: String(p.liquidity?.usd ?? 0),
    reserve_token: "0",
    token_price: p.priceUsd,
    native_price: p.priceNative,
    quote_price: p.priceUsd,
    price: p.priceNative,
    price_usd: p.priceUsd,
    price_native: p.priceNative,
    total_supply: String(p.fdv && Number(p.priceUsd) > 0 ? p.fdv / Number(p.priceUsd) : 0),
    volume: String(p.volume?.h24 ?? 0),
    ath_price: p.priceUsd,
    ath_price_usd: p.priceUsd,
    ath_price_native: p.priceNative,
    holder_count: 0,
  };
}
