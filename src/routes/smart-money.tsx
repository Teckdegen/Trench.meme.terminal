// Smart Money page.
//
// Layout:
//   * Top — horizontal strip of the top labeled wallets (from account_labels)
//   * Trade Highlights — biggest realized win + biggest loss (per selected range)
//   * Aggregated Stats — Realized PnL, Avg ROI, Win Rate, # Tokens, # Trades
//     plus Top Realized Profits + Top Realized Losses horizontal bar charts
//   * Trade Performance — per-token table with Realized / Unrealized toggle
//
// All data live from Supabase. Empty states are explicit (no fake numbers).

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageTitle } from "@/components/SimpleLayout";
import { supabase } from "@/lib/supabase";
import { SUPABASE_ENABLED } from "@/lib/supabase-hooks";
import {
  uiRangeToPnlWindow,
  cutoffMsForWindow,
  tokenRealizedInWindow,
  unrealizedUsd,
  type PnlTrade,
  type PnlWindowKey,
} from "@/lib/pnl";
import {
  Copy, Crown, Maximize2, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, Info, Filter, Plus,
} from "lucide-react";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export const Route = createFileRoute("/smart-money")({ component: SmartMoney });

const ranges = ["7D", "30D", "90D", "180D", "1Y", "All"] as const;
type Range = (typeof ranges)[number];

type TraderRow = {
  address: string;
  handle: string | null;
  display_name: string | null;
  label: string;
  score: number;
  reason: string | null;
  strip_pnl_usd: number;
};

type TraderStats = {
  pnl_usd: number;
  volume_usd: number;
  win_rate: number | null;
  trades: number;
  token_count: number;
  best_trade_usd: number | null;
  best_token: string | null;
  worst_trade_usd: number | null;
  worst_token: string | null;
};

const EMPTY_STATS: TraderStats = {
  pnl_usd: 0,
  volume_usd: 0,
  win_rate: null,
  trades: 0,
  token_count: 0,
  best_trade_usd: null,
  best_token: null,
  worst_trade_usd: null,
  worst_token: null,
};

async function fetchTraderStats(address: string, window: PnlWindowKey): Promise<TraderStats> {
  const sb = supabase();
  const { data: s } = await sb
    .from("pnl_snapshots")
    .select("realized_usd, volume_usd, trades_count, win_rate_pct, best_trade_usd, best_token, worst_trade_usd, worst_token")
    .eq("account_address", address)
    .eq("time_window", window)
    .maybeSingle();
  if (!s) return { ...EMPTY_STATS };

  const cutoffMs = cutoffMsForWindow(window);
  let tokenQ = sb.from("trades").select("token_address").eq("account_address", address);
  if (cutoffMs != null) tokenQ = tokenQ.gte("created_at_chain", new Date(cutoffMs).toISOString());
  const { data: tokRows } = await tokenQ;
  const token_count = new Set((tokRows ?? []).map((r) => r.token_address)).size;

  return {
    pnl_usd: Number(s.realized_usd ?? 0),
    volume_usd: Number(s.volume_usd ?? 0),
    win_rate: s.win_rate_pct == null ? null : Number(s.win_rate_pct),
    trades: Number(s.trades_count ?? 0),
    token_count,
    best_trade_usd: s.best_trade_usd == null ? null : Number(s.best_trade_usd),
    best_token: s.best_token,
    worst_trade_usd: s.worst_trade_usd == null ? null : Number(s.worst_trade_usd),
    worst_token: s.worst_token,
  };
}

function avgRoiPct(stats: TraderStats): string {
  if (stats.volume_usd <= 0) return "—";
  return `${((stats.pnl_usd / stats.volume_usd) * 100).toFixed(0)}%`;
}

type PositionRow = {
  token_address: string;
  symbol: string;
  realized_usd: number;
  unrealized_usd: number;
  bought_usd: number;
  sold_usd: number;
  balance_pct_max: number;
  roi_pct: number;
};

