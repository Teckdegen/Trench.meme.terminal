import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { fmtPct } from "@/lib/fmt";
import {
  useDiscoveryFeed,
  formatDiscoveryAge,
  type DiscoveryRow,
  type PipelineColumn,
} from "@/lib/discovery-feed";
import {
  Search, ArrowRightLeft,
  Eye, Users, Coins, ShieldCheck, ShieldAlert, BarChart3,
  Twitter, Send, Globe,
  Flame, Sprout, TrendingUp,
} from "lucide-react";
import { useMe } from "@/lib/useMe";
import { useBlocklist } from "@/lib/blocklist";
import { useSwapExecute } from "@/lib/swap-execute";
import { MonLogo } from "@/components/MonLogo";
import { toast } from "sonner";

// Quick-buy amount per column, persisted to localStorage. Default 500 MON.
const QUICK_BUY_KEY = (col: string) => `trench.quickbuy.${col}`;
function readQuickBuy(col: string): number {
  if (typeof window === "undefined") return 500;
  const raw = localStorage.getItem(QUICK_BUY_KEY(col));
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 500;
}
function useQuickBuyAmount(col: string): [number, (v: number) => void] {
  const [v, setV] = useState<number>(() => readQuickBuy(col));
  const set = (next: number) => {
    setV(next);
    try { localStorage.setItem(QUICK_BUY_KEY(col), String(next)); } catch {}
  };
  return [v, set];
}

// Minimal quick-buy field — MON logo + bare amount input. No pill, no
// border. Sits cleanly inline with the search field next to it.
function QuickBuyAmountInput({
  value, onChange,
}: { value: number; onChange: (v: number) => void }) {
  return (
    <label
      className="flex items-center gap-1.5 h-7 cursor-text"
      title="Quick-buy amount (MON) — tap Buy on any card to spend this"
    >
      <MonLogo size={16} />
      <input
        type="number"
        min={0}
        step="any"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n > 0) onChange(n);
        }}
        className="w-14 bg-transparent text-[12px] font-semibold tabular-nums focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </label>
  );
}
import { BlocklistChip } from "@/components/BlocklistWarning";

type ColumnKey = PipelineColumn;

const columns: { key: ColumnKey; label: string; subtitle: string }[] = [
  { key: "new", label: "New Pairs", subtitle: "Launched in the last 3 days" },
  { key: "migrated", label: "Migrated", subtitle: "Trending on Monad" },
];

function fmtMc(row: DiscoveryRow) {
  // Prefer the real precomputed market cap (price × supply) from
  // discovery-feed. Fall back to liquidity as a rough proxy if MC isn't
  // available yet (very new tokens with no indexed supply).
  const mc = row.marketCapUsd ?? row.liquidityUsd ?? 0;
  if (mc >= 1_000_000_000) return `$${(mc / 1_000_000_000).toFixed(2)}B`;
  if (mc >= 1_000_000) return `$${(mc / 1_000_000).toFixed(2)}M`;
  if (mc >= 1_000) return `$${(mc / 1_000).toFixed(1)}K`;
  if (mc > 0) return `$${mc.toFixed(2)}`;
  return "—";
}

function fmtVol(v: number | null) {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function tokenColor(symbol: string) {
  const pal = ["#a855f7", "#06b6d4", "#f59e0b", "#10b981", "#ec4899"];
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) | 0;
  return pal[Math.abs(h) % pal.length];
}

type ViewMode = "trench" | "explore";

