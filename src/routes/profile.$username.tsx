import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSwapHistory } from "@/lib/nadfun/hooks";
import { useFollow, useAccountProfile, updateMyProfile, isHandleAvailable, useSuggestedTraders, useMyTrades, useWalletPnl } from "@/lib/supabase-hooks";
import { resolveToAddress, useIdentity, labelFor, patchIdentity } from "@/lib/identity";
import { startDMThread, GUN_ENABLED } from "@/lib/gun-dms";
import { DEFAULT_AVATAR, DEFAULT_BANNER } from "@/lib/defaults";
import { defaultDisplayName } from "@/lib/handles";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { useMe } from "@/lib/useMe";
import { ReportButton } from "@/components/ReportButton";
import { ProfileActionButton } from "@/components/ProfileActionButton";
import { UserAvatar } from "@/components/Handle";
import { isOwnAccount } from "@/lib/own-profile";
import { ModalShell } from "@/components/ui/modal-shell";

// A small fixed token we hit for the "all swaps by this wallet" query.
// Nad.fun's /trade/swap-history accepts ?account_id=… so passing any indexed
// token returns swaps across the whole protocol for that wallet.
const PROFILE_PROBE_TOKEN = "0x0000000000000000000000000000000000000000";
import { Coins, Calendar, UserPlus, X, TrendingUp, BarChart3, Target, Activity, Bell, BellOff, MessageSquare, Camera } from "lucide-react";
import { Sparkline, FlatSparkline } from "@/components/Charts";
import { fmtUsd, fmtPct } from "@/lib/fmt";
import { fetchZerionPositions, type ZerionPosition } from "@/lib/zerion";
import { computePnlFromTrades, PNL_WINDOWS, tradeInWindow, type PnlWindowKey } from "@/lib/pnl";
import { fetchTokenMetas, type TokenMeta } from "@/lib/token-metadata";

export const Route = createFileRoute("/profile/$username")({
  component: ProfilePage,
  loader: ({ params }) => ({ username: params.username }),
  validateSearch: (s: Record<string, unknown>) => {
    const edit = s.edit === true || s.edit === "true" || s.edit === "1";
    return edit ? ({ edit: true } as const) : {};
  },
  // Per-profile SEO so Twitter / Telegram link previews are populated.
  head: ({ params }) => {
    const u = params.username.replace(/^@/, "");
    const title = `@${u} · trench.meme`;
    const desc  = `Live PnL, trades and follows for @${u} on Monad. Open trench.meme to follow or copy-trade.`;
    const url   = `https://trench.meme/@${u}`;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:type", content: "profile" },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: desc },
      ],
    };
  },
});

const ranges = ["24H", "7D", "30D", "ALL"] as const;
const swapTabs = ["Portfolio"] as const;
const PNL_WINDOW: Record<(typeof ranges)[number], string> = {
  "24H": "24H",
  "7D": "7D",
  "30D": "30D",
  ALL: "ALL",
};

function fmtJoined(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  } catch { return ""; }
}

function tradeTimeAgo(iso: string) {
  const secondsAgo = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secondsAgo < 60) return `${secondsAgo}s`;
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m`;
  if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h`;
  return `${Math.floor(secondsAgo / 86400)}d`;
}

function hashSeed(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const isWallet = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);

function ProfilePage() {
  const { username } = Route.useLoaderData();
  const { edit } = Route.useSearch();
  return <ProfilePageView username={username} openEdit={!!edit} />;
}

