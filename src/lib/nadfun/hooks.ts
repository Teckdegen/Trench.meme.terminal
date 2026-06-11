// React Query hooks for Nad.fun. They call the server functions in ./server.ts,
// so the API key stays server-side.

import { useQuery } from "@tanstack/react-query";
import {
  fetchTokenMetadata, fetchMarket, fetchMetrics, fetchSwapHistory, fetchHolders,
} from "./server";
import { fetchTokenOhlc } from "@/lib/token-index";
import type { ChartResolution, ChartType, MetricTimeframe } from "./types";

const isAddress = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);

export function useTokenMetadata(token: string | undefined) {
  return useQuery({
    queryKey: ["nadfun", "metadata", token],
    queryFn: () => fetchTokenMetadata({ data: { token: token! } }),
    enabled: !!token && isAddress(token),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useMarket(token: string | undefined) {
  return useQuery({
    queryKey: ["nadfun", "market", token],
    queryFn: () => fetchMarket({ data: { token: token! } }),
    enabled: !!token && isAddress(token),
    refetchInterval: 5_000,
  });
}

export function useChart(
  token: string | undefined,
  opts?: {
    resolution?: ChartResolution;
    rangeSeconds?: number;
    countback?: number;
    chart_type?: ChartType;
  },
) {
  const now = Math.floor(Date.now() / 1000);
  const rangeSeconds = opts?.rangeSeconds ?? 60 * 60 * 6;
  return useQuery({
    queryKey: ["nadfun", "chart", token, opts],
    queryFn: () =>
      fetchTokenOhlc({
        data: {
          token: token!,
          resolution: opts?.resolution ?? "5",
          from: now - rangeSeconds,
          to: now,
          countback: opts?.countback ?? 500,
        },
      }),
    enabled: !!token && isAddress(token),
    refetchInterval: 30_000,
  });
}

export function useMetrics(token: string | undefined, timeframes?: MetricTimeframe[]) {
  return useQuery({
    queryKey: ["nadfun", "metrics", token, timeframes],
    queryFn: () => fetchMetrics({ data: { token: token!, timeframes } }),
    enabled: !!token && isAddress(token),
    refetchInterval: 15_000,
  });
}

export function useSwapHistory(
  token: string | undefined,
  opts?: { page?: number; limit?: number; account_id?: string; trade_type?: "BUY" | "SELL" | "ALL" },
) {
  return useQuery({
    queryKey: ["nadfun", "swaps", token, opts],
    queryFn: () => fetchSwapHistory({ data: { token: token!, ...opts } }),
    enabled: !!token && isAddress(token),
    refetchInterval: 10_000,
  });
}

export function useHolders(token: string | undefined, opts?: { page?: number; limit?: number }) {
  return useQuery({
    queryKey: ["nadfun", "holders", token, opts],
    queryFn: () => fetchHolders({ data: { token: token!, ...opts } }),
    enabled: !!token && isAddress(token),
    refetchInterval: 60_000,
  });
}
