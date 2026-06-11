// Types from https://api.nad.fun (v2 schema). Keep these in sync with their docs.

export type TokenVersion = "V1" | "V2";
export type MarketType = "CURVE" | "DEX" | "V2_CURVE" | "V2_DEX";
export type SwapType = "BUY" | "SELL";

export interface AccountInfo {
  account_id: string;
  nickname: string;
  bio: string;
  image_uri: string;
}

export interface TokenInfo {
  token_id: string;
  name: string;
  symbol: string;
  image_uri: string;
  description: string | null;
  is_graduated: boolean;
  is_nsfw: boolean;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  created_at: number;        // unix seconds
  creator: AccountInfo;
  is_cto: boolean;
  version: TokenVersion;
}

export interface MarketInfo {
  market_type: MarketType;
  token_id: string;
  quote_id: string;
  market_id: string;
  reserve_native: string;
  reserve_quote: string;
  reserve_token: string;
  token_price: string;
  native_price: string;
  quote_price: string;
  price: string;
  price_usd: string;
  price_native: string;
  total_supply: string;
  volume: string;
  ath_price: string;
  ath_price_usd: string;
  ath_price_native: string;
  holder_count: number;
}

export interface TokenMetadataResponse {
  token_info: TokenInfo;
  market_info: MarketInfo;
}

export interface MarketResponse {
  market_info: MarketInfo;
}

export interface BarResponse {
  k: string;                 // chart_type echo
  t: number[];               // unix seconds
  c: string[];               // close
  o: string[];               // open
  h: string[];               // high
  l: string[];               // low
  v: string[];               // volume
  s: "ok" | "no_data";
}

export interface MetricItem {
  timeframe: string;         // "1" | "5" | "15" | "30" | "60" | "240" | "1D"
  percent: number;
  transactions: { buy: number; sell: number; total: number };
  volume: { buy: string; sell: string; total: string };
  makers: { buy: number; sell: number; total: number };
}

export interface MetricsBatchResponse {
  metrics: MetricItem[];
}

export interface SwapInfo {
  event_type: SwapType;
  native_amount: string;
  quote_amount: string;
  token_amount: string;
  native_price: string;
  quote_price: string;
  value: string;
  transaction_hash: string;
  created_at: number;
}

export interface TokenSwap {
  account_info: AccountInfo;
  swap_info: SwapInfo;
}

export interface TokenSwapResponse {
  swaps: TokenSwap[];
  total_count: number;
}

export interface BalanceInfo {
  balance: string;
  token_price: string;
  native_price: string;
  created_at: number;
}

export interface TokenHolder {
  account_info: AccountInfo;
  balance_info: BalanceInfo;
}

export interface TokenHolderResponse {
  holders: TokenHolder[];
  total_count: number;
}

export type ChartResolution =
  | "1" | "5" | "15" | "30" | "60" | "1H"
  | "240" | "4H" | "D" | "1D" | "W" | "1W" | "M" | "1M";

export type ChartType = "price" | "price_usd" | "market_cap" | "market_cap_usd";

export type MetricTimeframe = "1" | "5" | "15" | "30" | "60" | "240" | "1D";