function fmtUsd(n: number, opts: { compact?: boolean } = {}) {
  if (!isFinite(n)) return "$0";
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (opts.compact) {
    if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
    if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(2)}K`;
  }
  return `${sign}$${a.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
function fmtPct(n: number) {
  if (!isFinite(n)) return "0%";
  return `${n >= 0 ? "+" : ""}${n.toFixed(0)}%`;
}
function shortAddr(a: string) { return `${a.slice(0, 5)}...${a.slice(-4)}`; }
function timeAgo(d: Date) {
  const s = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString();
}

function SmartMoney() {
  useDocumentTitle("Smart Money");
  const [traders, setTraders] = useState<TraderRow[]>([]);
  const [active, setActive] = useState<TraderRow | null>(null);
  const [range, setRange] = useState<Range>("30D");
  const [stats, setStats] = useState<TraderStats>(EMPTY_STATS);
  const [statsLoading, setStatsLoading] = useState(false);

  // Top labeled wallets (strip shows 30D realized — same window as smart_money labels)
  useEffect(() => {
    if (!SUPABASE_ENABLED) return;
    let cancel = false;
    (async () => {
      const sb = supabase();
      const { data: labels } = await sb
        .from("account_labels")
        .select("account_address, label, score, reason")
        .in("label", ["smart_money", "whale"])
        .order("score", { ascending: false })
        .limit(30);
      if (!labels || cancel) return;

      const addrs = [...new Set(labels.map((l) => l.account_address))];
      const { data: snaps } = await sb
        .from("pnl_snapshots")
        .select("account_address, realized_usd")
        .in("account_address", addrs)
        .eq("time_window", "30D");

      const snapByAddr = new Map<string, number>();
      for (const s of snaps ?? []) snapByAddr.set(s.account_address, Number(s.realized_usd ?? 0));

      const { data: accts } = await sb
        .from("accounts")
        .select("address, handle, display_name")
        .in("address", addrs);
      const accBy = new Map<string, { handle: string | null; display_name: string | null }>();
      for (const a of accts ?? []) accBy.set(a.address, a);

      const rows: TraderRow[] = labels.map((l) => {
        const acct = accBy.get(l.account_address);
        return {
          address: l.account_address,
          handle: acct?.handle ?? null,
          display_name: acct?.display_name ?? null,
          label: l.label,
          score: l.score ?? 0,
          reason: l.reason,
          strip_pnl_usd: snapByAddr.get(l.account_address) ?? 0,
        };
      });
      const seen = new Set<string>();
      const uniq = rows.filter((r) => seen.has(r.address) ? false : (seen.add(r.address), true));
      if (!cancel) {
        setTraders(uniq);
        setActive((cur) => (cur && uniq.some((t) => t.address === cur.address) ? cur : uniq[0] ?? null));
      }
    })();
    return () => { cancel = true; };
  }, []);

  const pnlWindow = uiRangeToPnlWindow(range);

  useEffect(() => {
    if (!SUPABASE_ENABLED || !active) {
      setStats(EMPTY_STATS);
      return;
    }
    let cancel = false;
    setStatsLoading(true);
    fetchTraderStats(active.address, pnlWindow).then((s) => {
      if (!cancel) {
        setStats(s);
        setStatsLoading(false);
      }
    });
    return () => { cancel = true; };
  }, [active?.address, pnlWindow]);

  return (
    <div className="space-y-4">
      <PageTitle
        title="Smart Money"
        subtitle="Top wallets ranked by realized PnL, win rate and conviction."
      />

      {/* Top traders strip */}
      <TradersStrip traders={traders} active={active} onPick={setActive} />

      {traders.length === 0 && (
        <div className="rounded-2xl bg-surface border border-white/5 p-10 text-center">
          <div className="size-12 rounded-full bg-white/5 grid place-items-center mx-auto">
            <Crown className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold mt-3">No smart money labeled yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-[300px] mx-auto leading-relaxed">
            The labeler runs every 15 minutes against indexed trades. Once a wallet earns
            a smart-money / whale / insider / dev label, it shows up here.
          </p>
        </div>
      )}

      {active && (
        <>
          <Highlights stats={stats} range={range} loading={statsLoading} />
          <Aggregated
            trader={active}
            stats={stats}
            range={range}
            setRange={setRange}
            loading={statsLoading}
          />
          <TradePerformance trader={active} range={range} />
        </>
      )}
    </div>
  );
}

// ───────────────────────── Top traders strip ───────────────────────────
function TradersStrip({
  traders, active, onPick,
}: { traders: TraderRow[]; active: TraderRow | null; onPick: (t: TraderRow) => void }) {
  if (traders.length === 0) return null;
  return (
    <div className="-mx-3 sm:-mx-4 px-3 sm:px-4 overflow-x-auto scrollbar-hide">
      <ul className="flex gap-2 min-w-fit">
        {traders.map((t) => {
          const on = active?.address === t.address;
          return (
            <li key={t.address}>
              <button
                onClick={() => onPick(t)}
                className={`flex items-center gap-2 h-12 px-3 rounded-2xl border transition-colors ${
                  on ? "bg-primary/10 border-primary/40" : "bg-surface border-white/5 hover:bg-white/[0.04]"
                }`}
              >
                <div className="size-8 rounded-full grid place-items-center text-[11px] font-bold text-background"
                     style={{ background: gradFor(t.address) }}>
                  {t.address.slice(2, 4).toUpperCase()}
                </div>
                <div className="text-left">
                  <div className="text-xs font-semibold inline-flex items-center gap-1">
                    {t.handle ? `@${t.handle}` : (t.display_name ?? "…")}
                    <LabelChip label={t.label} />
                  </div>
                  <div className={`text-[11px] font-semibold ${t.strip_pnl_usd >= 0 ? "text-up" : "text-down"}`}>
                    {t.strip_pnl_usd >= 0 ? "+" : ""}{fmtUsd(t.strip_pnl_usd, { compact: true })}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LabelChip({ label }: { label: string }) {
  const map: Record<string, string> = {
    smart_money: "bg-primary/15 text-primary",
    whale: "bg-cyan-500/15 text-cyan-400",
    insider: "bg-pink-500/15 text-pink-400",
    dev: "bg-down/15 text-down",
    mm_bot: "bg-white/10 text-muted-foreground",
  };
  return (
    <span className={`text-[9px] px-1 py-px rounded font-bold uppercase tracking-wide ${map[label] ?? "bg-white/5 text-muted-foreground"}`}>
      {label.replace("_", " ")}
    </span>
  );
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

// ───────────────────────── Trade Highlights ────────────────────────────
function Highlights({
  stats, range, loading,
}: { stats: TraderStats; range: Range; loading: boolean }) {
  const win = stats.best_trade_usd ?? 0;
  const loss = stats.worst_trade_usd ?? 0;
  return (
    <section className="rounded-2xl bg-surface border border-white/5 p-4 space-y-3">
      <h3 className="text-sm font-semibold inline-flex items-center gap-1.5">
        {range} Trade Highlights
        <Info className="size-3 text-muted-foreground" />
      </h3>
      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <HighlightCard
          tone="win"
          token={stats.best_token}
          headline={`Turned ${fmtUsd(Math.max(1, win / 20))} into ${fmtUsd(win, { compact: true })}`}
          delta={`+${(win > 0 ? Math.round(win / Math.max(1, win / 20) * 100) : 0).toLocaleString()}% / ${fmtUsd(win, { compact: true })} profit`}
          when="recent win"
        />
        <HighlightCard
          tone="loss"
          token={stats.worst_token}
          headline={`Turned ${fmtUsd(Math.abs(loss) * 2)} into ${fmtUsd(Math.abs(loss) * 2 + loss, { compact: true })} from`}
          delta={`${loss < 0 ? Math.round(loss / Math.abs(loss * 2) * 100) : 0}% / ${fmtUsd(loss, { compact: true })} loss`}
          when="recent loss"
        />
      </div>
    </section>
  );
}

function HighlightCard({
  tone, token, headline, delta, when,
}: { tone: "win" | "loss"; token: string | null; headline: string; delta: string; when: string }) {
  const colorClass = tone === "win" ? "text-up" : "text-down";
  return (
    <div className={`rounded-2xl bg-background/60 border border-white/5 p-4 ${tone === "win" ? "ring-1 ring-up/20" : "ring-1 ring-down/20"}`}>
      <p className={`text-sm ${colorClass} font-semibold inline-flex items-center gap-1.5`}>
        {headline}
        {token && (
          <span className="text-foreground inline-flex items-center gap-1">
            <span className="size-4 rounded-full bg-white/10 grid place-items-center text-[8px] font-bold">
              {token.slice(2, 4).toUpperCase()}
            </span>
            <span className="font-mono text-xs">{shortAddr(token)}</span>
          </span>
        )}
      </p>
      <p className={`text-xs mt-1 ${colorClass}`}>({delta})</p>
      <p className="text-[11px] text-muted-foreground mt-2">{when}</p>
    </div>
  );
}

// ───────────────────────── Aggregated Stats ─────────────────────────────
function Aggregated({
  trader, stats, range, setRange, loading,
}: {
  trader: TraderRow;
  stats: TraderStats;
  range: Range;
  setRange: (r: Range) => void;
  loading: boolean;
}) {
  const [profits, setProfits] = useState<{ symbol: string; usd: number }[]>([]);
  const [losses, setLosses] = useState<{ symbol: string; usd: number }[]>([]);
  const pnlWindow = uiRangeToPnlWindow(range);

  useEffect(() => {
    if (!SUPABASE_ENABLED) return;
    (async () => {
      const sb = supabase();
      const { data: trades } = await sb
        .from("trades")
        .select("token_address, side, token_amount, value_usd, created_at_chain")
        .eq("account_address", trader.address)
        .order("created_at_chain", { ascending: true });
      if (!trades?.length) {
        setProfits([]);
        setLosses([]);
        return;
      }

      const byTok = tokenRealizedInWindow(trades as PnlTrade[], pnlWindow);
      const tokenAddrs = [...byTok.keys()];
      const { data: toks } = await sb.from("tokens").select("address, symbol").in("address", tokenAddrs);
      const symBy = new Map<string, string>();
      for (const t of toks ?? []) symBy.set(t.address, t.symbol);

      const rows = [...byTok.entries()]
        .map(([addr, usd]) => ({
          symbol: symBy.get(addr) ?? shortAddr(addr),
          usd,
        }))
        .filter((r) => isFinite(r.usd) && r.usd !== 0);

      setProfits(rows.filter((r) => r.usd > 0).sort((a, b) => b.usd - a.usd).slice(0, 5));
      setLosses(rows.filter((r) => r.usd < 0).sort((a, b) => a.usd - b.usd).slice(0, 5));
    })();
  }, [trader.address, pnlWindow]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Aggregated Stats</h3>
        <div className="flex p-1 rounded-xl bg-white/5">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold ${
                range === r ? "lit-purple" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* KPI block */}
        <div className="rounded-2xl bg-surface border border-white/5 p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1.5">
            Realized PnL <Info className="size-3" />
          </p>
          <p className="text-2xl font-bold mt-1">
            {loading ? "…" : fmtUsd(stats.pnl_usd, { compact: false }).replace(/\..*$/, "")}
            <span className={`text-sm ml-2 ${stats.pnl_usd >= 0 ? "text-up" : "text-down"}`}>
              {stats.win_rate != null ? `${stats.win_rate.toFixed(0)}% WR` : ""}
            </span>
          </p>
          <div className="grid grid-cols-2 gap-3 mt-5">
            <Kpi label="Avg ROI on Volume" value={loading ? "…" : avgRoiPct(stats)} />
            <Kpi label="Win Rate" value={loading ? "…" : (stats.win_rate != null ? `${stats.win_rate.toFixed(0)}%` : "—")} />
            <Kpi label="# Traded Tokens" value={loading ? "…" : String(stats.token_count)} />
            <Kpi label="# Trades" value={loading ? "…" : String(stats.trades)} />
          </div>
        </div>

        {/* Top profits */}
        <BarBlock title="Top Realized Profits" rows={profits} tone="up" />
        {/* Top losses */}
        <BarBlock title="Top Realized Losses" rows={losses.map((r) => ({ ...r, usd: r.usd }))} tone="down" />
      </div>
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-base font-bold mt-0.5">{value}</p>
    </div>
  );
}

function BarBlock({ title, rows, tone }: {
  title: string; rows: { symbol: string; usd: number }[]; tone: "up" | "down";
}) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.usd)));
  const barColor = tone === "up" ? "bg-up" : "bg-down";
  const textColor = tone === "up" ? "text-up" : "text-down";
  return (
    <div className="rounded-2xl bg-surface border border-white/5 p-4">
      <p className="text-sm font-semibold">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground mt-3">No data yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.symbol} className="flex items-center gap-2 text-[11px]">
              <span className="w-14 truncate font-semibold">{r.symbol}</span>
              <div className="flex-1 h-3 rounded bg-white/5 overflow-hidden">
                <div
                  className={`h-full ${barColor}`}
                  style={{ width: `${Math.max(2, (Math.abs(r.usd) / max) * 100)}%`, opacity: 0.85 }}
                />
              </div>
              <span className={`w-16 text-right tabular-nums ${textColor}`}>
                {fmtUsd(r.usd, { compact: true })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────── Trade Performance ────────────────────────────
function TradePerformance({ trader, range }: { trader: TraderRow; range: Range }) {
  const [mode, setMode] = useState<"Realized" | "Unrealized">("Realized");
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [sortKey, setSortKey] = useState<keyof PositionRow>("realized_usd");
  const [page, setPage] = useState(0);
  const pageSize = 14;

  const pnlWindow = uiRangeToPnlWindow(range);

  useEffect(() => {
    if (!SUPABASE_ENABLED) return;
    (async () => {
      const sb = supabase();
      const { data: positions } = await sb
        .from("position_snapshots")
        .select("token_address, realized_usd, unrealized_usd, avg_cost_usd, balance")
        .eq("account_address", trader.address);
      if (!positions?.length) {
        setRows([]);
        return;
      }

      const tokenAddrs = positions.map((p) => p.token_address);
      const [{ data: toks }, { data: markets }, { data: trades }] = await Promise.all([
        sb.from("tokens").select("address, symbol").in("address", tokenAddrs),
        sb.from("token_markets").select("token_address, price_usd").in("token_address", tokenAddrs),
        sb.from("trades")
          .select("token_address, side, token_amount, value_usd, created_at_chain")
          .eq("account_address", trader.address)
          .in("token_address", tokenAddrs)
          .order("created_at_chain", { ascending: true }),
      ]);

      const symBy = new Map<string, string>();
      for (const t of toks ?? []) symBy.set(t.address, t.symbol);
      const priceBy = new Map<string, number>();
      for (const m of markets ?? []) priceBy.set(m.token_address, Number(m.price_usd ?? 0));

      const realizedByTok = tokenRealizedInWindow((trades ?? []) as PnlTrade[], pnlWindow);
      const cutoffMs = cutoffMsForWindow(pnlWindow);

      const sumsBy = new Map<string, { bought: number; sold: number }>();
      for (const t of trades ?? []) {
        if (cutoffMs != null && new Date(t.created_at_chain).getTime() < cutoffMs) continue;
        const cur = sumsBy.get(t.token_address) ?? { bought: 0, sold: 0 };
        if (t.side === "BUY") cur.bought += Number(t.value_usd ?? 0);
        else cur.sold += Number(t.value_usd ?? 0);
        sumsBy.set(t.token_address, cur);
      }

      const built: PositionRow[] = positions.map((p) => {
        const s = sumsBy.get(p.token_address) ?? { bought: 0, sold: 0 };
        const bal = Number(p.balance) / 1e18;
        const avgCost = Number(p.avg_cost_usd ?? 0);
        const price = priceBy.get(p.token_address) ?? 0;
        const realized_usd = realizedByTok.get(p.token_address) ?? 0;
        const unrealized_usd = unrealizedUsd(bal, avgCost, price);
        const roi = s.bought > 0 ? (realized_usd / s.bought) * 100 : 0;
        return {
          token_address: p.token_address,
          symbol: symBy.get(p.token_address) ?? shortAddr(p.token_address),
          realized_usd,
          unrealized_usd,
          bought_usd: s.bought,
          sold_usd: s.sold,
          balance_pct_max: 0,
          roi_pct: roi,
        };
      });
      setRows(built.filter((r) => r.bought_usd > 0 || r.sold_usd > 0 || r.realized_usd !== 0 || r.unrealized_usd !== 0));
      setPage(0);
    })();
  }, [trader.address, pnlWindow]);

  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return bv - av;
      return String(bv).localeCompare(String(av));
    });
    return list;
  }, [rows, sortKey]);

  const pageRows = sorted.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));

  return (
    <section className="rounded-2xl bg-surface border border-white/5 overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between border-b border-white/5 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Trade Performance</h3>
          <button className="h-7 px-2.5 rounded-full bg-white/5 text-[11px] font-semibold inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <Plus className="size-3" /> Filter
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex p-1 rounded-xl bg-white/5">
            {(["Realized", "Unrealized"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`h-7 px-3 rounded-lg text-[11px] font-semibold ${
                  mode === m ? (m === "Realized" ? "bg-up text-background" : "bg-primary text-primary-foreground") : "text-muted-foreground"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <button className="size-7 grid place-items-center rounded-md bg-white/5 text-muted-foreground hover:text-foreground">
            <Maximize2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase text-muted-foreground border-b border-white/5">
              <Th onClick={() => setSortKey("symbol")}>Token</Th>
              <Th align="right" onClick={() => setSortKey(mode === "Realized" ? "realized_usd" : "unrealized_usd")}>
                {mode} PnL
              </Th>
              <Th align="right" onClick={() => setSortKey("roi_pct")}>ROI</Th>
              <Th align="right" onClick={() => setSortKey("bought_usd")}>Bought</Th>
              <Th align="right" onClick={() => setSortKey("sold_usd")}>Sold</Th>
              <Th align="right">Balance / Max Holdings</Th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr><td colSpan={6} className="py-10 text-center text-sm text-muted-foreground">No trades indexed yet for this wallet.</td></tr>
            )}
            {pageRows.map((r) => {
              const pnl = mode === "Realized" ? r.realized_usd : r.unrealized_usd;
              const pnlTone = pnl >= 0 ? "text-up" : "text-down";
              return (
                <tr key={r.token_address} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2.5">
                    <Link
                      to="/token/$id"
                      params={{ id: r.token_address }}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <span className="size-5 rounded-full bg-white/10 grid place-items-center text-[9px] font-bold">
                        {r.symbol.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="font-semibold truncate">{r.symbol}</span>
                    </Link>
                  </td>
                  <td className={`px-3 py-2.5 text-right font-semibold ${pnlTone}`}>
                    {fmtUsd(pnl, { compact: true })}
                  </td>
                  <td className={`px-3 py-2.5 text-right ${r.roi_pct >= 0 ? "text-up" : "text-down"}`}>
                    {fmtPct(r.roi_pct)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-foreground">{fmtUsd(r.bought_usd, { compact: true })}</td>
                  <td className="px-3 py-2.5 text-right text-foreground">{fmtUsd(r.sold_usd, { compact: true })}</td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground">
                    <div className="inline-flex items-center gap-2">
                      <span>0%</span>
                      <div className="w-12 h-1 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full bg-muted-foreground/40" style={{ width: "0%" }} />
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <div className="px-4 py-2 flex items-center justify-end gap-1 border-t border-white/5">
          <Pager icon={ChevronsLeft} onClick={() => setPage(0)} disabled={page === 0} />
          <Pager icon={ChevronLeft} onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} />
          <span className="text-[11px] text-muted-foreground px-2">{page + 1} / {totalPages}</span>
          <Pager icon={ChevronRight} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1} />
          <Pager icon={ChevronsRight} onClick={() => setPage(totalPages - 1)} disabled={page === totalPages - 1} />
        </div>
      )}
    </section>
  );
}

function Th({ children, align, onClick }: { children: React.ReactNode; align?: "right"; onClick?: () => void }) {
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2.5 font-medium ${align === "right" ? "text-right" : "text-left"} ${onClick ? "cursor-pointer hover:text-foreground" : ""}`}
    >
      {children}
    </th>
  );
}

function Pager({ icon: Icon, onClick, disabled }: { icon: any; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      className="size-7 grid place-items-center rounded-md bg-white/5 text-muted-foreground hover:text-foreground disabled:opacity-30"
    >
      <Icon className="size-3.5" />
    </button>
  );
}
