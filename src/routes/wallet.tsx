import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, ColorType, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { useMe } from "@/lib/useMe";
import { useDirectTokenBalance, useMonBalance, useTokenHoldings } from "@/lib/wallet-tx";
import { MonLogo } from "@/components/MonLogo";
import {
  useWalletPnl,
  useMyTrades,
} from "@/lib/supabase-hooks";
import { fmtUsd } from "@/lib/fmt";
import { useIdentity, labelFor } from "@/lib/identity";
import {
  ArrowUpRight, ArrowDownLeft, TrendingUp, Activity, Percent, Wallet as WalletIcon, Target, BarChart3,
} from "lucide-react";
import { MobileTabs } from "@/components/SimpleLayout";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { txUrl } from "@/lib/explorer";
import { computePnlFromTrades } from "@/lib/pnl";
import { COMMON_TOKENS } from "@/lib/dirol";
import { unwrapWmon } from "@/lib/para-session";
import { fetchZerionTransactions, type ZerionTransaction } from "@/lib/zerion";
export const Route = createFileRoute("/wallet")({ component: PortfolioPage });

function PortfolioPage() {
  useDocumentTitle("Wallet");
  const me = useMe();
  const [mTab, setMTab] = useState<"portfolio" | "transactions">("portfolio");
  const { snap, loading: pnlLoading } = useWalletPnl(me, "ALL");
  const { trades, loading: tradesLoading } = useMyTrades(me, 40);
  const [walletTxs, setWalletTxs] = useState<ZerionTransaction[]>([]);
  const [walletTxLoading, setWalletTxLoading] = useState(false);
  const livePnl = useMemo(() => {
    if (trades.length === 0) return null;
    return computePnlFromTrades(trades).byWindow.get("ALL") ?? null;
  }, [trades]);

  const roi = useMemo(() => {
    const r = Number(livePnl?.realized ?? snap?.realized_usd ?? 0);
    const u = Number(snap?.unrealized_usd ?? 0);
    const vol = Number(livePnl?.volume ?? snap?.volume_usd ?? 0);
    if (vol <= 0) return 0;
    return ((r + u) / vol) * 100;
  }, [livePnl, snap]);

  // Equity curve — cumulative net USD flow (sells in, buys out) per trade,
  // with real timestamps so the chart's time axis means something.
  const equityCurve = useMemo(() => {
    if (trades.length === 0) return [] as { time: number; value: number }[];
    let cum = 0;
    const pts: { time: number; value: number }[] = [];
    for (const t of [...trades].reverse()) {
      const v = Number(t.value_usd ?? 0);
      cum += t.side === "SELL" ? v : -v;
      let ts = Math.floor(+new Date(t.created_at_chain ?? Date.now()) / 1000);
      const last = pts[pts.length - 1];
      if (last && ts <= last.time) ts = last.time + 1; // strictly ascending
      pts.push({ time: ts, value: cum });
    }
    return pts;
  }, [trades]);

  useEffect(() => {
    if (!me) { setWalletTxs([]); return; }
    let cancel = false;
    setWalletTxLoading(true);
    fetchZerionTransactions({ data: { address: me, limit: 50 } })
      .then((r) => { if (!cancel) setWalletTxs(r.transactions); })
      .catch(() => { if (!cancel) setWalletTxs([]); })
      .finally(() => { if (!cancel) setWalletTxLoading(false); });
    return () => { cancel = true; };
  }, [me]);

  return (
    <div className="space-y-4 sectioned">
      <WalletHeader />
      <WmonUnwrapPrompt />

      <MobileTabs
        value={mTab}
        onChange={setMTab}
        tabs={[
          { key: "portfolio", label: "Portfolio" },
          { key: "transactions", label: "Transactions" },
        ]}
      />

      {/* Portfolio value — real chart at the top (Zerion-style) */}
      <div className={`rounded-3xl ios-glass-card p-4 ${mTab === "portfolio" ? "" : "hidden"} md:block`}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Portfolio value</p>
            {equityCurve.length > 0 ? (
              <p className={`text-2xl font-bold tabular-nums mt-0.5 ${
                equityCurve[equityCurve.length - 1].value >= 0 ? "text-up" : "text-down"
              }`}>
                {fmtUsd(equityCurve[equityCurve.length - 1].value)}
              </p>
            ) : (
              <p className="text-2xl font-bold tabular-nums mt-0.5">$0.00</p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">
              {trades.length === 0
                ? "No indexed trades yet — fire a swap to see your curve."
                : `Net flow across ${trades.length} trades`}
            </p>
          </div>
        </div>
        <PerformanceChart points={equityCurve} />
      </div>

      {/* Portfolio Allocation — donut, same purple palette */}
      <div className={mTab === "portfolio" ? "" : "hidden md:block"}>
        <PortfolioAllocation />
      </div>

      <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 ${mTab === "portfolio" ? "" : "hidden"} md:grid`}>
        <StatTile
          label="ROI"
          value={pnlLoading && !livePnl ? "..." : `${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%`}
          icon={Percent}
          tone={roi >= 0 ? "up" : "down"}
        />
        <StatTile
          label="Realized PnL"
          value={pnlLoading && !livePnl ? "..." : fmtUsd(Number(livePnl?.realized ?? snap?.realized_usd ?? 0))}
          icon={TrendingUp}
          tone={(livePnl?.realized ?? snap?.realized_usd ?? 0) >= 0 ? "up" : "down"}
        />
        <StatTile
          label="Unrealized"
          value={pnlLoading ? "..." : fmtUsd(Number(snap?.unrealized_usd ?? 0))}
          icon={Activity}
          tone={(snap?.unrealized_usd ?? 0) >= 0 ? "up" : "down"}
        />
        <StatTile
          label="Volume"
          value={pnlLoading && !livePnl ? "..." : fmtUsd(Number(livePnl?.volume ?? snap?.volume_usd ?? 0))}
          icon={BarChart3}
        />
        <StatTile
          label="Win Rate"
          value={pnlLoading && !livePnl ? "..." : livePnl && livePnl.sells > 0 ? `${((livePnl.wins / livePnl.sells) * 100).toFixed(0)}%` : `${Number(snap?.win_rate_pct ?? 0).toFixed(0)}%`}
          icon={Target}
        />
        <StatTile
          label="Trades"
          value={pnlLoading && !livePnl ? "..." : String(livePnl?.trades ?? snap?.trades_count ?? trades.length)}
          icon={WalletIcon}
        />
      </div>

      <WalletHistoryTab transactions={walletTxs} loading={walletTxLoading || tradesLoading} hidden={mTab !== "transactions"} />

      {/* Tokens holding — the final thing on the page */}
      <div className={mTab === "portfolio" ? "" : "hidden md:block"}>
        <Holdings />
      </div>
    </div>
  );
}

// Full-width equity-curve area chart (lightweight-charts, same library as
// the token candle charts). Purple area over transparent bg, auto-resizes
// to the card width, fits all points into view on every data update.
function PerformanceChart({ points }: { points: { time: number; value: number }[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height: 260,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9ca3af",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.06)" },
      timeScale: { borderColor: "rgba(255,255,255,0.06)", timeVisible: true, secondsVisible: false },
      handleScroll: false,
      handleScale: false,
    });
    const area = chart.addAreaSeries({
      lineColor: "#a855f7",
      lineWidth: 2,
      topColor: "rgba(168,85,247,0.35)",
      bottomColor: "rgba(168,85,247,0.02)",
      priceLineVisible: false,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    chartRef.current = chart;
    seriesRef.current = area;

    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        chart.applyOptions({ width: e.contentRect.width });
        chart.timeScale().fitContent();
      }
    });
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    seriesRef.current.setData(points.map((p) => ({ time: p.time as Time, value: p.value })));
    chartRef.current.timeScale().fitContent();
  }, [points]);

  // Always mount the container — the chart is created once on mount, so an
  // early return here would leave it uninitialized when trades arrive later.
  return (
    <div className="relative mt-2 min-h-[260px]">
      <div ref={ref} className={`w-full ${points.length < 2 ? "invisible" : ""}`} />
      {points.length < 2 && (
        <div className="absolute inset-0 grid place-items-center">
          <p className="text-xs text-muted-foreground">
            Your equity curve appears here after a couple of trades.
          </p>
        </div>
      )}
    </div>
  );
}

function WmonUnwrapPrompt() {
  const me = useMe();
  const wmon = useDirectTokenBalance(me, COMMON_TOKENS.WMON);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!me || wmon.raw <= 0n || visible || busy) return;
    const key = `wmon-unwrap-next:${me.toLowerCase()}`;
    const nextAt = Number(localStorage.getItem(key) || "0");
    const wait = Math.max(0, nextAt - Date.now());
    const id = window.setTimeout(() => setVisible(true), wait);
    return () => window.clearTimeout(id);
  }, [me, wmon.raw, visible, busy]);

  if (!me || wmon.raw <= 0n || !visible) return null;

  const dismiss = () => {
    localStorage.setItem(`wmon-unwrap-next:${me.toLowerCase()}`, String(Date.now() + 5 * 60_000));
    setVisible(false);
    setError("");
  };

  const unwrap = async () => {
    setBusy(true);
    setError("");
    try {
      await unwrapWmon({ data: { owner: me } });
      await wmon.refresh();
      setVisible(false);
    } catch (e: any) {
      setError(e?.message ?? "Could not unwrap WMON.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 px-4">
      <div className="w-full max-w-sm rounded-2xl ios-glass-card border border-primary/30 p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold">Unwrap WMON?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              You have {wmon.balance.toFixed(4)} WMON. Convert it back to native MON for cleaner sells and transfers.
            </p>
          </div>
          <button onClick={dismiss} className="size-8 rounded-full bg-white/5 text-muted-foreground hover:text-foreground">
            x
          </button>
        </div>
        {error && <p className="mt-3 text-xs text-down">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button
            onClick={dismiss}
            className="h-10 flex-1 rounded-xl bg-white/5 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            Later
          </button>
          <button
            onClick={() => void unwrap()}
            disabled={busy}
            className="h-10 flex-1 rounded-xl lit-purple text-sm font-semibold disabled:opacity-50"
          >
            {busy ? "Unwrapping..." : "Unwrap all"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Portfolio Allocation — donut of token holdings by USD value, same purple
// palette. Center shows total value; legend lists each token's share.
const ALLOC_COLORS = [
  "#a855f7", "#8b5cf6", "#c084fc", "#7c3aed", "#d946ef",
  "#6366f1", "#e879f9", "#a78bfa", "#9333ea", "#7e22ce",
];

function PortfolioAllocation() {
  const me = useMe();
  const { holdings, loading } = useTokenHoldings(me);
  if (!me) return null;

  const valued = holdings
    .filter((h) => (h.valueUsd ?? 0) > 0)
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  const total = valued.reduce((a, h) => a + (h.valueUsd ?? 0), 0);

  // Build donut slices. Group anything past the top 8 into "Other".
  const top = valued.slice(0, 8);
  const otherVal = valued.slice(8).reduce((a, h) => a + (h.valueUsd ?? 0), 0);
  const slices = [
    ...top.map((h, i) => ({ label: h.symbol, value: h.valueUsd ?? 0, color: ALLOC_COLORS[i % ALLOC_COLORS.length] })),
    ...(otherVal > 0 ? [{ label: "Other", value: otherVal, color: "#4b5563" }] : []),
  ];

  const R = 46, SW = 16, C = 2 * Math.PI * R;
  let acc = 0;

  return (
    <section className="rounded-2xl bg-surface border border-white/5 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/5">
        <h3 className="font-semibold text-sm">Portfolio Allocation</h3>
      </div>
      {loading && valued.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : total <= 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">No valued holdings yet.</p>
      ) : (
        <div className="p-4 flex flex-col sm:flex-row items-center gap-5">
          {/* Donut */}
          <div className="relative shrink-0" style={{ width: 150, height: 150 }}>
            <svg viewBox="0 0 120 120" width={150} height={150}>
              <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={SW} />
              {slices.map((s, i) => {
                const frac = s.value / total;
                const dash = frac * C;
                const el = (
                  <circle key={i} cx="60" cy="60" r={R} fill="none"
                    stroke={s.color} strokeWidth={SW}
                    strokeDasharray={`${dash} ${C - dash}`}
                    strokeDashoffset={-acc * C}
                    transform="rotate(-90 60 60)" strokeLinecap="butt" />
                );
                acc += frac;
                return el;
              })}
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="text-[10px] text-muted-foreground leading-none">Total</p>
                <p className="text-base font-bold tabular-nums leading-tight mt-0.5">{fmtUsd(total)}</p>
              </div>
            </div>
          </div>
          {/* Legend */}
          <ul className="flex-1 w-full space-y-1.5 min-w-0">
            {slices.map((s, i) => {
              const pct = (s.value / total) * 100;
              return (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span className="size-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                  <span className="font-medium truncate">{s.label}</span>
                  <span className="ml-auto text-muted-foreground tabular-nums shrink-0">{pct.toFixed(1)}%</span>
                  <span className="w-16 text-right font-semibold tabular-nums shrink-0">{fmtUsd(s.value)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function WalletHistoryTab({
  transactions, loading, hidden,
}: { transactions: ZerionTransaction[]; loading: boolean; hidden: boolean }) {
  return (
    <div className={`rounded-3xl ios-glass-card overflow-hidden ${hidden ? "hidden" : ""}`}>
      <div className="px-4 py-3 font-semibold text-sm border-b border-white/5">Transactions</div>
      {loading && <p className="p-8 text-center text-sm text-muted-foreground">Loading...</p>}
      {!loading && transactions.length === 0 && (
        <p className="p-8 text-center text-sm text-muted-foreground">No wallet transactions found yet.</p>
      )}
      <ul>
        {transactions.map((tx) => {
          const out = tx.direction === "out";
          const Icon = out ? ArrowUpRight : ArrowDownLeft;
          const asset = tx.changes.find((c) => c.imageUri || c.symbol !== "?") ?? tx.changes[0];
          const symbol = asset?.symbol ?? "TX";
          const tokenLink = asset?.address && /^0x[a-f0-9]{40}$/.test(asset.address);
          return (
            <li key={tx.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 last:border-0">
              {asset?.imageUri ? (
                <img src={asset.imageUri} alt={symbol} className="size-9 rounded-full object-cover shrink-0" />
              ) : (
                <div className={`size-9 rounded-full ios-glass-soft grid place-items-center ${out ? "text-down" : "text-up"}`}>
                  <Icon className="size-4" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                {tokenLink ? (
                  <Link to="/token/$id" params={{ id: asset.address! }} className="text-sm font-medium hover:underline truncate block">
                    {tx.title || symbol}
                  </Link>
                ) : (
                  <p className="text-sm font-medium truncate">{tx.title || symbol}</p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {asset?.name ? `${asset.name} - ` : ""}{tx.minedAt ? new Date(tx.minedAt).toLocaleString() : "Pending"}
                </p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-semibold ${out ? "text-down" : "text-up"}`}>
                  {tx.valueUsd != null ? fmtUsd(Math.abs(tx.valueUsd)) : asset?.amount != null ? `${asset.amount.toFixed(4)} ${symbol}` : "-"}
                </p>
                <a
                  href={txUrl(tx.hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-primary hover:underline"
                >
                  tx â†-
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Holdings() {
  const me = useMe();
  const { holdings, loading } = useTokenHoldings(me);

  if (!me) return null;

  if (loading && holdings.length === 0) {
    return (
      <section className="rounded-2xl bg-surface border border-white/5 p-6 text-center text-sm text-muted-foreground">
        Loading holdings...
      </section>
    );
  }

  if (holdings.length === 0) {
    return (
      <section className="rounded-2xl bg-surface border border-white/5 p-6 text-center">
        <p className="text-sm text-muted-foreground">No tokens yet. Start trading to see holdings here.</p>
      </section>
    );
  }

  const totalValue = holdings.reduce((a, h) => a + (h.valueUsd ?? 0), 0);

  return (
    <section className="rounded-2xl bg-surface border border-white/5 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
        <h3 className="font-semibold text-sm">Holdings</h3>
        <span className="text-xs text-muted-foreground">{holdings.length} - ${totalValue.toFixed(2)}</span>
      </div>
      <ul className="divide-y divide-white/5">
        {holdings.map((h) => (
          <li key={h.address}>
            <Link
              to="/token/$id"
              params={{ id: h.address }}
              className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03]"
            >
              {h.imageUri ? (
                <img src={h.imageUri} alt={h.symbol} className="size-9 rounded-full object-cover shrink-0" />
              ) : (
                <div className="size-9 rounded-full bg-white/10 grid place-items-center text-[10px] font-bold shrink-0">
                  {h.symbol.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{h.symbol}</p>
                <p className="text-[11px] text-muted-foreground truncate">{h.name}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold tabular-nums">{h.balance.toFixed(4)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {h.valueUsd != null ? `$${h.valueUsd.toFixed(2)}` : "-"}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WalletHeader() {
  const me = useMe();
  const myIdentity = useIdentity(me);
  const { balance, loading } = useMonBalance(me);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!me) return;
    const h = myIdentity?.handle;
    navigator.clipboard?.writeText(h ? `@${h}` : me);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Portfolio</h1>
        {me ? (
          <button onClick={copy} className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <span>{labelFor(myIdentity, { at: true })}</span>
            {copied ? "Copied Copied" : "- Tap to copy"}
          </button>
        ) : (
          <p className="text-sm text-muted-foreground mt-1">Sign in to see your wallet</p>
        )}
      </div>
      <div className="text-right">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Balance</p>
        <div className="inline-flex items-center gap-1.5">
          <MonLogo size={22} />
          <p className="text-2xl font-bold">{loading ? "..." : `${balance.toFixed(4)} MON`}</p>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label, value, icon: Icon, tone,
}: { label: string; value: string; icon: any; tone?: "up" | "down" }) {
  return (
    <div className="rounded-2xl ios-glass-card p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <p
        className={`text-lg font-bold mt-1 ${
          tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