export function PairsTerminal() {
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "trench";
    return (localStorage.getItem("trench.landing.view") as ViewMode) || "trench";
  });
  const setViewPersist = (v: ViewMode) => {
    setView(v);
    try { localStorage.setItem("trench.landing.view", v); } catch {}
  };
  const [active, setActive] = useState<ColumnKey>("new");
  const { columns: lists, loading, refreshing, hasData } = useDiscoveryFeed();

  return (
    <section className="-mx-3 sm:-mx-4 md:-mx-6">
      {/* Top-level view switcher: Trench (column layout) vs Explore (table) */}
      <div className="px-3 sm:px-4 md:px-6 pt-2 pb-3 flex items-center gap-2">
        <div className="inline-flex gap-1 p-1 rounded-full bg-white/5">
          {(["trench", "explore"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setViewPersist(v)}
              className={`h-7 px-4 rounded-full text-xs font-bold capitalize transition-colors ${
                view === v ? "lit-purple" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        {refreshing && hasData && (
          <span className="text-[10px] text-muted-foreground animate-pulse">Refreshing…</span>
        )}
      </div>

      {view === "trench" ? (
        <>
          <div className="md:grid md:grid-cols-2 md:gap-px md:bg-white/5">
            {columns.map((c) => (
              <Column
                key={c.key}
                column={c}
                rows={lists[c.key]}
                loading={loading}
                visibleOnMobile={active === c.key}
              />
            ))}
          </div>

          <div className="md:hidden fixed bottom-3 inset-x-3 z-40 flex gap-1 p-1 rounded-full bg-black/80 backdrop-blur-md border border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.6)]">
            {columns.map((c) => {
              const on = active === c.key;
              return (
                <button
                  key={c.key}
                  onClick={() => setActive(c.key)}
                  className={`flex-1 min-w-fit h-10 px-3 rounded-full text-xs font-semibold inline-flex items-center justify-center ${
                    on ? "lit-purple" : "text-muted-foreground"
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <ExploreView lists={lists} loading={loading} />
      )}
    </section>
  );
}

function Column({
  column, rows, loading, visibleOnMobile,
}: { column: typeof columns[number]; rows: DiscoveryRow[]; loading: boolean; visibleOnMobile: boolean }) {
  const [q, setQ] = useState("");
  const [quickBuy, setQuickBuy] = useQuickBuyAmount(column.key);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) => r.symbol.toLowerCase().includes(s) || r.name.toLowerCase().includes(s) || r.address.includes(s),
    );
  }, [rows, q]);

  return (
    <div className={`${visibleOnMobile ? "" : "hidden"} md:block bg-background`}>
      <div className="px-3 py-3 border-b border-white/5 flex items-center gap-2 flex-wrap">
        <div>
          <span className="font-bold">{column.label}</span>
          <p className="text-[10px] text-muted-foreground">{column.subtitle}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <QuickBuyAmountInput value={quickBuy} onChange={setQuickBuy} />
          <div className="flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-white/5 w-[140px]">
            <Search className="size-3 text-muted-foreground shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search"
              className="flex-1 min-w-0 bg-transparent text-[11px] focus:outline-none"
            />
          </div>
        </div>
      </div>

      <ul className="max-h-[calc(100vh-220px)] overflow-y-auto scrollbar-hide">
        {loading && filtered.length === 0 && (
          <>
            {Array.from({ length: 6 }).map((_, i) => (
              <PairCardSkeleton key={`skel-${column.key}-${i}`} />
            ))}
          </>
        )}
        {!loading && filtered.length === 0 && (
          <li className="px-4 py-16 text-center text-xs text-muted-foreground">
            No tokens in this stage yet.
          </li>
        )}
        {filtered.map((r) => (
          <PairCard key={`${column.key}-${r.address}`} row={r} mode={column.key} quickBuyMon={quickBuy} />
        ))}
      </ul>
    </div>
  );
}

