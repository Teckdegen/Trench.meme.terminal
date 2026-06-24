import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { fmtPct } from "@/lib/fmt";
import {
  useDiscoveryFeed,
  useLatestTradeFeed,
  formatDiscoveryAge,
  type DiscoveryRow,
  type PipelineColumn,
} from "@/lib/discovery-feed";
import {
  Search, ArrowRightLeft,
  Eye, Users, Coins, ShieldCheck, ShieldAlert, BarChart3,
  Twitter, Send, Globe,
  Flame, Sprout, TrendingUp,
  ArrowUp, ArrowDown, ArrowUpDown,
  SlidersHorizontal, X,
} from "lucide-react";
import { useMe } from "@/lib/useMe";
import { useExplorePriceChanges, type PriceChanges } from "@/lib/token-index";
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
  { key: "latest", label: "Latest Trades", subtitle: "Trading right now — live, 5s refresh" },
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
  const latest = useLatestTradeFeed();
  const rowsFor = (key: ColumnKey): DiscoveryRow[] =>
    key === "latest" ? latest.rows : lists[key as "new" | "final" | "migrated"];

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
          <div className="md:grid md:grid-cols-3 md:gap-px md:bg-white/5">
            {columns.map((c) => (
              <Column
                key={c.key}
                column={c}
                rows={rowsFor(c.key)}
                loading={c.key === "latest" ? latest.loading : loading}
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
  const [filters, setFilters] = useState<RangeFilters>(EMPTY_FILTERS);
  const filtered = useMemo(() => {
    const ranged = applyRangeFilters(rows, filters);
    const s = q.trim().toLowerCase();
    if (!s) return ranged;
    return ranged.filter(
      (r) => r.symbol.toLowerCase().includes(s) || r.name.toLowerCase().includes(s) || r.address.includes(s),
    );
  }, [rows, q, filters]);

  return (
    <div className={`${visibleOnMobile ? "" : "hidden"} md:block bg-background`}>
      <div className="px-3 py-3 border-b border-white/5 flex items-center gap-2 flex-wrap">
        <div>
          <span className="font-bold">{column.label}</span>
          <p className="text-[10px] text-muted-foreground">{column.subtitle}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <QuickBuyAmountInput value={quickBuy} onChange={setQuickBuy} />
          <FiltersControl filters={filters} setFilters={setFilters} />
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
        venue: "dirol",
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
              <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1.5">
                <span>Vol <span className="text-foreground">{fmtVol(row.volumeUsd)}</span></span>
                {row.priceChange24h != null && (
                  <span className={row.priceChange24h >= 0 ? "text-up font-semibold" : "text-down font-semibold"}>
                    {`${row.priceChange24h >= 0 ? "+" : ""}${row.priceChange24h.toFixed(1)}%`}
                  </span>
                )}
              </div>
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
            ) : mode === "latest" ? (
              <div className="flex-1 min-w-0 text-[10px] font-semibold text-up inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-up animate-pulse" />
                Trading now
                {row.priceChange24h != null && (
                  <span className={row.priceChange24h >= 0 ? "text-up" : "text-down"}>
                    {`${row.priceChange24h >= 0 ? "+" : ""}${row.priceChange24h.toFixed(1)}%`}
                  </span>
                )}
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

// Column sorting — clicking a header cycles desc → asc → off (tab default).
type SortKey = "mcap" | "liq" | "change" | "vol" | "age";
type SortState = { key: SortKey; dir: "desc" | "asc" } | null;

function sortValue(r: DiscoveryRow, k: SortKey): number {
  switch (k) {
    case "mcap":   return r.marketCapUsd ?? r.liquidityUsd ?? 0;
    case "liq":    return r.liquidityUsd ?? 0;
    case "change": return r.priceChange24h ?? Number.NEGATIVE_INFINITY;
    case "vol":    return r.volumeUsd ?? 0;
    case "age":    return r.createdAt ? +new Date(r.createdAt) : 0;
  }
}

// ─────────────────── Range filters ───────────────────────────────────
// Min/max filters over MC, price, volume and liquidity. Values accept
// plain numbers plus k/m/b suffixes ("250k", "1.5m"). Empty = no bound.
type RangeFilters = {
  mcMin: string; mcMax: string;
  priceMin: string; priceMax: string;
  volMin: string; volMax: string;
  liqMin: string; liqMax: string;
};
const EMPTY_FILTERS: RangeFilters = {
  mcMin: "", mcMax: "", priceMin: "", priceMax: "",
  volMin: "", volMax: "", liqMin: "", liqMax: "",
};

function parseFilterNum(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/[$,\s]/g, "");
  if (!t) return null;
  const m = /^([0-9]*\.?[0-9]+)([kmb])?$/.exec(t);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2] === "k") n *= 1e3;
  else if (m[2] === "m") n *= 1e6;
  else if (m[2] === "b") n *= 1e9;
  return Number.isFinite(n) ? n : null;
}

function activeFilterCount(f: RangeFilters): number {
  return (Object.values(f) as string[]).filter((v) => parseFilterNum(v) != null).length;
}

function applyRangeFilters(rows: DiscoveryRow[], f: RangeFilters): DiscoveryRow[] {
  const b = {
    mcMin: parseFilterNum(f.mcMin),   mcMax: parseFilterNum(f.mcMax),
    prMin: parseFilterNum(f.priceMin), prMax: parseFilterNum(f.priceMax),
    voMin: parseFilterNum(f.volMin),  voMax: parseFilterNum(f.volMax),
    liMin: parseFilterNum(f.liqMin),  liMax: parseFilterNum(f.liqMax),
  };
  if (Object.values(b).every((v) => v == null)) return rows;
  return rows.filter((r) => {
    const mc = r.marketCapUsd ?? r.liquidityUsd ?? 0;
    const pr = r.priceUsd ?? 0;
    const vo = r.volumeUsd ?? 0;
    const li = r.liquidityUsd ?? 0;
    if (b.mcMin != null && mc < b.mcMin) return false;
    if (b.mcMax != null && mc > b.mcMax) return false;
    if (b.prMin != null && pr < b.prMin) return false;
    if (b.prMax != null && pr > b.prMax) return false;
    if (b.voMin != null && vo < b.voMin) return false;
    if (b.voMax != null && vo > b.voMax) return false;
    if (b.liMin != null && li < b.liMin) return false;
    if (b.liMax != null && li > b.liMax) return false;
    return true;
  });
}

function FilterRangeRow({
  label, minKey, maxKey, filters, setFilters,
}: {
  label: string; minKey: keyof RangeFilters; maxKey: keyof RangeFilters;
  filters: RangeFilters; setFilters: (f: RangeFilters) => void;
}) {
  const inputCls =
    "w-full h-8 rounded-lg bg-white/5 px-2 text-[12px] tabular-nums focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/60";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
      <div className="flex items-center gap-1.5">
        <input
          value={filters[minKey]}
          onChange={(e) => setFilters({ ...filters, [minKey]: e.target.value })}
          placeholder="Min"
          className={inputCls}
        />
        <span className="text-muted-foreground text-[11px]">–</span>
        <input
          value={filters[maxKey]}
          onChange={(e) => setFilters({ ...filters, [maxKey]: e.target.value })}
          placeholder="Max"
          className={inputCls}
        />
      </div>
    </div>
  );
}

