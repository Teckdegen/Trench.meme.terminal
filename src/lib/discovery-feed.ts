// Landing-page three-column feed — live APIs, client cache, 25s refresh.
//
// Data path: Nad.fun + Monad RPC + DexScreener (server fn) → cache → UI columns.
//
// Columns:
//   • new       — launched in the last 3 days
//   • final     — bonding curve 40%–99%
//   • migrated  — graduated, sorted by market cap

import { useEffect, useMemo, useState } from "react";

export type PipelineColumn = "new" | "final" | "migrated" | "latest";

export type DiscoveryRow = {
  address: string;
  symbol: string;
  name: string;
  imageUri: string | null;
  creatorAddress: string | null;
  column: PipelineColumn;
  createdAt: string | null;
  progressBps: number;
  priceUsd: number | null;
  volumeUsd: number | null;
  holderCount: number | null;
  liquidityUsd: number | null;
  isGraduated: boolean;
  marketCapUsd: number | null;
  priceChange24h: number | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
};

const REFRESH_MS = 25_000;

// Module-level cache survives route changes and re-renders.
let feedCache: { rows: DiscoveryRow[]; at: number } | null = null;
let refreshInFlight: Promise<void> | null = null;

function countColumn(rows: DiscoveryRow[], col: PipelineColumn) {
  return rows.filter((r) => r.column === col).length;
}

/** Never let a failed/rate-limited refresh wipe New Pairs or Final Stretch. */
function mergeDiscoveryRows(prev: DiscoveryRow[], next: DiscoveryRow[]): DiscoveryRow[] {
  if (!next.length) return prev.length ? prev : next;

  const byAddr = new Map<string, DiscoveryRow>();
  for (const r of next) byAddr.set(r.address, r);

  for (const col of ["new", "final"] as const) {
    if (countColumn(next, col) === 0 && countColumn(prev, col) > 0) {
      for (const r of prev) {
        if (r.column === col) byAddr.set(r.address, r);
      }
    }
  }

  return [...byAddr.values()];
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(1, Math.floor((Date.now() - +new Date(iso)) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
export function formatDiscoveryAge(iso: string | null) {
  return timeAgo(iso);
}

// ─────────────────── Latest trades column (5s poll) ─────────────────────
// Tokens ordered by most recent trade, via Nad.fun /order/latest_trade.
// Polls fast (5s) so the column feels live; the server fn caches upstream
// calls so this stays within Nad.fun rate limits.
const LATEST_REFRESH_MS = 5_000;
let latestCache: { rows: DiscoveryRow[]; at: number } | null = null;

export function useLatestTradeFeed() {
  const [rows, setRows] = useState<DiscoveryRow[]>(latestCache?.rows ?? []);
  const [loading, setLoading] = useState(!latestCache);

  useEffect(() => {
    let cancel = false;
    const refresh = async () => {
      try {
        const { fetchLatestTradeFeed } = await import("./discovery-api");
        const res = await fetchLatestTradeFeed({ data: {} });
        if (cancel) return;
        if (res.rows.length > 0 || !latestCache) {
          latestCache = { rows: res.rows, at: Date.now() };
          setRows(res.rows);
        }
      } catch (e) {
        console.warn("[latest-trades]", e);
      } finally {
        if (!cancel) setLoading(false);
      }
    };
    refresh();
    const poll = setInterval(refresh, LATEST_REFRESH_MS);
    return () => { cancel = true; clearInterval(poll); };
  }, []);

  return { rows, loading };
}

export function useDiscoveryFeed() {
  const [rows, setRows] = useState<DiscoveryRow[]>(feedCache?.rows ?? []);
  const [loading, setLoading] = useState(!feedCache);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancel = false;

    const refresh = async (initial: boolean) => {
      if (refreshInFlight) {
        await refreshInFlight;
        if (!cancel && feedCache) setRows(feedCache.rows);
        return;
      }

      refreshInFlight = (async () => {
        if (initial && !feedCache) setLoading(true);
        else if (feedCache) setRefreshing(true);

        try {
          const { fetchDiscoveryLanding } = await import("./discovery-api");
          const res = await fetchDiscoveryLanding({ data: {} });
          if (cancel) return;
          const merged = mergeDiscoveryRows(feedCache?.rows ?? [], res.rows);
          feedCache = { rows: merged, at: Date.now() };
          setRows(merged);
        } catch (e) {
          console.warn("[discovery]", e);
        } finally {
          if (!cancel) {
            setLoading(false);
            setRefreshing(false);
          }
        }
      })();

      try {
        await refreshInFlight;
      } finally {
        refreshInFlight = null;
      }
    };

    refresh(!feedCache);
    const poll = setInterval(() => refresh(false), REFRESH_MS);
    return () => { cancel = true; clearInterval(poll); };
  }, []);

  const { columns, topGainers } = useMemo(() => {
    const newRows = rows
      .filter((r) => r.column === "new")
      .sort((a, b) => +new Date(b.createdAt ?? 0) - +new Date(a.createdAt ?? 0))
      .slice(0, 50);
    const finalRows = rows
      .filter((r) => r.column === "final")
      .sort((a, b) => b.progressBps - a.progressBps)
      .slice(0, 50);
    const trendingScore = (r: DiscoveryRow): number => {
      const vol = r.volumeUsd ?? 0;
      const liq = r.liquidityUsd ?? 0;
      const mov = Math.abs(r.priceChange24h ?? 0);
      const movMult = 1 + Math.min(5, mov / 20);
      return vol * movMult + liq * 0.05;
    };
    const migratedRows = rows
      .filter((r) => r.column === "migrated" && !!r.imageUri)
      .sort((a, b) => trendingScore(b) - trendingScore(a))
      .slice(0, 100);
    const gainers = rows
      .filter((r) => r.priceChange24h != null && r.priceChange24h > 0)
      .sort((a, b) => (b.priceChange24h ?? 0) - (a.priceChange24h ?? 0))
      .slice(0, 7);
    return {
      columns: { new: newRows, final: finalRows, migrated: migratedRows },
      topGainers: gainers,
    };
  }, [rows]);

  return {
    columns,
    topGainers,
    loading,
    refreshing,
    hasData: rows.length > 0,
    usingFallback: true,
  };
}