/** Skeleton placeholder — matches the card layout while live API data loads. */
// Loading placeholder — matches the real PairCard footprint so the
// layout doesn't jump when the data arrives. Uses tailwind's animate-pulse
// for the shimmer. Three "tiers" of darkness on the bars to add depth so
// it doesn't look like a flat grey block.
function PairCardSkeleton() {
  return (
    <li className="border-b border-white/5 px-3 py-3">
      <div className="rounded-2xl bg-white/[0.02] border border-white/5 overflow-hidden animate-pulse">
        {/* Hero image block — tall like the real token cards */}
        <div className="h-44 bg-white/[0.04]" />
        <div className="p-4 space-y-3">
          {/* Title + subtitle lines */}
          <div className="space-y-2">
            <div className="h-3.5 w-1/3 rounded bg-white/[0.08]" />
            <div className="h-3 w-2/5 rounded bg-white/[0.05]" />
            <div className="h-2.5 w-full rounded bg-white/[0.04]" />
            <div className="h-2.5 w-5/6 rounded bg-white/[0.04]" />
          </div>
          {/* Metric tiles — 24h / Vol / 👤 holders */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1.5">
              <div className="h-4 w-7 rounded bg-white/[0.08]" />
              <div className="h-3 w-10 rounded bg-white/[0.06]" />
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-4 w-7 rounded bg-white/[0.08]" />
              <div className="h-3 w-12 rounded bg-white/[0.06]" />
            </div>
            <div className="flex items-center gap-1.5">
              <div className="size-3.5 rounded-full bg-white/[0.08]" />
              <div className="h-3 w-8 rounded bg-white/[0.06]" />
            </div>
          </div>
          <div className="flex items-center justify-between pt-0.5">
            <div className="h-2 w-8 rounded bg-white/[0.05]" />
            <div className="h-2 w-16 rounded bg-white/[0.05]" />
          </div>
          {/* Bottom action row — two pills + a thin line */}
          <div className="space-y-2 pt-1.5">
            <div className="flex items-center gap-2">
              <div className="h-6 w-14 rounded-md bg-white/[0.06]" />
              <div className="h-6 w-16 rounded-md bg-white/[0.06]" />
              <div className="flex-1" />
              <div className="h-6 w-14 rounded-md bg-white/[0.05]" />
              <div className="h-6 w-14 rounded-md bg-white/[0.05]" />
            </div>
            <div className="h-2 w-full rounded bg-white/[0.04]" />
          </div>
        </div>
      </div>
    </li>
  );
}

// Compact social-link strip. Each icon is a real anchor that stops the
// card's Link from also navigating to /token/$id, so clicking an icon
// goes straight to the social URL in a new tab.
function SocialIcons({
  twitter, telegram, website,
}: { twitter: string | null; telegram: string | null; website: string | null }) {
  if (!twitter && !telegram && !website) return null;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const cls = "inline-flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-white/10";
  return (
    <span className="inline-flex items-center gap-0.5 ml-0.5">
      {twitter && (
        <a href={twitter} target="_blank" rel="noopener noreferrer" onClick={stop} className={cls} title="Twitter / X">
          <Twitter className="size-2.5" />
        </a>
      )}
      {telegram && (
        <a href={telegram} target="_blank" rel="noopener noreferrer" onClick={stop} className={cls} title="Telegram">
          <Send className="size-2.5" />
        </a>
      )}
      {website && (
        <a href={website} target="_blank" rel="noopener noreferrer" onClick={stop} className={cls} title="Website">
          <Globe className="size-2.5" />
        </a>
      )}
    </span>
  );
}

function PairCard({ row, mode, quickBuyMon }: { row: DiscoveryRow; mode: ColumnKey; quickBuyMon: number }) {
  const me = useMe();
  const blocklist = useBlocklist(me);
  const { run, pending } = useSwapExecute();
  const color = tokenColor(row.symbol);
  const bonding = Math.min(99, Math.round(row.progressBps / 100));
  const pct = row.volumeUsd != null ? Math.min(99, row.volumeUsd / 1000) : 0;
  const flagged = blocklist.isTokenBlocked(row.address)
    || (row.creatorAddress ? blocklist.isWalletBlocked(row.creatorAddress) : false);

  const quickBuy = async (e: React.MouseEvent) => {
    e.preventDefault(); // don't navigate to /token/$id
    e.stopPropagation();
    if (!me) { toast.error("Connect a wallet first"); return; }
    if (!(quickBuyMon > 0)) { toast.error("Set a Quick-Buy amount"); return; }
    const rawAmount = BigInt(Math.floor(quickBuyMon * 1e18));
    try {
      await run({
        venue: row.isGraduated ? "dirol" : "nadfun",
        side: "buy",
        tokenAddress: row.address as `0x${string}`,
        rawAmount,
        recipient: me as `0x${string}`,
        slippageBps: 500, // 5% — matches default trade-prefs fallback
        source: "market",
        symbol: row.symbol,
      });
    } catch { /* useSwapExecute already toasts the failure */ }
  };

  return (
    <li className={`border-b border-white/5 ${flagged ? "bg-amber-500/[0.04]" : ""}`}>
      <Link to="/token/$id" params={{ id: row.address }} className="flex gap-2 px-3 py-2.5 hover:bg-white/[0.03]">
        <div className="shrink-0">
          {row.imageUri ? (
            <img src={row.imageUri} alt="" className="size-12 rounded-xl object-cover" />
          ) : (
            <div
              className="size-12 rounded-xl grid place-items-center text-[11px] font-bold text-background"
              style={{
                background: `linear-gradient(135deg, ${color}, ${color}99)`,
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.15)",
              }}
            >
              {row.symbol.slice(0, 2)}
            </div>
          )}
          <div className="text-[9px] text-muted-foreground font-mono mt-0.5 text-center truncate w-12">
            {row.address.slice(2, 6)}…
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="font-bold text-sm truncate">{row.symbol}</span>
                <span className="text-[11px] text-muted-foreground truncate">{row.name}</span>
                {flagged && (
                  blocklist.isTokenBlocked(row.address)
                    ? <BlocklistChip label="token" />
                    : <BlocklistChip label="launcher" />
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5 flex-wrap">
                <span>{formatDiscoveryAge(row.createdAt)}</span>
                {row.holderCount != null && (
                  <span className="inline-flex items-center gap-0.5">
                    <Users className="size-2.5" /> {row.holderCount}
                  </span>
                )}
                <SocialIcons twitter={row.twitter} telegram={row.telegram} website={row.website} />
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[9px] text-muted-foreground">MC / Liq</div>
              <div className="text-sm font-bold text-up">{fmtMc(row)}</div>
              <div className="text-[10px] text-muted-foreground">Vol <span className="text-foreground">{fmtVol(row.volumeUsd)}</span></div>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-1.5">
            {mode === "final" ? (
              <div className="flex-1 min-w-0">
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-up"
                    style={{ width: `${bonding}%` }}
                  />
                </div>
                <div className="text-[9px] text-muted-foreground mt-0.5">Bonding {bonding}%</div>
              </div>
            ) : mode === "migrated" ? (
              <div className="flex-1 min-w-0 text-[11px] font-bold text-up">
                {row.isGraduated ? "Graduated" : fmtPct(pct)}
              </div>
            ) : (
              <div className="flex-1 min-w-0 text-[10px] text-muted-foreground">New launch</div>
            )}
            <button
              onClick={quickBuy}
              disabled={pending || !me}
              title={me ? `Quick-buy ${quickBuyMon} MON` : "Connect wallet to buy"}
              className="shrink-0 h-7 pl-1 pr-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-[11px] font-semibold text-foreground inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
            >
              <MonLogo size={16} />
              {pending ? "…" : quickBuyMon}
            </button>
          </div>
        </div>
      </Link>
    </li>
  );
}

// ─────────────────── Explore view ────────────────────────────────────
// Axiom-style table with 3 sub-tabs: New, Top Gainers, Top by MC.
// Shares the same useDiscoveryFeed data — no new fetches.

type ExploreTab = "new" | "gainers" | "mcap";
const exploreTabs: { key: ExploreTab; label: string; icon: any }[] = [
  { key: "new",     label: "New",          icon: Sprout },
  { key: "gainers", label: "Top Gainers",  icon: TrendingUp },
  { key: "mcap",    label: "Top by MC",    icon: Flame },
];

function ExploreView({
  lists, loading,
}: { lists: { new: DiscoveryRow[]; final: DiscoveryRow[]; migrated: DiscoveryRow[] }; loading: boolean }) {
  const [tab, setTab] = useState<ExploreTab>("mcap");
  const [q, setQ] = useState("");
  const [quickBuy, setQuickBuy] = useQuickBuyAmount(`explore.${tab}`);

  const sorted = useMemo(() => {
    const pool = tab === "new"
      ? [...lists.new]
      : [...lists.migrated, ...lists.final];
    if (tab === "new") {
      return pool.sort((a, b) => +new Date(b.createdAt ?? 0) - +new Date(a.createdAt ?? 0));
    }
    if (tab === "gainers") {
      return pool
        .filter((r) => r.priceChange24h != null)
        .sort((a, b) => (b.priceChange24h ?? 0) - (a.priceChange24h ?? 0));
    }
    // mcap
    return pool
      .filter((r) => (r.marketCapUsd ?? 0) > 0)
      .sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0));
  }, [tab, lists]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return sorted;
    return sorted.filter(
      (r) => r.symbol.toLowerCase().includes(s) || r.name.toLowerCase().includes(s) || r.address.includes(s),
    );
  }, [sorted, q]);

  return (
    <div className="bg-background">
      {/* Sub-tabs + search + quick-buy */}
      <div className="px-3 sm:px-4 py-2 border-y border-white/5 flex items-center gap-2 flex-wrap">
        <div className="inline-flex items-center gap-1">
          {exploreTabs.map((t) => {
            const Icon = t.icon;
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`h-8 px-3 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 ${
                  on ? "lit-purple" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                }`}
              >
                <Icon className="size-3.5" /> {t.label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <QuickBuyAmountInput value={quickBuy} onChange={setQuickBuy} />
          <div className="flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-white/5 w-[160px]">
            <Search className="size-3 text-muted-foreground shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search token / address"
              className="flex-1 min-w-0 bg-transparent text-[11px] focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Desktop — full table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b border-white/5">
              <th className="text-left  px-3 py-2 font-medium">Token</th>
              <th className="text-right px-3 py-2 font-medium">M/C</th>
              <th className="text-right px-3 py-2 font-medium">Liq</th>
              <th className="text-right px-3 py-2 font-medium">Price %</th>
              <th className="text-right px-3 py-2 font-medium">Vol</th>
              <th className="text-right px-3 py-2 font-medium">Holders</th>
              <th className="text-right px-3 py-2 font-medium">Age</th>
              <th className="text-right px-3 py-2 font-medium pr-4">Buy</th>
            </tr>
          </thead>
          <tbody>
            {loading && filtered.length === 0 && (
              Array.from({ length: 8 }).map((_, i) => <ExploreRowSkeleton key={`skel-${i}`} />)
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-12 text-center text-muted-foreground text-xs">No tokens match.</td></tr>
            )}
            {filtered.map((r) => <ExploreRow key={r.address} row={r} quickBuyMon={quickBuy} />)}
          </tbody>
        </table>
      </div>

      {/* Mobile — stacked cards, denser, more data per row */}
      <ul className="md:hidden divide-y divide-white/5">
        {loading && filtered.length === 0 &&
          Array.from({ length: 8 }).map((_, i) => <ExploreMobileCardSkeleton key={`m-skel-${i}`} />)}
        {!loading && filtered.length === 0 && (
          <li className="px-4 py-12 text-center text-xs text-muted-foreground">No tokens match.</li>
        )}
        {filtered.map((r) => (
          <ExploreMobileCard key={`m-${r.address}`} row={r} quickBuyMon={quickBuy} />
        ))}
      </ul>
    </div>
  );
}

// Mobile card — denser, drops less-critical columns (Holders, Liq) and
// stacks Price%/MC/Vol horizontally under the token row so users see
// everything that matters above the fold.
function ExploreMobileCard({ row, quickBuyMon }: { row: DiscoveryRow; quickBuyMon: number }) {
  const me = useMe();
  const { run, pending } = useSwapExecute();
  const color = tokenColor(row.symbol);
  const change = row.priceChange24h;
  const changeColor = change == null ? "text-muted-foreground" : change >= 0 ? "text-up" : "text-down";

  const buy = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!me) { toast.error("Connect a wallet first"); return; }
    if (!(quickBuyMon > 0)) { toast.error("Set a Quick-Buy amount"); return; }
    try {
      await run({
        venue: row.isGraduated ? "dirol" : "nadfun",
        side: "buy",
        tokenAddress: row.address as `0x${string}`,
        rawAmount: BigInt(Math.floor(quickBuyMon * 1e18)),
        recipient: me as `0x${string}`,
        slippageBps: 500,
        source: "market",
        symbol: row.symbol,
      });
    } catch { /* toasted */ }
  };

  return (
    <li>
      <Link
        to="/token/$id"
        params={{ id: row.address }}
        className="block px-3 py-2.5 hover:bg-white/[0.03] active:bg-white/[0.05]"
      >
        <div className="flex items-center gap-2.5">
          {row.imageUri ? (
            <img src={row.imageUri} alt="" className="size-10 rounded-lg object-cover shrink-0" />
          ) : (
            <div
              className="size-10 rounded-lg grid place-items-center text-[11px] font-bold text-background shrink-0"
              style={{ background: `linear-gradient(135deg, ${color}, ${color}99)` }}
            >
              {row.symbol.slice(0, 2)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-bold text-[13px] truncate">{row.symbol}</span>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {formatDiscoveryAge(row.createdAt)}
              </span>
              <SocialIcons twitter={row.twitter} telegram={row.telegram} website={row.website} />
            </div>
            <div className="mt-0.5 flex items-center gap-3 text-[11px] tabular-nums">
              <span><span className="text-muted-foreground">MC </span><b>{fmtMc(row)}</b></span>
              <span><span className="text-muted-foreground">V </span><b>{fmtVol(row.volumeUsd)}</b></span>
              <span className={`font-bold ${changeColor}`}>
                {change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}
              </span>
            </div>
          </div>
          <button
            onClick={buy}
            disabled={pending || !me}
            className="shrink-0 h-8 pl-1.5 pr-3 rounded-full bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-[11px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <MonLogo size={16} />
            {pending ? "…" : quickBuyMon}
          </button>
        </div>
      </Link>
    </li>
  );
}

function ExploreMobileCardSkeleton() {
  return (
    <li className="px-3 py-2.5 animate-pulse">
      <div className="flex items-center gap-2.5">
        <div className="size-10 rounded-lg bg-white/10 shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 w-32 rounded bg-white/10" />
          <div className="h-2.5 w-40 rounded bg-white/5" />
        </div>
        <div className="h-8 w-16 rounded-full bg-white/10" />
      </div>
    </li>
  );
}

function ExploreRowSkeleton() {
  // Mirrors the real ExploreRow column widths so the layout never jumps
  // when live data arrives. Tailwind's animate-pulse handles the shimmer.
  return (
    <tr className="border-b border-white/5 animate-pulse">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="size-9 rounded-lg bg-white/10 shrink-0" />
          <div className="space-y-1.5 min-w-0">
            <div className="h-3 w-24 rounded bg-white/10" />
            <div className="h-2 w-16 rounded bg-white/5" />
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right"><div className="ml-auto h-3 w-14 rounded bg-white/10" /></td>
      <td className="px-3 py-2.5 text-right"><div className="ml-auto h-3 w-14 rounded bg-white/10" /></td>
      <td className="px-3 py-2.5 text-right"><div className="ml-auto h-3 w-12 rounded bg-white/10" /></td>
      <td className="px-3 py-2.5 text-right"><div className="ml-auto h-3 w-14 rounded bg-white/10" /></td>
      <td className="px-3 py-2.5 text-right"><div className="ml-auto h-3 w-10 rounded bg-white/10" /></td>
      <td className="px-3 py-2.5 text-right"><div className="ml-auto h-3 w-10 rounded bg-white/10" /></td>
      <td className="px-3 py-2.5 text-right pr-4"><div className="ml-auto h-7 w-16 rounded-full bg-white/10" /></td>
    </tr>
  );
}

function ExploreRow({ row, quickBuyMon }: { row: DiscoveryRow; quickBuyMon: number }) {
  const me = useMe();
  const { run, pending } = useSwapExecute();
  const color = tokenColor(row.symbol);
  const change = row.priceChange24h;
  const changeColor = change == null ? "text-muted-foreground" : change >= 0 ? "text-up" : "text-down";

  const buy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!me) { toast.error("Connect a wallet first"); return; }
    if (!(quickBuyMon > 0)) { toast.error("Set a Quick-Buy amount"); return; }
    const rawAmount = BigInt(Math.floor(quickBuyMon * 1e18));
    try {
      await run({
        venue: row.isGraduated ? "dirol" : "nadfun",
        side: "buy",
        tokenAddress: row.address as `0x${string}`,
        rawAmount,
        recipient: me as `0x${string}`,
        slippageBps: 500,
        source: "market",
        symbol: row.symbol,
      });
    } catch { /* toasted by hook */ }
  };

  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.03]">
      <td className="px-3 py-2.5">
        <Link to="/token/$id" params={{ id: row.address }} className="flex items-center gap-2 min-w-0">
          {row.imageUri ? (
            <img src={row.imageUri} alt="" className="size-9 rounded-lg object-cover shrink-0" />
          ) : (
            <div
              className="size-9 rounded-lg grid place-items-center text-[10px] font-bold text-background shrink-0"
              style={{ background: `linear-gradient(135deg, ${color}, ${color}99)` }}
            >
              {row.symbol.slice(0, 2)}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm truncate">{row.symbol}</span>
              <span className="text-[11px] text-muted-foreground truncate">{row.name}</span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <SocialIcons twitter={row.twitter} telegram={row.telegram} website={row.website} />
            </div>
          </div>
        </Link>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{fmtMc(row)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{fmtVol(row.liquidityUsd)}</td>
      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${changeColor}`}>
        {change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{fmtVol(row.volumeUsd)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{row.holderCount ?? "—"}</td>
      <td className="px-3 py-2.5 text-right text-muted-foreground">{formatDiscoveryAge(row.createdAt)}</td>
      <td className="px-3 py-2.5 text-right pr-4">
        <button
          onClick={buy}
          disabled={pending || !me}
          title={me ? `Quick-buy ${quickBuyMon} MON` : "Connect wallet to buy"}
          className="h-7 pl-1 pr-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-[11px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
        >
          <MonLogo size={16} />
          {pending ? "…" : quickBuyMon}
        </button>
      </td>
    </tr>
  );
}