function FiltersControl({
  filters, setFilters,
}: { filters: RangeFilters; setFilters: (f: RangeFilters) => void }) {
  const [open, setOpen] = useState(false);
  const n = activeFilterCount(filters);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`h-7 px-2.5 rounded-full text-[11px] font-semibold inline-flex items-center gap-1.5 ${
          n > 0 || open ? "lit-purple" : "bg-white/5 text-muted-foreground hover:text-foreground"
        }`}
      >
        <SlidersHorizontal className="size-3" />
        Filters
        {n > 0 && (
          <span className="min-w-4 h-4 px-1 rounded-full bg-white/25 text-[9px] font-bold grid place-items-center">
            {n}
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute right-0 top-9 z-50 w-[270px] rounded-2xl bg-background border border-white/10 p-3 space-y-2.5"
          style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.7)" }}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold">Filters</p>
            <button onClick={() => setOpen(false)} className="size-6 grid place-items-center rounded-full bg-white/5">
              <X className="size-3" />
            </button>
          </div>
          <FilterRangeRow label="Market cap ($)" minKey="mcMin" maxKey="mcMax" filters={filters} setFilters={setFilters} />
          <FilterRangeRow label="Price ($)" minKey="priceMin" maxKey="priceMax" filters={filters} setFilters={setFilters} />
          <FilterRangeRow label="Volume ($)" minKey="volMin" maxKey="volMax" filters={filters} setFilters={setFilters} />
          <FilterRangeRow label="Liquidity ($)" minKey="liqMin" maxKey="liqMax" filters={filters} setFilters={setFilters} />
          <p className="text-[10px] text-muted-foreground">
            Shorthand works: 250k, 1.5m, 2b
          </p>
          <div className="flex gap-2 pt-0.5">
            <button
              onClick={() => setFilters(EMPTY_FILTERS)}
              disabled={n === 0}
              className="flex-1 h-8 rounded-lg bg-white/5 text-[11px] font-semibold disabled:opacity-40"
            >
              Clear all
            </button>
            <button
              onClick={() => setOpen(false)}
              className="flex-1 h-8 rounded-lg lit-purple text-[11px] font-semibold"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortIcon({ sort, k }: { sort: SortState; k: SortKey }) {
  if (sort?.key !== k) return <ArrowUpDown className="size-3 opacity-35" />;
  return sort.dir === "desc"
    ? <ArrowDown className="size-3 text-primary" />
    : <ArrowUp className="size-3 text-primary" />;
}

function SortTh({
  label, k, sort, onSort, alignLeft,
}: { label: string; k: SortKey; sort: SortState; onSort: (k: SortKey) => void; alignLeft?: boolean }) {
  const active = sort?.key === k;
  return (
    <th className={`${alignLeft ? "text-left" : "text-right"} px-3 py-2 font-medium`}>
      <button
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide ${
          active ? "text-foreground" : "hover:text-foreground"
        }`}
        title={`Sort by ${label}`}
      >
        {label} <SortIcon sort={sort} k={k} />
      </button>
    </th>
  );
}

function ExploreView({
  lists, loading,
}: { lists: { new: DiscoveryRow[]; final: DiscoveryRow[]; migrated: DiscoveryRow[] }; loading: boolean }) {
  const [tab, setTab] = useState<ExploreTab>("mcap");
  const [q, setQ] = useState("");
  const [quickBuy, setQuickBuy] = useQuickBuyAmount(`explore.${tab}`);
  const [sort, setSort] = useState<SortState>(null);
  const [filters, setFilters] = useState<RangeFilters>(EMPTY_FILTERS);
  const toggleSort = (key: SortKey) => {
    setSort((s) => s?.key !== key
      ? { key, dir: "desc" }
      : s.dir === "desc" ? { key, dir: "asc" } : null);
  };

  const sorted = useMemo(() => {
    const pool = tab === "new"
      ? [...lists.new]
      : [...lists.migrated, ...lists.final];
    // Tab default ordering
    let rows: DiscoveryRow[];
    if (tab === "new") {
      rows = pool.sort((a, b) => +new Date(b.createdAt ?? 0) - +new Date(a.createdAt ?? 0));
    } else if (tab === "gainers") {
      rows = pool
        .filter((r) => r.priceChange24h != null)
        .sort((a, b) => (b.priceChange24h ?? 0) - (a.priceChange24h ?? 0));
    } else {
      rows = pool
        .filter((r) => (r.marketCapUsd ?? 0) > 0)
        .sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0));
    }
    // User-picked column sort overrides the tab default
    if (sort) {
      const mul = sort.dir === "desc" ? -1 : 1;
      rows = [...rows].sort((a, b) => (sortValue(a, sort.key) - sortValue(b, sort.key)) * mul);
    }
    return rows;
  }, [tab, lists, sort]);

  const filtered = useMemo(() => {
    const ranged = applyRangeFilters(sorted, filters);
    const s = q.trim().toLowerCase();
    if (!s) return ranged;
    return ranged.filter(
      (r) => r.symbol.toLowerCase().includes(s) || r.name.toLowerCase().includes(s) || r.address.includes(s),
    );
  }, [sorted, q, filters]);

  // OHLCV-derived 5M/1H/6H/12H/24H changes for the visible tokens (top 50,
  // cached server-side). Recomputed only when the visible set changes.
  const changeTokens = useMemo(() => filtered.slice(0, 50).map((r) => r.address), [filtered]);
  const changes = useExplorePriceChanges(changeTokens);

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
          <FiltersControl filters={filters} setFilters={setFilters} />
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
              <SortTh label="M/C" k="mcap" sort={sort} onSort={toggleSort} />
              <th className="text-right px-2 py-2 font-medium">5M</th>
              <th className="text-right px-2 py-2 font-medium">1H</th>
              <th className="text-right px-2 py-2 font-medium">6H</th>
              <th className="text-right px-2 py-2 font-medium">12H</th>
              <SortTh label="24H" k="change" sort={sort} onSort={toggleSort} />
              <SortTh label="Vol" k="vol" sort={sort} onSort={toggleSort} />
              <SortTh label="Liq" k="liq" sort={sort} onSort={toggleSort} />
              <SortTh label="Age" k="age" sort={sort} onSort={toggleSort} />
              <th className="text-right px-3 py-2 font-medium pr-4">Buy</th>
            </tr>
          </thead>
          <tbody>
            {loading && filtered.length === 0 && (
              Array.from({ length: 8 }).map((_, i) => <ExploreRowSkeleton key={`skel-${i}`} />)
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={11} className="px-3 py-12 text-center text-muted-foreground text-xs">No tokens match.</td></tr>
            )}
            {filtered.map((r) => (
              <ExploreRow key={r.address} row={r} quickBuyMon={quickBuy} changes={changes[r.address.toLowerCase()]} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile — sort pills (desktop sorts via the table headers) */}
      <div className="md:hidden px-3 py-2 border-b border-white/5 flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">Sort</span>
        {([
          ["mcap", "MC"],
          ["vol", "Vol"],
          ["change", "Price %"],
          ["age", "Age"],
        ] as [SortKey, string][]).map(([k, label]) => {
          const active = sort?.key === k;
          return (
            <button
              key={k}
              onClick={() => toggleSort(k)}
              className={`h-7 px-2.5 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 shrink-0 ${
                active ? "lit-purple" : "bg-white/5 text-muted-foreground"
              }`}
            >
              {label} <SortIcon sort={sort} k={k} />
            </button>
          );
        })}
      </div>

      {/* Mobile — stacked cards, denser, more data per row */}
      <ul className="md:hidden divide-y divide-white/5">
        {loading && filtered.length === 0 &&
          Array.from({ length: 8 }).map((_, i) => <ExploreMobileCardSkeleton key={`m-skel-${i}`} />)}
        {!loading && filtered.length === 0 && (
          <li className="px-4 py-12 text-center text-xs text-muted-foreground">No tokens match.</li>
        )}
        {filtered.map((r) => (
          <ExploreMobileCard key={`m-${r.address}`} row={r} quickBuyMon={quickBuy} changes={changes[r.address.toLowerCase()]} />
        ))}
      </ul>
    </div>
  );
}

// One labelled price-change chip for the mobile card.
function DeltaChip({ label, v }: { label: string; v: number | null | undefined }) {
  const cls = v == null ? "text-muted-foreground" : v >= 0 ? "text-up" : "text-down";
  return (
    <div className="rounded-md bg-white/[0.04] py-1 text-center">
      <div className="text-[8px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-[11px] font-bold tabular-nums leading-tight ${cls}`}>
        {v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}
      </div>
    </div>
  );
}

