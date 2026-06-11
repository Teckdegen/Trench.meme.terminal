// Leaderboards — top traders ranked by realized PnL per window.
// All data live from Supabase pnl_snapshots (written by the PnL worker).

import { createFileRoute, Link } from "@tanstack/react-router";
import { profileRoute } from "@/lib/identity";
import { PageTitle } from "@/components/SimpleLayout";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { SUPABASE_ENABLED } from "@/lib/supabase-hooks";
import { Crown, Trophy } from "lucide-react";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export const Route = createFileRoute("/leaderboards")({ component: Leaderboards });

// pnl_snapshots windows
const ranges = [
  { key: "24H", label: "24H" },
  { key: "7D",  label: "7D" },
  { key: "30D", label: "30D" },
  { key: "ALL", label: "All" },
] as const;
type Range = (typeof ranges)[number]["key"];

type SortKey = "realized_usd" | "volume_usd" | "win_rate_pct" | "trades_count";

type Row = {
  account_address: string;
  display_name: string | null;
  handle: string | null;
  image_uri: string | null;
  is_verified: boolean;
  realized_usd: number;
  volume_usd: number;
  trades_count: number;
  win_rate_pct: number | null;
};

function fmtUsd(n: number) {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000)     return `${sign}$${(a / 1_000).toFixed(2)}K`;
  return `${sign}$${a.toFixed(2)}`;
}
function traderLabel(r: Row) {
  if (r.handle) return `@${r.handle}`;
  return r.display_name ?? "…";
}

function gradFor(s: string) {
  const pal = [
    "linear-gradient(135deg, #a855f7, #ec4899)",
    "linear-gradient(135deg, #06b6d4, #6366f1)",
    "linear-gradient(135deg, #f59e0b, #ef4444)",
    "linear-gradient(135deg, #10b981, #06b6d4)",
    "linear-gradient(135deg, #f472b6, #a855f7)",
  ];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return pal[Math.abs(h) % pal.length];
}