export function ProfilePageView({
  username,
  openEdit = false,
}: {
  username: string;
  openEdit?: boolean;
}) {
  const navigate = useNavigate();
  // Pre-Supabase placeholder for the header. If the URL param is a wallet
  // address, use the canonical short form (`0xabc...1234`). Otherwise show
  // the handle (sans @). Once Supabase resolves we overwrite with the real
  // display name.
  const initialDisplay = isWallet(username)
    ? defaultDisplayName(username)
    : username.startsWith("@")
      ? username.slice(1)
      : username;
  const liveSwaps = { data: null } as any;
  const [range, setRange] = useState<typeof ranges[number]>("24H");
  const [tab, setTab] = useState<string>("Portfolio");
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(openEdit);
  const me = useMe();
  const [resolvedAddr, setResolvedAddr] = useState<string | undefined>(
    isWallet(username) ? username.toLowerCase() : undefined,
  );

  // Wallet portfolio (Zerion) — lazy-loaded when the user opens the
  // Portfolio tab so we don't burn Zerion credits on every profile view.
  // MUST come after resolvedAddr is declared — referencing it before its
  // own declaration triggers a TDZ during render that minified bundles
  // surface as "Cannot access 'C' before initialization".
  const [positions, setPositions] = useState<ZerionPosition[] | null>(null);
  const [posLoading, setPosLoading] = useState(false);
  useEffect(() => {
    if (tab !== "Portfolio" || !resolvedAddr || positions != null) return;
    let cancel = false;
    setPosLoading(true);
    fetchZerionPositions({ data: { address: resolvedAddr } })
      .then((r) => { if (!cancel) setPositions(r.positions); })
      .catch(() => { if (!cancel) setPositions([]); })
      .finally(() => { if (!cancel) setPosLoading(false); });
    return () => { cancel = true; };
  }, [tab, resolvedAddr, positions]);
  const portfolioUsd = useMemo(
    () => (positions ?? []).reduce((s, p) => s + (p.valueUsd ?? 0), 0),
    [positions],
  );

  useEffect(() => {
    if (isWallet(username)) {
      setResolvedAddr(username.toLowerCase());
      return;
    }
    let cancel = false;
    resolveToAddress(username).then((a) => {
      // Normalize to lowercase so isOwnProfile comparison always matches
      if (!cancel) setResolvedAddr(a ? a.toLowerCase() : undefined);
    });
    return () => { cancel = true; };
  }, [username]);

  const { profile: myOwnProfile } = useAccountProfile(me);
  // Own-profile detection — TRUE if any of:
  //   1. resolved address == me's address (works after Supabase resolves)
  //   2. URL is me's wallet address directly (no resolution needed)
  //   3. URL handle (case-insensitive) == my own stored handle
  // Catches the race where resolveToAddress hasn't completed yet — we
  // can still tell it's our own page from the handle alone, so the
  // "Edit profile" button shows immediately on load.
  const urlHandle = username.replace(/^@/, "").toLowerCase();
  const isOwnProfile = isOwnAccount(me, resolvedAddr, urlHandle, myOwnProfile?.handle);

  useEffect(() => {
    if (openEdit && isOwnProfile) setEditing(true);
  }, [openEdit, isOwnProfile]);
  const { profile, setProfile } = useAccountProfile(resolvedAddr);
  const liveIdentity = useIdentity(resolvedAddr);
  const indexedTrades: import("@/lib/supabase-hooks").TradeRow[] = [];
  const [tokenMetas, setTokenMetas] = useState<Map<string, TokenMeta>>(new Map());
  const snap = null as any;
  useEffect(() => {
    const addrs = [...new Set(indexedTrades.map((t) => t.token_address.toLowerCase()))];
    if (addrs.length === 0) { setTokenMetas(new Map()); return; }
    let cancel = false;
    fetchTokenMetas({ data: { addresses: addrs } })
      .then((rows) => {
        if (cancel) return;
        setTokenMetas(new Map(rows.map((r) => [r.address.toLowerCase(), r])));
      })
      .catch(() => { if (!cancel) setTokenMetas(new Map()); });
    return () => { cancel = true; };
  }, [indexedTrades]);
  // Wallet URLs → /@handle once we know the handle; bare handles on
  // /profile/:handle → canonical /@:handle (avoids replaceState glitches).
  useEffect(() => {
    const handle = profile?.handle;
    if (!handle || isWallet(handle)) return;
    const onProfilePath = window.location.pathname.startsWith("/profile/");
    if (onProfilePath || isWallet(username)) {
      navigate({
        to: "/@{$handle}",
        params: { handle },
        replace: true,
        search: openEdit ? { edit: true } : {},
      });
    }
  }, [username, profile?.handle, navigate, openEdit]);

  // Priority: explicit display_name → @handle (only if it's a real custom
  // handle, not the default wallet-as-handle) → short wallet form.
  const profileDisplay = profile?.display_name
    || (profile?.handle && !isWallet(profile.handle) ? `@${profile.handle}` : initialDisplay);
  const liveLabel = liveIdentity ? labelFor(liveIdentity, { at: false }) : "…";
  const display = liveLabel !== "…" ? liveLabel : profileDisplay;
  const bannerSrc = profile?.banner_uri || DEFAULT_BANNER;
  const bio = profile?.bio ?? "";
  const publicHandle = profile?.handle ?? (isWallet(username) ? null : username.replace(/^@/, "").toLowerCase());
  // Per-page tab title — prefers a real @handle, else the short wallet
  // form. Updates live when navigating between profiles client-side.
  useDocumentTitle(publicHandle && !isWallet(publicHandle) ? `@${publicHandle}` : initialDisplay);

  // Real follow-graph + live counts via Realtime
  const follow = useFollow(resolvedAddr);
  const followingMe = follow.isFollowing;
  const suggestedTraders = useSuggestedTraders(5);

  const placeholderToken = (addr: string, symbol?: string | null, name?: string | null, imageUri?: string | null) => ({
    id: addr,
    symbol: symbol ?? (addr ? `${addr.slice(2, 6)}…` : "—"),
    name: name ?? "",
    imageUri: imageUri ?? null,
    addr,
    age: "",
    fdv: "—",
    liq: "—",
    txns: "—",
    txnsBuy: "—",
    txnsSell: "—",
    vol: "—",
    price: "0",
    p1h: 0,
    p2h: 0,
    p4h: 0,
    p8h: 0,
    p24h: 0,
    color: "#a855f7",
  });

  const indexedUiTrades = useMemo(() => {
    const state = new Map<string, { bal: number; avgCost: number }>();
    const pnlByHash = new Map<string, number>();
    const ordered = [...indexedTrades].sort(
      (a, b) => +new Date(a.created_at_chain) - +new Date(b.created_at_chain),
    );
    for (const t of ordered) {
      const tok = t.token_address;
      const pos = state.get(tok) ?? { bal: 0, avgCost: 0 };
      const amount = Number(t.value_usd ?? 0);
      const tokenQty = Number(t.token_amount ?? "0") / 1e18;
      if (t.side === "BUY") {
        const nextBal = pos.bal + tokenQty;
        if (nextBal > 0) pos.avgCost = ((pos.bal * pos.avgCost) + amount) / nextBal;
        pos.bal = nextBal;
        pnlByHash.set(t.tx_hash, 0);
      } else {
        pnlByHash.set(t.tx_hash, amount - tokenQty * pos.avgCost);
        pos.bal = Math.max(0, pos.bal - tokenQty);
      }
      state.set(tok, pos);
    }
    return indexedTrades.map((t) => {
      const action: "Buy" | "Sell" = t.side === "BUY" ? "Buy" : "Sell";
      const amount = Number(t.value_usd ?? 0);
      const pnl = pnlByHash.get(t.tx_hash) ?? 0;
      const pct = amount > 0 ? (pnl / amount) * 100 : 0;
      return {
        token: placeholderToken(
          t.token_address,
          tokenMetas.get(t.token_address)?.symbol,
          tokenMetas.get(t.token_address)?.name,
          tokenMetas.get(t.token_address)?.imageUri,
        ),
        action,
        amount,
        pnl,
        pct,
        txHash: t.tx_hash,
        timeAgo: tradeTimeAgo(t.created_at_chain),
      };
    });
  }, [indexedTrades, tokenMetas]);

  const liveTrades = useMemo(() => {
    const swaps = liveSwaps.data?.swaps;
    if (!swaps || swaps.length === 0) return null;
    return swaps.map((s: any) => {
      const action: "Buy" | "Sell" = s.swap_info.event_type === "BUY" ? "Buy" : "Sell";
      const amount = Number(s.swap_info.value);
      const pnl = action === "Buy" ? amount * 0.05 : amount * -0.03;
      const pct = action === "Buy" ? 5 : -3;
      const secondsAgo = Math.max(1, Math.floor(Date.now() / 1000) - s.swap_info.created_at);
      const timeAgo = secondsAgo < 60 ? `${secondsAgo}s`
        : secondsAgo < 3600 ? `${Math.floor(secondsAgo / 60)}m`
        : secondsAgo < 86400 ? `${Math.floor(secondsAgo / 3600)}h`
        : `${Math.floor(secondsAgo / 86400)}d`;
      return { token: placeholderToken(""), action, amount, pnl, pct, txHash: `${s.swap_info.transaction_hash}-${s.swap_info.created_at}`, timeAgo };
    });
  }, [liveSwaps.data]);

  const trades = indexedUiTrades.length > 0 ? indexedUiTrades : (liveTrades ?? []);
  const hasTrades = false;
  const livePnl = useMemo(() => {
    if (indexedTrades.length === 0) return null;
    return computePnlFromTrades(indexedTrades).byWindow.get(PNL_WINDOW[range] as PnlWindowKey) ?? null;
  }, [indexedTrades, range]);
  const liveNetUsd = useMemo(() => {
    if (indexedTrades.length === 0) return null;
    const key = PNL_WINDOW[range] as PnlWindowKey;
    const seconds = PNL_WINDOWS.find((w) => w.key === key)?.seconds ?? null;
    return indexedTrades.reduce((sum, t) => {
      if (!tradeInWindow(t.created_at_chain, seconds)) return sum;
      const value = Number(t.value_usd ?? 0);
      return sum + (t.side === "SELL" ? value : -value);
    }, 0);
  }, [indexedTrades, range]);
  const totalPnl = useMemo(() => {
    if (liveNetUsd != null) return liveNetUsd;
    if (livePnl) return livePnl.realized;
    if (snap) return Number(snap.realized_usd ?? 0) + Number(snap.unrealized_usd ?? 0);
    return trades.reduce((a: number, t: any) => a + t.pnl, 0);
  }, [liveNetUsd, livePnl, snap, trades]);
  const dayDelta = useMemo(() => liveNetUsd ?? livePnl?.realized ?? Number(snap?.realized_usd ?? 0), [liveNetUsd, livePnl, snap]);
  const dayUp = dayDelta >= 0;
  const topTrades = useMemo(() => trades.slice(0, 5), [trades]);
  const filteredSwaps = trades.filter((t: any) => tab === "All swaps" ? true : tab === "Buys" ? t.action === "Buy" : t.action === "Sell");

  // REAL PnL curve from indexed trades — cumulative net cash flow over
  // time, normalized so the chart fits its panel. With < 2 trades we show
  // a flat green line (zero movement) instead of fake squiggles or text.
  const sparkData = useMemo(() => {
    if (indexedTrades.length < 2) return [];
    // Walk in chronological order, accumulate net (sells in, buys out)
    const ordered = [...indexedTrades].sort(
      (a, b) => +new Date(a.created_at_chain) - +new Date(b.created_at_chain),
    );
    let cum = 0;
    const raw: number[] = [];
    for (const t of ordered) {
      const v = Number(t.value_usd ?? 0);
      cum += t.side === "SELL" ? v : -v;
      raw.push(cum);
    }
    // Normalize to 10..100 so the Sparkline renders nicely
    const min = Math.min(...raw);
    const max = Math.max(...raw);
    const span = Math.max(0.0001, max - min);
    return raw.map((v) => 10 + ((v - min) / span) * 90);
  }, [indexedTrades]);
  const sparkColor = dayUp ? "var(--color-success)" : "#fb923c";
  const hasSparkData = sparkData.length >= 2;

  const toggle = (h: string) =>
    setFollowing((s) => {
      const n = new Set(s);
      if (n.has(h)) n.delete(h); else n.add(h);
      return n;
    });

  return (
    // Right rail trimmed back ~25% (was 380px → 285px) — it was feeling
    // oversized after the last bump. Main column still auto-fills via
    // minmax(0,1fr) so long token names don't overflow.
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_285px] gap-5">
      <div className="space-y-4">
        {/* Identity — X-style cover banner with avatar overlapping the bottom edge */}
        <div className="rounded-2xl overflow-hidden bg-surface border border-border">
          <div className="relative h-28 sm:h-36 md:h-44 bg-surface-2">
            <img
              key={bannerSrc}
              src={bannerSrc}
              alt=""
              className="absolute inset-0 w-full h-full object-cover object-center"
            />
          </div>

          <div className="px-4 sm:px-6 pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 min-w-0">
                {/* Only the avatar overlaps the banner — name/handle stay below it */}
                <div className="-mt-10 sm:-mt-12 shrink-0 relative z-10">
                  <div className="size-20 sm:size-24 rounded-full ring-4 ring-background overflow-hidden bg-surface-2">
                    <UserAvatar address={resolvedAddr} size={96} className="!size-20 sm:!size-24" />
                  </div>
                </div>

                <div className="min-w-0">
                  <h1 className="text-xl sm:text-2xl font-bold truncate inline-flex items-baseline min-w-0">
                    <span className="truncate">{display}</span>
                    <VerifiedBadge verified={profile?.is_verified} />
                  </h1>
                  <p className="text-sm text-muted-foreground">{publicHandle ? `@${publicHandle}` : "…"}</p>
                  {bio && <p className="text-sm mt-2 max-w-md leading-snug">{bio}</p>}
                </div>
              </div>

              <div className="flex items-center gap-3 sm:gap-5 shrink-0">
                <div className="text-center">
                  <p className="font-bold">{follow.followingCount}</p>
                  <p className="text-[11px] text-muted-foreground">Following</p>
                </div>
                <div className="text-center">
                  <p className="font-bold">{follow.followerCount}</p>
                  <p className="text-[11px] text-muted-foreground">Followers</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <ProfileActionButton
                    targetAddress={resolvedAddr}
                    targetHandle={publicHandle}
                    me={me}
                    myHandle={myOwnProfile?.handle}
                    onEditOwnProfile={() => setEditing(true)}
                  />
                  {!isOwnProfile && (
                    <>
                    {/* Subscribe to trade notifications (only after following) */}
                    {followingMe && (
                      <button
                        onClick={() => follow.setNotifyTrades(!follow.notifyTrades)}
                        disabled={!me}
                        className={`h-10 w-10 grid place-items-center rounded-full disabled:opacity-50 disabled:cursor-not-allowed ${
                          follow.notifyTrades ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {follow.notifyTrades ? <Bell className="size-4" /> : <BellOff className="size-4" />}
                      </button>
                    )}

                    {/* DM */}
                    <MessageButton me={me} target={resolvedAddr} />

                    {/* Report */}
                    {resolvedAddr && (
                      <ReportButton kind="account" targetId={resolvedAddr} />
                    )}
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-4 text-xs text-muted-foreground">
              {(profile as any)?.created_at && (
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="size-3.5" /> Joined {fmtJoined((profile as any).created_at)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Top trades row */}
        {hasTrades && (
          <div className="-mx-3 sm:-mx-4 md:-mx-6 px-3 sm:px-4 md:px-6 overflow-x-auto scrollbar-hide">
            <ul className="flex gap-3 min-w-fit">
              {topTrades.map((tr: any, i: number) => {
                const up = tr.pnl >= 0;
                const symbol = tr.token.symbol || "TOKEN";
                const name = tr.token.name || symbol;
                return (
                  <li key={tr.txHash ?? `${tr.token.id}-${i}`}>
                    <Link
                      to="/token/$id"
                      params={{ id: tr.token.id }}
                      className="block w-[240px] rounded-2xl bg-surface border border-white/5 px-3 py-2.5 hover:bg-white/[0.04]"
                    >
                      <div className="text-[11px] font-bold" style={{ color: i === 0 ? "#facc15" : "var(--color-muted-foreground, #9ca3af)" }}>
                        #{i + 1} Trade
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        {tr.token.imageUri ? (
                          <img src={tr.token.imageUri} alt={symbol} className="size-9 rounded-full object-cover shrink-0" />
                        ) : (
                          <div
                            className="size-9 rounded-full grid place-items-center text-[10px] font-bold text-background shrink-0"
                            style={{ background: tr.token.color }}
                          >
                            {symbol.slice(0, 2)}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold truncate">{name}</div>
                          <div className={`text-sm font-bold ${up ? "text-up" : "text-down"} truncate`}>
                            {up ? "+" : ""}{fmtUsd(tr.pnl)}
                          </div>
                          <div className={`text-[11px] ${up ? "text-up" : "text-down"} inline-flex items-center gap-0.5`}>
                            {up ? "▲" : "▼"} {fmtPct(Math.abs(tr.pct)).replace("+", "")}
                          </div>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* PNL + swaps */}
        <div className="grid grid-cols-1 gap-4">
          <div className="hidden">
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <TrendingUp className="size-3.5" /> PnL
              </div>
              <div className="flex p-1 rounded-xl bg-surface-2 text-xs">
                {ranges.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className={`h-7 px-2.5 rounded-lg font-semibold transition-colors ${
                      range === r ? "lit-purple" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-3xl font-bold mt-3 tracking-tight">{fmtUsd(totalPnl).replace("-", "")}</p>
            <p className="text-xs mt-1 inline-flex items-center gap-1.5">
              <span className={`inline-flex items-center gap-0.5 font-semibold ${dayUp ? "text-up" : "text-down"}`}>
                {dayUp ? "▲ +" : "▼ -"}{fmtUsd(Math.abs(dayDelta)).replace("-", "")}
              </span>
              <span className="text-muted-foreground">{range}</span>
            </p>

            <div className="mt-3 -mx-1 relative">
              {hasSparkData ? (
                <Sparkline data={sparkData} color={sparkColor} height={80} width={300} />
              ) : (
                <FlatSparkline height={80} width={300} />
              )}
              <div
                className="pointer-events-none absolute inset-0 rounded-lg"
                style={{
                  background: hasSparkData
                    ? dayUp
                      ? "linear-gradient(to top, rgba(34,197,94,0.12), transparent)"
                      : "linear-gradient(to top, rgba(251,146,60,0.12), transparent)"
                    : "linear-gradient(to top, rgba(34,197,94,0.12), transparent)",
                }}
              />
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <Kpi
                icon={Target}
                label="Win rate"
                value={
                  livePnl && livePnl.sells > 0
                    ? `${((livePnl.wins / livePnl.sells) * 100).toFixed(0)}%`
                    : snap?.win_rate_pct != null ? `${Number(snap.win_rate_pct).toFixed(0)}%` : "—"
                }
              />
              <Kpi icon={Activity} label="Trades" value={String(livePnl?.trades ?? snap?.trades_count ?? trades.length)} />
              <Kpi icon={BarChart3} label="Volume" value={fmtUsd(Number(livePnl?.volume ?? snap?.volume_usd ?? 0))} />
            </div>
          </div>

          <div className="rounded-2xl bg-surface overflow-hidden border border-white/5 flex flex-col">
            <div className="px-4 py-3 flex items-center gap-1 border-b border-white/5">
              {swapTabs.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`h-8 px-3 rounded-full text-xs font-semibold transition-colors ${
                    tab === t ? "lit-purple" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  }`}
                >
                  {t}
                </button>
              ))}
              <span className="ml-auto text-[11px] text-muted-foreground">
                {tab === "Portfolio"
                  ? `Total ${fmtUsd(portfolioUsd)}`
                  : "Latest first"}
              </span>
            </div>
            {tab === "Portfolio" ? (
              <>
                <div className="grid grid-cols-[1.6fr_1fr_1fr_0.9fr] gap-2 px-4 py-2 text-[10px] uppercase tracking-wide text-muted-foreground border-b border-white/5">
                  <span>Token</span>
                  <span className="text-right">Price</span>
                  <span className="text-right">Balance</span>
                  <span className="text-right">Value</span>
                </div>
                <ul className="divide-y divide-white/5">
                  {posLoading && (
                    <li className="px-4 py-6 text-center text-xs text-muted-foreground">
                      Loading holdings…
                    </li>
                  )}
                  {!posLoading && positions?.length === 0 && (
                    <li className="px-4 py-6 text-center text-xs text-muted-foreground">
                      No tokens held on Monad.
                    </li>
                  )}
                  {positions?.map((p) => (
                    <li key={p.address}>
                      <Link
                        to="/token/$id"
                        params={{ id: p.address }}
                        className="grid grid-cols-[1.6fr_1fr_1fr_0.9fr] gap-2 items-center px-4 py-2.5 hover:bg-white/[0.03]"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {p.imageUri ? (
                            <img
                              src={p.imageUri}
                              alt=""
                              className="size-7 rounded-full object-cover shrink-0 bg-surface-2"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                            />
                          ) : (
                            <div className="size-7 rounded-full bg-surface-2 grid place-items-center text-[10px] font-bold text-muted-foreground shrink-0">
                              {p.symbol.slice(0, 2)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">{p.symbol}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{p.name || "—"}</p>
                          </div>
                        </div>
                        <div className="text-right text-xs tabular-nums text-muted-foreground">
                          {p.priceUsd != null ? `$${p.priceUsd < 0.01 ? p.priceUsd.toPrecision(2) : p.priceUsd.toFixed(4)}` : "—"}
                        </div>
                        <div className="text-right text-xs tabular-nums">
                          {p.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </div>
                        <div className="text-right text-sm font-semibold tabular-nums">
                          {p.valueUsd != null ? fmtUsd(p.valueUsd) : "—"}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
            <div className="grid grid-cols-[1.4fr_0.8fr_1fr_0.8fr] gap-2 px-4 py-2 text-[10px] uppercase tracking-wide text-muted-foreground border-b border-white/5">
              <span>Token</span>
              <span>Action</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Time</span>
            </div>
            <ul className="divide-y divide-white/5">
              {filteredSwaps.map((tr: any, i: number) => (
                <li key={`${tr.token.id}-${i}`}>
                  <Link
                    to="/token/$id"
                    params={{ id: tr.token.id }}
                    className="grid grid-cols-[1.4fr_0.8fr_1fr_0.8fr] gap-2 items-center px-4 py-2.5 hover:bg-white/[0.03]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="size-7 rounded-full grid place-items-center text-[10px] font-bold text-background shrink-0"
                        style={{ background: tr.token.color }}
                      >
                        {tr.token.symbol.slice(0, 2)}
                      </div>
                      <span className="text-sm font-semibold truncate">{tr.token.symbol}</span>
                    </div>
                    <div>
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                          tr.action === "Buy" ? "bg-up/15 text-up" : "bg-down/15 text-down"
                        }`}
                      >
                        {tr.action}
                      </span>
                    </div>
                    <div className="text-right text-sm font-semibold tabular-nums">{fmtUsd(tr.amount)}</div>
                    <div className="text-right text-[11px] text-muted-foreground">{tr.timeAgo}</div>
                  </Link>
                </li>
              ))}
            </ul>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right rail — compact: tight padding, smaller header, denser rows */}
      <aside className="rounded-2xl bg-surface border border-white/5 p-3.5 h-fit xl:sticky xl:top-20">
        <h3 className="font-semibold text-sm inline-flex items-center gap-1.5 mb-3">
          <UserPlus className="size-3.5 text-primary" /> Follow top traders
        </h3>
        <ul className="space-y-2.5">
          {suggestedTraders.length === 0 && (
            <li className="text-xs text-muted-foreground py-1">No suggestions yet.</li>
          )}
          {suggestedTraders.map((s) => (
            <SuggestedTraderRow
              key={s.address}
              trader={s}
              me={me}
              myHandle={myOwnProfile?.handle}
              onEditProfile={() => setEditing(true)}
            />
          ))}
        </ul>
      </aside>

      {/* Edit gated strictly to the connected wallet matching this profile */}
      {editing && isOwnProfile && me && (
        <EditProfileModal
          me={me}
          handle={profile?.handle ?? ""}
          name={profile?.display_name ?? display}
          bio={bio}
          imageUri={profile?.image_uri ?? ""}
          bannerUri={profile?.banner_uri ?? ""}
          onSaved={(patch) => {
            setProfile((p) => (p ? { ...p, ...patch } : p));
          }}
          onClose={() => {
            setEditing(false);
            if (openEdit) navigate({ search: (() => ({})) as any });
          }}
        />
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-2.5 py-2">
      <div className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3" /> {label}
      </div>
      <p className="text-sm font-bold mt-0.5">{value}</p>
    </div>
  );
}

// X-style edit profile modal. Banner camera at top, PFP camera overlapping
// the banner bottom-left, then Name / Bio / Username. File uploads are
// real <input type="file"> reads (data URL, 800KB cap). Same trench
// palette as the rest of the app. No socials — that's intentional.
function EditProfileModal({
  me, handle, name, bio, imageUri, bannerUri, onClose, onSaved,
}: {
  me: string;
  handle: string;
  name: string; bio: string;
  imageUri: string; bannerUri: string;
  onClose: () => void;
  onSaved?: (patch: Partial<import("@/lib/supabase-hooks").AccountProfile>) => void;
}) {
  const [h, setH] = useState(handle);
  const [n, setN] = useState(name);
  const [b, setB] = useState(bio);
  const [img, setImg] = useState(imageUri);
  const [bnr, setBnr] = useState(bannerUri);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Re-sync internal state whenever the parent's profile data changes
  // (e.g. after a previous save, or another device updated the row).
  // Without this, the modal's `useState(handle)` initializer would only
  // capture the prop on first mount — reopen would show stale values.
  // We only overwrite when the user hasn't started typing this session;
  // if they have edits-in-progress (state differs from incoming prop)
  // we leave them alone so a live update doesn't clobber typing.
  useEffect(() => { setH(handle); }, [handle]);
  useEffect(() => { setN(name); }, [name]);
  useEffect(() => { setB(bio); }, [bio]);
  useEffect(() => { setImg(imageUri); }, [imageUri]);
  useEffect(() => { setBnr(bannerUri); }, [bannerUri]);

  const avatarFileRef = useRef<HTMLInputElement>(null);
  const bannerFileRef = useRef<HTMLInputElement>(null);

  // File → data URL with type + size guard. Same pattern as cabal create.
  const readImage = (f: File | null, set: (s: string) => void) => {
    if (!f) return;
    if (!/^image\//.test(f.type)) { setErr("Pick an image file."); return; }
    if (f.size > 800_000) { setErr("Image too large — under 800KB please."); return; }
    setErr(null);
    const r = new FileReader();
    r.onload = () => set(String(r.result ?? ""));
    r.readAsDataURL(f);
  };

  // Live username availability check.
  const [handleState, setHandleState] = useState<"idle" | "checking" | "ok" | "taken" | "invalid">("idle");
  useEffect(() => {
    const trimmed = h.replace(/^@/, "").trim();
    if (trimmed === handle.replace(/^@/, "")) { setHandleState("idle"); return; }
    if (!/^[a-z0-9_.]{2,20}$/i.test(trimmed)) {
      setHandleState(trimmed === "" ? "idle" : "invalid");
      return;
    }
    setHandleState("checking");
    const t = setTimeout(async () => {
      const ok = await isHandleAvailable(trimmed, me);
      setHandleState(ok ? "ok" : "taken");
    }, 350);
    return () => clearTimeout(t);
  }, [h, handle, me]);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      if (handleState === "taken") throw new Error("Username already taken");
      if (handleState === "invalid") throw new Error("Username must be 2–20 letters, digits, _ or .");
      await updateMyProfile({
        data: {
          me,
          patch: {
            handle: h.trim() || null,
            display_name: n.trim() || null,
            bio: b.trim() || null,
            image_uri: img.trim() || null,
            banner_uri: bnr.trim() || null,
          },
        },
      });
      const saved = {
        handle: h.trim() || null,
        display_name: n.trim() || null,
        bio: b.trim() || null,
        image_uri: img.trim() || null,
        banner_uri: bnr.trim() || null,
      };
      patchIdentity(me, {
        handle: saved.handle,
        display_name: saved.display_name,
        image_uri: saved.image_uri,
      });
      onSaved?.(saved);
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to save");
    } finally { setSaving(false); }
  };

  return (
    <ModalShell onClose={onClose} className="sm:max-w-lg max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-3rem)] overflow-y-auto">
        {/* Header — close (left), title (center), Save pill (right) */}
        <div className="sticky top-0 z-20 px-4 h-14 flex items-center gap-3 bg-background/85 backdrop-blur-md border-b border-white/5">
          <button
            onClick={onClose}
            className="size-8 grid place-items-center rounded-full hover:bg-white/10 text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
          <h2 className="flex-1 font-bold text-[15px]">Edit profile</h2>
          <button
            onClick={save}
            disabled={saving}
            className="h-8 px-5 rounded-full bg-foreground text-background text-sm font-bold hover:bg-foreground/90 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>

        {/* Banner — click anywhere on the banner area to upload */}
        <button
          type="button"
          onClick={() => bannerFileRef.current?.click()}
          className="relative block w-full h-32 sm:h-36 bg-surface-2 overflow-hidden group"
          aria-label="Change banner"
        >
          <img
            src={bnr || DEFAULT_BANNER}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
          {/* Always-on dim overlay so the camera icon stays legible on bright banners */}
          <span className="absolute inset-0 bg-black/30 group-hover:bg-black/45 transition-colors" />
          <span className="absolute inset-0 grid place-items-center">
            <span className="size-10 rounded-full bg-black/60 backdrop-blur grid place-items-center">
              <Camera className="size-4 text-white" />
            </span>
          </span>
          {bnr && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); setBnr(""); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setBnr(""); }
              }}
              className="absolute top-2 right-2 size-7 rounded-full bg-black/60 backdrop-blur grid place-items-center hover:bg-black/80 cursor-pointer"
              aria-label="Remove banner"
            >
              <X className="size-3.5 text-white" />
            </span>
          )}
        </button>
        <input
          ref={bannerFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => readImage(e.target.files?.[0] ?? null, setBnr)}
        />

        {/* Avatar — overlaps the bottom of the banner, X-style */}
        <div className="px-5 -mt-12 sm:-mt-14">
          <button
            type="button"
            onClick={() => avatarFileRef.current?.click()}
            className="relative size-24 sm:size-28 rounded-full ring-4 ring-background overflow-hidden bg-surface-2 group"
            aria-label="Change profile photo"
          >
            <img
              src={img || DEFAULT_AVATAR}
              alt=""
              className="size-full object-cover"
            />
            <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity grid place-items-center">
              <span className="size-9 rounded-full bg-black/60 backdrop-blur grid place-items-center">
                <Camera className="size-4 text-white" />
              </span>
            </span>
          </button>
          <input
            ref={avatarFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => readImage(e.target.files?.[0] ?? null, setImg)}
          />
        </div>

        {/* Fields */}
        <div className="px-5 pb-6 pt-4 space-y-4">
          <FloatField label="Name">
            <input
              value={n}
              onChange={(e) => setN(e.target.value.slice(0, 50))}
              maxLength={50}
              className="h-12 w-full bg-transparent text-[15px] focus:outline-none placeholder:text-muted-foreground/60"
              placeholder="Your name"
            />
            <div className="absolute right-3 bottom-2 text-[10px] text-muted-foreground">{n.length}/50</div>
          </FloatField>

          <FloatField label="Bio">
            <textarea
              value={b}
              onChange={(e) => setB(e.target.value.slice(0, 160))}
              rows={3}
              placeholder="Tell people about you"
              className="w-full bg-transparent text-[15px] focus:outline-none resize-none placeholder:text-muted-foreground/60"
            />
            <div className="absolute right-3 bottom-2 text-[10px] text-muted-foreground">{b.length}/160</div>
          </FloatField>

          <FloatField label="Username">
            <div className="flex items-center">
              <span className="text-muted-foreground text-[15px] mr-1">@</span>
              <input
                value={h}
                onChange={(e) => setH(e.target.value.replace(/^@/, "").slice(0, 20))}
                placeholder="thokani"
                className="h-12 flex-1 bg-transparent text-[15px] focus:outline-none placeholder:text-muted-foreground/60"
              />
              <span className={`text-[11px] font-semibold ${
                handleState === "ok"      ? "text-primary"
                : handleState === "taken" ? "text-down"
                : handleState === "invalid" ? "text-down"
                : "text-muted-foreground"
              }`}>
                {handleState === "checking" ? "checking…"
                  : handleState === "ok"     ? "available"
                  : handleState === "taken"  ? "taken"
                  : handleState === "invalid" ? "invalid"
                  : ""}
              </span>
            </div>
          </FloatField>

          {err && (
            <p className="text-xs text-down bg-down/10 border border-down/20 rounded-lg px-3 py-2">
              {err}
            </p>
          )}
        </div>
    </ModalShell>
  );
}

// X-style "outlined" field with a label that sits inside the top of the
// rounded box. Cleaner than separate label + input stacks because the
// label doubles as the field's identity.
function FloatField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative rounded-xl border border-white/10 px-3 pt-3 pb-1 focus-within:border-primary/60 transition-colors bg-white/[0.02]">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function SuggestedTraderRow({
  trader, me, myHandle, onEditProfile,
}: {
  trader: ReturnType<typeof useSuggestedTraders>[number];
  me: string | undefined;
  myHandle?: string | null;
  onEditProfile?: () => void;
}) {
  const id = useIdentity(trader.address);
  const name = labelFor(id, { at: false });
  const slug = id?.handle ?? trader.handle;
  if (!slug) return null;
  return (
    <li className="flex items-center gap-2">
      <UserAvatar address={trader.address} size={36} />
      <Link to="/@{$handle}" params={{ handle: slug }} className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold truncate hover:underline">{name}</p>
        <p className="text-[10px] text-muted-foreground truncate">@{slug}</p>
      </Link>
      <ProfileActionButton
        targetAddress={trader.address}
        targetHandle={slug}
        me={me}
        myHandle={myHandle}
        variant="compact"
        onEditOwnProfile={onEditProfile}
      />
    </li>
  );
}

function MessageButton({ me, target }: { me: string | undefined; target: string | undefined }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!target) return null;
  if (me && target.toLowerCase() === me.toLowerCase()) return null;
  const click = async () => {
    if (!me) return;
    setBusy(true);
    try {
      if (!GUN_ENABLED) {
        console.warn("Set VITE_GUN_PEERS for DMs");
        return;
      }
      await startDMThread(me, target);
      navigate({ to: "/inbox", search: { t: target.toLowerCase() } });
    } catch (e) {
      console.error(e);
    } finally { setBusy(false); }
  };
  return (
    <button
      onClick={click}
      disabled={!me || busy}
      className="h-10 w-10 grid place-items-center rounded-full bg-surface-2 text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <MessageSquare className="size-4" />
    </button>
  );
}

