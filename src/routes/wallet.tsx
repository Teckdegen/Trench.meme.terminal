import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMe } from "@/lib/useMe";
import { useMonBalance, useTokenHoldings } from "@/lib/wallet-tx";
import { MonLogo } from "@/components/MonLogo";
import {
  useWalletPnl,
  useMyTrades,
  useMyPosts,
  createPost,
  useAccountProfile,
  SUPABASE_ENABLED,
} from "@/lib/supabase-hooks";
import { fmtUsd } from "@/lib/fmt";
import { useIdentity, labelFor } from "@/lib/identity";
import {
  ArrowUpRight, ArrowDownLeft, TrendingUp, Activity, Percent, Wallet as WalletIcon, Target, BarChart3,
} from "lucide-react";
import { Sparkline } from "@/components/Charts";
import { MobileTabs } from "@/components/SimpleLayout";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
export const Route = createFileRoute("/wallet")({ component: PortfolioPage });

function PortfolioPage() {
  useDocumentTitle("Wallet");
  const me = useMe();
  const [mTab, setMTab] = useState<"stats" | "posts" | "history">("stats");
  const { snap, loading: pnlLoading } = useWalletPnl(me, "ALL");
  const { trades, loading: tradesLoading } = useMyTrades(me, 40);
  const { posts, loading: postsLoading } = useMyPosts(me);
  const { profile } = useAccountProfile(me);

  const roi = useMemo(() => {
    const r = Number(snap?.realized_usd ?? 0);
    const u = Number(snap?.unrealized_usd ?? 0);
    const vol = Number(snap?.volume_usd ?? 0);
    if (vol <= 0) return 0;
    return ((r + u) / vol) * 100;
  }, [snap]);

  const equityCurve = useMemo(() => {
    if (trades.length < 2) return Array.from({ length: 24 }, (_, i) => 20 + i * 0.5);
    let cum = 0;
    const pts: number[] = [];
    for (const t of [...trades].reverse()) {
      const v = Number(t.value_usd ?? 0);
      cum += t.side === "SELL" ? v : -v;
      pts.push(Math.max(0, 20 + cum / 50));
    }
    return pts;
  }, [trades]);

  return (
    <div className="space-y-4 sectioned">
      <WalletHeader />
      <Holdings />

      <MobileTabs
        value={mTab}
        onChange={setMTab}
        tabs={[
          { key: "stats", label: "Stats" },
          { key: "posts", label: "Posts" },
          { key: "history", label: "History" },
        ]}
      />

      <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 ${mTab === "stats" ? "" : "hidden"} md:grid`}>
        <StatTile
          label="ROI"
          value={pnlLoading ? "…" : `${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%`}
          icon={Percent}
          tone={roi >= 0 ? "up" : "down"}
        />
        <StatTile
          label="Realized PnL"
          value={pnlLoading ? "…" : fmtUsd(Number(snap?.realized_usd ?? 0))}
          icon={TrendingUp}
          tone={(snap?.realized_usd ?? 0) >= 0 ? "up" : "down"}
        />
        <StatTile
          label="Unrealized"
          value={pnlLoading ? "…" : fmtUsd(Number(snap?.unrealized_usd ?? 0))}
          icon={Activity}
          tone={(snap?.unrealized_usd ?? 0) >= 0 ? "up" : "down"}
        />
        <StatTile
          label="Volume"
          value={pnlLoading ? "…" : fmtUsd(Number(snap?.volume_usd ?? 0))}
          icon={BarChart3}
        />
        <StatTile
          label="Win Rate"
          value={pnlLoading ? "…" : `${Number(snap?.win_rate_pct ?? 0).toFixed(0)}%`}
          icon={Target}
        />
        <StatTile
          label="Trades"
          value={pnlLoading ? "…" : String(snap?.trades_count ?? trades.length)}
          icon={WalletIcon}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
        <div className="space-y-4">
          <WalletPostsTab
            me={me}
            posts={posts}
            loading={postsLoading}
            profile={profile}
            hidden={mTab !== "posts"}
          />
          <WalletHistoryTab trades={trades} loading={tradesLoading} hidden={mTab !== "history"} />
        </div>

        <aside className={`space-y-4 ${mTab === "history" || mTab === "stats" ? "" : "hidden"} md:block`}>
          <div className="rounded-3xl ios-glass-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Performance</h3>
              <span className="text-xs text-muted-foreground">All time</span>
            </div>
            <Sparkline data={equityCurve} color="#a855f7" height={70} width={300} />
            <p className="text-xs text-muted-foreground mt-1">
              {trades.length === 0
                ? "No indexed trades yet — fire a swap to see your curve."
                : `${trades.length} trades indexed`}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function WalletPostsTab({
  me, posts, loading, profile, hidden,
}: {
  me: string | undefined;
  posts: ReturnType<typeof useMyPosts>["posts"];
  loading: boolean;
  profile: ReturnType<typeof useAccountProfile>["profile"];
  hidden: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  const submit = async () => {
    if (!me || !draft.trim() || !SUPABASE_ENABLED) return;
    setPosting(true);
    try {
      await createPost({ data: { author_address: me, body: draft.trim() } });
      setDraft("");
    } catch (e) {
      console.error(e);
    } finally {
      setPosting(false);
    }
  };

  const myIdentity = useIdentity(me);
  const display = profile?.display_name ?? (labelFor(myIdentity, { at: false }) || "You");

  return (
    <div className={hidden ? "hidden" : ""}>
      <div className="rounded-3xl ios-glass-card p-4 mb-4">
        <div className="flex gap-3">
          <div
            className="size-10 rounded-full grid place-items-center text-sm font-bold shrink-0 overflow-hidden"
            style={{ background: "linear-gradient(135deg, #a855f7, #ec4899)" }}
          >
            {profile?.image_uri ? (
              <img src={profile.image_uri} alt="" className="size-full object-cover" />
            ) : (
              display[0]?.toUpperCase()
            )}
          </div>
          <div className="flex-1">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Share an update with your followers"
              rows={2}
              disabled={!me}
              className="w-full bg-transparent text-base placeholder:text-muted-foreground/70 focus:outline-none resize-none disabled:opacity-50"
            />
            <div className="flex justify-end mt-2">
              <button
                onClick={() => void submit()}
                disabled={!draft.trim() || !me || posting}
                className="h-8 px-4 rounded-full lit-purple text-sm font-semibold disabled:opacity-40"
              >
                {posting ? "Posting…" : "Post"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-3xl ios-glass-card overflow-hidden">
        {loading && <p className="p-8 text-center text-sm text-muted-foreground">Loading posts…</p>}
        {!loading && posts.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">No posts yet.</p>
        )}
        {posts.map((p, i) => (
          <article key={p.id} className={`flex gap-3 p-4 ${i ? "border-t border-white/5" : ""}`}>
            <div className="flex-1 min-w-0">
              <div className="text-sm">
                <span className="font-semibold">{display}</span>{" "}
                <span className="text-muted-foreground">
                  · {new Date(p.created_at).toLocaleString()}
                </span>
              </div>
              <p className="text-[15px] mt-0.5 whitespace-pre-wrap">{p.body}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function WalletHistoryTab({
  trades, loading, hidden,
}: { trades: ReturnType<typeof useMyTrades>["trades"]; loading: boolean; hidden: boolean }) {
  return (
    <div className={`rounded-3xl ios-glass-card overflow-hidden ${hidden ? "hidden" : ""}`}>
      <div className="px-4 py-3 font-semibold text-sm border-b border-white/5">Trade history</div>
      {loading && <p className="p-8 text-center text-sm text-muted-foreground">Loading…</p>}
      {!loading && trades.length === 0 && (
        <p className="p-8 text-center text-sm text-muted-foreground">No trades indexed for your wallet yet.</p>
      )}
      <ul>
        {trades.map((t) => {
          const buy = t.side === "BUY";
          const Icon = buy ? ArrowDownLeft : ArrowUpRight;
          return (
            <li key={t.tx_hash} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 last:border-0">
              <div className={`size-9 rounded-full ios-glass-soft grid place-items-center ${buy ? "text-up" : "text-down"}`}>
                <Icon className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <Link to="/token/$id" params={{ id: t.token_address }} className="text-sm font-medium hover:underline">
                  {buy ? "Bought" : "Sold"} token
                </Link>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(t.created_at_chain).toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-semibold ${buy ? "text-up" : "text-down"}`}>
                  {fmtUsd(Number(t.value_usd ?? 0))}
                </p>
                <a
                  href={`https://monadscan.xyz/tx/${t.tx_hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-primary hover:underline"
                >
                  tx ↗
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
        Loading holdings…
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
        <span className="text-xs text-muted-foreground">{holdings.length} · ${totalValue.toFixed(2)}</span>
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
                  {h.valueUsd != null ? `$${h.valueUsd.toFixed(2)}` : "—"}
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
            {copied ? "✓ Copied" : "· Tap to copy"}
          </button>
        ) : (
          <p className="text-sm text-muted-foreground mt-1">Sign in to see your wallet</p>
        )}
      </div>
      <div className="text-right">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Balance</p>
        <div className="inline-flex items-center gap-1.5">
          <MonLogo size={22} />
          <p className="text-2xl font-bold">{loading ? "…" : `${balance.toFixed(4)} MON`}</p>
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