// Mobile card — token row + MC/Vol, then a silky 5-window price-change strip.
function ExploreMobileCard({ row, quickBuyMon, changes }: { row: DiscoveryRow; quickBuyMon: number; changes?: PriceChanges }) {
  const me = useMe();
  const { run, pending } = useSwapExecute();
  const color = tokenColor(row.symbol);

  const buy = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!me) { toast.error("Connect a wallet first"); return; }
    if (!(quickBuyMon > 0)) { toast.error("Set a Quick-Buy amount"); return; }
    try {
      await run({
        venue: "dirol",
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
              <span><span className="text-muted-foreground">Liq </span><b>{fmtVol(row.liquidityUsd)}</b></span>
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

        {/* 5-window price-change strip */}
        <div className="mt-2 grid grid-cols-5 gap-1">
          <DeltaChip label="5m" v={changes?.m5} />
          <DeltaChip label="1h" v={changes?.h1} />
          <DeltaChip label="6h" v={changes?.h6} />
          <DeltaChip label="12h" v={changes?.h12} />
          <DeltaChip label="24h" v={changes?.h24 ?? row.priceChange24h} />
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
      <td className="px-3 py-2.5 text-right pr-4"><div className="ml-auto h-7 w-16 rounded-full bg-white/10" /></td>
    </tr>
  );
}

// One price-change cell (e.g. 5M). Green/red, "—" until data arrives.
function DeltaCell({ v }: { v: number | null | undefined }) {
  const cls = v == null ? "text-muted-foreground" : v >= 0 ? "text-up" : "text-down";
  return (
    <td className={`px-2 py-2.5 text-right tabular-nums font-semibold ${cls}`}>
      {v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`}
    </td>
  );
}

function ExploreRow({ row, quickBuyMon, changes }: { row: DiscoveryRow; quickBuyMon: number; changes?: PriceChanges }) {
  const me = useMe();
  const { run, pending } = useSwapExecute();
  const color = tokenColor(row.symbol);

  const buy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!me) { toast.error("Connect a wallet first"); return; }
    if (!(quickBuyMon > 0)) { toast.error("Set a Quick-Buy amount"); return; }
    const rawAmount = BigInt(Math.floor(quickBuyMon * 1e18));
    try {
      await run({
        venue: "dirol",
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
      <DeltaCell v={changes?.m5} />
      <DeltaCell v={changes?.h1} />
      <DeltaCell v={changes?.h6} />
      <DeltaCell v={changes?.h12} />
      <DeltaCell v={changes?.h24 ?? row.priceChange24h} />
      <td className="px-3 py-2.5 text-right tabular-nums">{fmtVol(row.volumeUsd)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{fmtVol(row.liquidityUsd)}</td>
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