function Leaderboards() {
  useDocumentTitle("Leaderboards");
  const [range, setRange] = useState<Range>("24H");
  const [sortKey, setSortKey] = useState<SortKey>("realized_usd");
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!SUPABASE_ENABLED) { setRows([]); return; }
    let cancel = false;
    (async () => {
      const sb = supabase();
      const { data: snaps } = await sb
        .from("pnl_snapshots")
        .select("account_address, realized_usd, volume_usd, trades_count, win_rate_pct")
        .eq("time_window", range)
        .order(sortKey, { ascending: false, nullsFirst: false })
        .limit(100);
      if (cancel || !snaps) return;

      const addrs = snaps.map((s: any) => s.account_address);
      const { data: accts } = await sb
        .from("accounts")
        .select("address, display_name, handle, image_uri, is_verified")
        .in("address", addrs);
      const accBy = new Map<string, any>();
      for (const a of accts ?? []) accBy.set(a.address, a);

      const merged: Row[] = snaps.map((s: any) => ({
        account_address: s.account_address,
        display_name: accBy.get(s.account_address)?.display_name ?? null,
        handle: accBy.get(s.account_address)?.handle ?? null,
        image_uri: accBy.get(s.account_address)?.image_uri ?? null,
        is_verified: !!accBy.get(s.account_address)?.is_verified,
        realized_usd: Number(s.realized_usd ?? 0),
        volume_usd: Number(s.volume_usd ?? 0),
        trades_count: Number(s.trades_count ?? 0),
        win_rate_pct: s.win_rate_pct == null ? null : Number(s.win_rate_pct),
      }));
      setRows(merged);
    })();
    return () => { cancel = true; };
  }, [range, sortKey]);

  const podium = useMemo(() => (rows ?? []).slice(0, 3), [rows]);
  const rest = useMemo(() => (rows ?? []).slice(3), [rows]);

  return (
    <div className="space-y-4">
      <PageTitle
        title="Leaderboards"
        subtitle="Top traders ranked by realized PnL — live from the PnL worker."
        action={
          <div className="flex p-1 rounded-xl bg-surface-2 text-xs">
            {ranges.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`h-8 px-3 rounded-lg font-semibold transition-colors ${
                  range === r.key ? "lit-purple" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {rows === null && <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>}

      {rows && rows.length === 0 && (
        <div className="rounded-2xl bg-surface border border-white/5 p-10 text-center">
          <div className="size-12 rounded-full bg-white/5 grid place-items-center mx-auto">
            <Trophy className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold mt-3">Leaderboard is empty</p>
          <p className="text-xs text-muted-foreground mt-1">
            Start the indexer + PnL worker. As wallets trade, this fills up.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          {/* Podium — top 3 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {podium.filter((r) => r.handle).map((r, i) => (
              <Link
                key={r.account_address}
                {...profileRoute(r.handle!)}
                className={`rounded-2xl bg-surface border p-4 flex items-center gap-3 hover:bg-white/[0.04] ${
                  i === 0 ? "border-yellow-500/40 ring-1 ring-yellow-500/20"
                  : i === 1 ? "border-white/10"
                  : "border-amber-700/30"
                }`}
              >
                <div className="relative shrink-0">
                  {r.image_uri ? (
                    <img src={r.image_uri} className="size-12 rounded-full object-cover" alt="" />
                  ) : (
                    <div className="size-12 rounded-full grid place-items-center text-base font-bold text-white"
                         style={{ background: gradFor(r.account_address) }}>
                      {r.account_address.slice(2, 4).toUpperCase()}
                    </div>
                  )}
                  <span className={`absolute -bottom-1 -right-1 size-6 rounded-full grid place-items-center text-[10px] font-black ring-2 ring-background ${
                    i === 0 ? "bg-yellow-500 text-black"
                    : i === 1 ? "bg-white/20 text-white"
                    : "bg-amber-700 text-white"
                  }`}>
                    {i === 0 ? <Crown className="size-3" /> : i + 1}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate inline-flex items-baseline min-w-0">
                    <span className="truncate">{traderLabel(r)}</span>
                    <VerifiedBadge verified={r.is_verified} />
                  </p>
                  <p className={`text-lg font-bold ${r.realized_usd >= 0 ? "text-up" : "text-down"}`}>
                    {r.realized_usd >= 0 ? "+" : ""}{fmtUsd(r.realized_usd)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {r.win_rate_pct != null ? `${r.win_rate_pct.toFixed(0)}% WR` : "—"} · {r.trades_count} trades
                  </p>
                </div>
              </Link>
            ))}
          </div>

          {/* Full table */}
          <div className="rounded-2xl bg-surface border border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="text-[11px] uppercase text-muted-foreground border-b border-white/5">
                    <Th>#</Th>
                    <Th>Trader</Th>
                    <Th align="right" onClick={() => setSortKey("realized_usd")} active={sortKey === "realized_usd"}>PnL</Th>
                    <Th align="right" onClick={() => setSortKey("win_rate_pct")} active={sortKey === "win_rate_pct"}>Win rate</Th>
                    <Th align="right" onClick={() => setSortKey("volume_usd")} active={sortKey === "volume_usd"}>Volume</Th>
                    <Th align="right" onClick={() => setSortKey("trades_count")} active={sortKey === "trades_count"}>Trades</Th>
                  </tr>
                </thead>
                <tbody>
                  {rest.filter((r) => r.handle).map((r, i) => (
                    <tr key={r.account_address} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-3 py-2.5 text-muted-foreground tabular-nums">{i + 4}</td>
                      <td className="px-3 py-2.5">
                        <Link {...profileRoute(r.handle!)} className="flex items-center gap-2 hover:underline">
                          {r.image_uri ? (
                            <img src={r.image_uri} className="size-7 rounded-full object-cover" alt="" />
                          ) : (
                            <div className="size-7 rounded-full grid place-items-center text-[10px] font-bold text-white"
                                 style={{ background: gradFor(r.account_address) }}>
                              {r.account_address.slice(2, 4).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-semibold truncate inline-flex items-baseline min-w-0">
                              <span className="truncate">{traderLabel(r)}</span>
                              <VerifiedBadge verified={r.is_verified} />
                            </div>
                            {r.handle && r.display_name && <div className="text-[10px] text-muted-foreground truncate">@{r.handle}</div>}
                          </div>
                        </Link>
                      </td>
                      <td className={`px-3 py-2.5 text-right font-semibold ${r.realized_usd >= 0 ? "text-up" : "text-down"}`}>
                        {r.realized_usd >= 0 ? "+" : ""}{fmtUsd(r.realized_usd)}
                      </td>
                      <td className="px-3 py-2.5 text-right">{r.win_rate_pct != null ? `${r.win_rate_pct.toFixed(0)}%` : "—"}</td>
                      <td className="px-3 py-2.5 text-right">{fmtUsd(r.volume_usd)}</td>
                      <td className="px-3 py-2.5 text-right">{r.trades_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Th({ children, align, onClick, active }: {
  children: React.ReactNode; align?: "right"; onClick?: () => void; active?: boolean;
}) {
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2.5 font-medium select-none ${align === "right" ? "text-right" : "text-left"} ${onClick ? "cursor-pointer hover:text-foreground" : ""} ${active ? "text-foreground" : ""}`}
    >
      {children}{active && " ▼"}
    </th>
  );
}
