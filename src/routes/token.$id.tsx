import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { CandleChart } from "@/components/Charts";
import { MonLogo } from "@/components/MonLogo";
import { TradingViewAdvancedChart } from "@/components/TradingViewAdvancedChart";
import { GeckoTerminalChart } from "@/components/GeckoTerminalChart";
import { fmtPct } from "@/lib/fmt";
import { WalletLabel, HandleLink, UserAvatar } from "@/components/Handle";
import { Copy, Settings, ChevronDown, Image as ImageIcon } from "lucide-react";
import { renderMentions } from "@/lib/renderMentions";
import { useEffect, useRef, useState } from "react";
import {
  fetchTokenSnapshot,
  useTokenSnapshot,
  useTokenPriceChanges,
  useTokenTrades,
  useTokenHolders,
  useTokenChat,
  sendTokenChatMessage,
  liquidityUsd,
  type TokenSnapshot,
} from "@/lib/token-index";
import { useUnifiedQuote } from "@/lib/swap-router";
import { useSwapExecute, createLimitOrder } from "@/lib/swap-execute";
import { useMe } from "@/lib/useMe";
import { useMonBalance, useTokenBalance } from "@/lib/wallet-tx";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useBlocklist } from "@/lib/blocklist";
import { BlocklistWarning } from "@/components/BlocklistWarning";
import { useGunChat, gunSend, GUN_ENABLED } from "@/lib/gun";
import { SUPABASE_ENABLED } from "@/lib/supabase-hooks";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTradePrefs } from "@/lib/trade-prefs";
import { MONAD_EXPLORER_NAME, txUrl } from "@/lib/explorer";
// Route id must be a Monad contract address. Live data via Nad.fun + DexScreener fallback.
const isContract = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);

export const Route = createFileRoute("/token/$id")({
  component: TokenPage,
  // ?tab=Chat (or any other bottomTab) lets cashtags + DM links deep-link
  // straight to a specific tab. Default tab is Trades.
  // Tab is fully optional. Returning a partial object (vs. `{ tab: undefined }`)
  // means TanStack treats the search prop on <Link to="/token/$id"> as
  // optional too — callers don't have to pass `search={{}}` boilerplate.
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s.tab === "string" ? { tab: s.tab } : {},
  loader: async ({ params }) => {
    if (!isContract(params.id)) throw notFound();
    let snapshot: TokenSnapshot | null = null;
    try {
      snapshot = await fetchTokenSnapshot({ data: { token: params.id } });
    } catch {}
    return {
      id: params.id,
      addr: params.id,
      snapshot,
      color: "#a855f7",
    };
  },
  notFoundComponent: () => <div className="p-8">Token not found.</div>,
  errorComponent: ({ error }) => <div className="p-8 text-down">{error.message}</div>,
});

const bottomTabs = ["Trades", "Holders", "Chat"];

function TokenPage() {
  const t = Route.useLoaderData();
  const search = Route.useSearch();
  const me = useMe();
  const { prefs, slippagePct, quickAmounts } = useTradePrefs(me);
  const slippageBps = prefs.pref_slippage_bps;
  const blocklist = useBlocklist(me);
  const { snapshot, loading: snapLoading } = useTokenSnapshot(t.addr, t.snapshot);
  const creatorOnChain = snapshot?.creator_address ?? null;
  const [activeTab, setActiveTab] = useState(
    search.tab && bottomTabs.includes(search.tab) ? search.tab : "Trades",
  );
  // Sync when URL search changes (e.g. user clicks $TICKER → /token/X?tab=Chat)
  useEffect(() => {
    if (search.tab && bottomTabs.includes(search.tab) && search.tab !== activeTab) {
      setActiveTab(search.tab);
    }
  }, [search.tab]);
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  // Chart timeframe — controls which interval the TradingView widget loads.
  const [timeframe, setTimeframe] = useState<"3m" | "5m" | "15m" | "1h" | "4h" | "1d">("15m");

  const market = snapshot?.market;
  const liveName   = snapshot?.name ?? "…";
  const liveSymbol = snapshot?.symbol ?? "…";
  useDocumentTitle(snapshot?.symbol ? `$${snapshot.symbol}` : "Token");
  const liveImage  = snapshot?.image_uri;
  const livePrice  = market?.price_usd != null
    ? `$${Number(market.price_usd).toPrecision(4)}`
    : snapLoading ? "…" : "—";
  const liveLiq    = (() => {
    const liq = liquidityUsd(market ?? null);
    return liq != null ? fmtUsdShort(liq) : snapLoading ? "…" : "—";
  })();
  const liveVol    = market?.volume_usd != null
    ? fmtUsdShort(market.volume_usd)
    : snapLoading ? "…" : "—";
  const liveSupply = snapshot?.total_supply
    ? fmtAmount(snapshot.total_supply)
    : snapLoading ? "…" : "—";
  const liveMcap = (() => {
    const price = market?.price_usd;
    const supply = snapshot?.total_supply;
    if (price != null && supply) {
      const tokens = Number(supply) / 1e18;
      if (isFinite(tokens) && tokens > 0) return fmtUsdShort(price * tokens);
    }
    return snapLoading ? "…" : "—";
  })();
  const liveP24h = market?.pct_change_24h ?? 0;
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  // Live balances for the trade panel — MON for buys, the token itself for
  // sells. Both auto-refresh every 15s via the hook. Previously this panel
  // hardcoded "— MON" so the user could never see what they had to spend.
  const monBal = useMonBalance(me);
  const tokBal = useTokenBalance(me, isContract(t.addr) ? t.addr : undefined);
  const displayBal = side === "buy" ? monBal.balance : tokBal.balance;
  const displaySym = side === "buy" ? "MON" : liveSymbol;
  const balLoading = side === "buy" ? monBal.loading : tokBal.loading;
  const fillMax = () => {
    if (!me) return;
    if (side === "buy") {
      // Leave a tiny dust buffer for gas — ~0.005 MON
      const v = Math.max(0, monBal.balance - 0.005);
      setAmount(v > 0 ? v.toFixed(6).replace(/\.?0+$/, "") : "0");
    } else {
      // Truncate, never round — toFixed rounds up, which can display (and
      // later sell) more than the wallet actually holds.
      const v = Math.floor(tokBal.balance * 1e6) / 1e6;
      setAmount(v > 0 ? v.toFixed(6).replace(/\.?0+$/, "") : "0");
    }
  };
  const [limitPrice, setLimitPrice] = useState("");
  const [expiry, setExpiry] = useState<"1h" | "1d" | "7d" | "never">("1d");

  // Live route + expected output. Execution is Dirol-first; server fallback
  // handles Nad.fun direct only when Dirol cannot route a token.
  const rawAmount = (() => {
    if (!(amount && Number(amount) > 0)) return "0";
    let raw = BigInt(Math.floor(Number(amount) * 1e18));
    // Sells: float→wei conversion can overshoot the real balance by a few
    // wei (float precision), and the router's transferFrom would revert
    // with "ERC20: transfer amount exceeds balance". Clamp to the exact
    // on-chain balance so "sell everything" actually executes.
    if (side === "sell" && tokBal.raw > 0n && raw > tokBal.raw) raw = tokBal.raw;
    return raw.toString();
  })();
  const quote = useUnifiedQuote({
    token: isContract(t.addr) ? t.addr : undefined,
    side,
    amount: rawAmount,
    slippageBps,
    isGraduated: snapshot?.is_graduated,
  });
  const expectedOut = quote.amountOut && quote.amountOut !== "0"
    ? (Number(quote.amountOut) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 6 })
    : "0";
  const expectedSymbol = side === "buy" ? liveSymbol : "MON";
  const priceImpact = quote.priceImpactBps != null
    ? (quote.priceImpactBps / 100).toFixed(2) + "%"
    : null;

  const blockCheck = blocklist.checkToken(t.addr, creatorOnChain);
  const isMobile = useIsMobile();
  const chartHeight = isMobile ? 300 : 480;
  // Graduated/bonded tokens have a real DEX pool → use the GeckoTerminal embed.
  const useGeckoChart = isContract(t.addr) && snapshot?.is_graduated === true;
  // Multi-window price change (5m/1h/6h/12h/24h) from OHLCV.
  const priceChanges = useTokenPriceChanges(isContract(t.addr) ? t.addr : undefined);

  return (
    <div className="space-y-3">
      {(blockCheck.tokenBlocked || blockCheck.launcherBlocked) && (
        <BlocklistWarning
          tokenAddress={t.addr}
          symbol={liveSymbol}
          check={blockCheck}
          onUnblockToken={blockCheck.tokenBlocked ? () => blocklist.unblockToken(t.addr) : undefined}
          onUnblockLauncher={
            blockCheck.launcherBlocked && creatorOnChain
              ? () => blocklist.unblockWallet(creatorOnChain)
              : undefined
          }
        />
      )}
      <section className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="px-3 sm:px-4 py-2.5 border-b border-border space-y-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {liveImage ? (
              <img src={liveImage} alt={liveSymbol} className="size-11 sm:size-16 rounded-xl object-cover shrink-0" />
            ) : (
              <span className="size-11 sm:size-16 rounded-xl grid place-items-center text-sm font-bold text-background shrink-0" style={{ background: t.color }}>
                {liveSymbol.slice(0, 2)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-none text-base sm:text-lg truncate">{liveName}</p>
              <p className="text-[11px] text-muted-foreground font-mono inline-flex items-center gap-1 mt-1 max-w-full">
                <span className="truncate sm:hidden">{shortAddr(t.addr)}</span>
                <span className="truncate hidden sm:inline">{t.addr}</span>
                <Copy className="size-3 shrink-0" />
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2.5">
            <TopStat label="Price" value={livePrice} />
            <TopStat label="Volume" mobileLabel="Vol" value={liveVol} sub="24h · USD" />
            <TopStat label="Market Cap" mobileLabel="MCap" value={liveMcap} />
            <TopStat label="24h" value={fmtPct(liveP24h)} positive={liveP24h >= 0} />
          </div>

          {/* Multi-window price change — 5m / 1h / 6h / 12h / 24h from OHLCV */}
          <div className="mt-3 grid grid-cols-5 gap-1.5">
            {([
              ["5m", priceChanges?.m5],
              ["1h", priceChanges?.h1],
              ["6h", priceChanges?.h6],
              ["12h", priceChanges?.h12],
              ["24h", priceChanges?.h24],
            ] as const).map(([label, val]) => {
              const up = (val ?? 0) >= 0;
              return (
                <div key={label} className="rounded-lg bg-surface-2 px-1.5 py-1.5 text-center">
                  <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
                  <div className={`text-xs font-bold tabular-nums mt-0.5 ${
                    val == null ? "text-muted-foreground" : up ? "text-up" : "text-down"
                  }`}>
                    {val == null ? "—" : `${up ? "+" : ""}${val.toFixed(2)}%`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px]">
          <div className="border-b xl:border-b-0 xl:border-r border-border flex flex-col">
            {/* Graduated (bonded) tokens live on a real DEX pool → embed the
                full GeckoTerminal chart (it has its own timeframe toolbar).
                Bonding-curve tokens keep our native Nad.fun chart + timeframes. */}
            {!useGeckoChart && (
              <div className="px-3 sm:px-4 py-2 border-b border-border flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs overflow-x-auto scrollbar-hide">
                  {(["3m", "5m", "15m", "1h", "4h", "1d"] as const).map((x) => (
                    <button
                      key={x}
                      onClick={() => setTimeframe(x)}
                      className={`h-7 px-2.5 rounded-md ${timeframe === x ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground"}`}
                    >
                      {x}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="px-1 sm:px-2 py-2">
              {useGeckoChart ? (
                <GeckoTerminalChart token={t.addr} height={chartHeight} />
              ) : isContract(t.addr) ? (
                <TradingViewAdvancedChart token={t.addr} symbol={liveSymbol} interval={timeframe} height={chartHeight} />
              ) : (
                <CandleChart height={isMobile ? 260 : 360} />
              )}
            </div>
          </div>

          <aside className="p-3 sm:p-4 space-y-3 bg-surface/40">
            {/* Buy / Sell pill */}
            <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-surface-2">
              <button
                onClick={() => setSide("buy")}
                className={`h-11 rounded-xl text-sm font-bold transition-colors ${
                  side === "buy"
                    ? "bg-up text-background ring-2 ring-up/40 shadow-[0_0_0_2px_rgba(34,197,94,0.15)]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Buy
              </button>
              <button
                onClick={() => setSide("sell")}
                className={`h-11 rounded-xl text-sm font-bold transition-colors ${
                  side === "sell"
                    ? "bg-down text-white ring-2 ring-down/40 shadow-[0_0_0_2px_rgba(239,68,68,0.15)]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Sell
              </button>
            </div>

            {/* Market / Limit */}
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-surface-2">
              {(["market", "limit"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setOrderType(m)}
                  className={`h-8 rounded-lg text-xs font-semibold capitalize transition-colors ${
                    orderType === m ? "lit-purple" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Balance — live from chain, polled every 15s */}
            <div className="flex items-center justify-between text-xs px-1">
              <span className="text-muted-foreground">
                Balance:{" "}
                <span className="text-foreground font-semibold">
                  {!me
                    ? "— "
                    : balLoading && displayBal === 0
                      ? "…"
                      : displayBal.toLocaleString("en-US", { maximumFractionDigits: 4 })}{" "}
                  {displaySym}
                </span>
              </span>
              <button
                onClick={fillMax}
                disabled={!me || displayBal <= 0}
                className="text-primary font-semibold hover:underline disabled:opacity-40 disabled:hover:no-underline"
              >
                Max
              </button>
            </div>

            {/* Amount input */}
            <div className="rounded-2xl bg-surface-2 px-4 py-3">
              <div className="flex items-center gap-2">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="flex-1 min-w-0 bg-transparent text-2xl font-bold focus:outline-none placeholder:text-muted-foreground/50"
                />
                <TradeAssetChip side={side} symbol={liveSymbol} imageUri={liveImage} color={t.color} />
              </div>
            </div>

            {/* Quick amounts */}
            <div className={`grid gap-1.5 ${quickAmounts.length <= 4 ? "grid-cols-4" : "grid-cols-3 sm:grid-cols-4"}`}>
              {quickAmounts.map((a) => {
                const label = String(a);
                return (
                <button
                  key={label}
                  onClick={() => setAmount(label)}
                  className={`h-9 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1 transition-colors ${
                    amount === label ? "lit-purple" : "bg-surface-2 text-foreground hover:bg-white/10"
                  }`}
                >
                  <TradeAssetIcon side={side} symbol={liveSymbol} imageUri={liveImage} color={t.color} small /> {label}
                </button>
                );
              })}
            </div>

            {/* Limit-only fields */}
            {orderType === "limit" && (
              <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">Limit price (USD)</span>
                  <input
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                    inputMode="decimal"
                    className="mt-1 h-10 w-full rounded-lg bg-background/60 px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                </label>
                <div>
                  <span className="text-[11px] text-muted-foreground">Expires in</span>
                  <div className="grid grid-cols-4 gap-1 mt-1">
                    {(["1h", "1d", "7d", "never"] as const).map((e) => (
                      <button
                        key={e}
                        onClick={() => setExpiry(e)}
                        className={`h-8 rounded-lg text-[11px] font-semibold ${
                          expiry === e ? "lit-purple" : "bg-background/60 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Expected + Slippage rows */}
            <div className="space-y-1.5 text-xs px-1">
              {/* No venue label — we don't surface which aggregator
                  routed the swap. Just the expected output. */}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Expected</span>
                <span className="text-primary font-bold">
                  {quote.isLoading && rawAmount !== "0" ? "…" : `${expectedOut} ${expectedSymbol}`}
                </span>
              </div>
              {priceImpact && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Price impact</span>
                  <span className={`font-semibold ${
                    Number(priceImpact) > 5 ? "text-down" : Number(priceImpact) > 1 ? "text-foreground" : "text-up"
                  }`}>
                    {priceImpact}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Slippage</span>
                <Link
                  to="/settings"
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-surface-2 text-foreground hover:bg-white/10"
                >
                  <Settings className="size-3" />
                  <span className="font-semibold">{slippagePct}%</span>
                </Link>
              </div>
            </div>

            {/* CTA */}
            <TradeButton
              symbol={liveSymbol}
              addr={t.addr}
              side={side}
              orderType={orderType}
              amount={amount}
              limitPrice={limitPrice}
              expectedOut={quote.amountOut}
              venue={quote.venue}
              slippageBps={slippageBps}
              rawAmount={rawAmount}
              expiry={expiry}
            />
          </aside>
        </div>

        <div className="border-t border-border">
          <div className="px-2 sm:px-3 py-2 flex items-center gap-1 overflow-x-auto scrollbar-hide border-b border-border">
            {bottomTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`h-8 px-2.5 sm:px-3 rounded-md text-xs whitespace-nowrap ${
                  activeTab === tab ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground"
                }`}
              >
                {tab}
              </button>
            ))}
            <button className="ml-auto h-8 px-2 rounded-md bg-surface-2 border border-border text-xs inline-flex items-center gap-1">
              USD <ChevronDown className="size-3" />
            </button>
          </div>

          {activeTab === "Chat" ? (
            <TokenChat tokenAddress={t.addr} symbol={liveSymbol} enabled={activeTab === "Chat"} />
          ) : activeTab === "Trades" && isContract(t.addr) ? (
            <TradesTab token={t.addr} enabled={activeTab === "Trades"} priceUsd={market?.price_usd ?? null} />
          ) : activeTab === "Holders" && isContract(t.addr) ? (
            <HoldersTab token={t.addr} enabled={activeTab === "Holders"} priceUsd={market?.price_usd ?? null} dev={creatorOnChain} />
          ) : (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Select a tab above.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function TradeButton({
  symbol, addr, side, orderType, amount, limitPrice, expectedOut, venue, slippageBps, rawAmount, expiry,
}: {
  symbol: string;
  addr: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  amount: string;
  limitPrice: string;
  expectedOut: string;
  venue: "nadfun" | "dirol";
  slippageBps: number;
  rawAmount: string;
  expiry: "1h" | "1d" | "7d" | "never";
}) {
  const me = useMe();
  const { run, pending, hash, error } = useSwapExecute();
  const [placing, setPlacing] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const disabled = !amount || (orderType === "limit" && !limitPrice) || !me;
  const label = !me
    ? "Connect wallet to trade"
    : orderType === "limit"
    ? `Place limit ${side === "buy" ? "Buy" : "Sell"} ${symbol}`
    : `${side === "buy" ? "Buy" : "Sell"} ${symbol}`;

  const handle = async () => {
    if (!me) return;
    if (orderType === "limit") {
      setPlacing(true);
      try {
        const expiresAt = expiry === "never" ? undefined
          : new Date(Date.now() + (expiry === "1h" ? 3600 : expiry === "1d" ? 86400 : 86400 * 7) * 1000);
        await createLimitOrder({
          owner: me,
          tokenAddress: addr,
          side: side.toUpperCase() as "BUY" | "SELL",
          amountIn: BigInt(rawAmount || "0"),
          limitPriceUsd: Number(limitPrice),
          slippageBps,
          expiresAt,
        });
        setOkMsg("Limit order placed. The keeper will fire it when conditions match.");
      } catch (e: any) {
        setOkMsg(null);
      } finally {
        setPlacing(false);
      }
      return;
    }
    // Apply slippage to expected out for minimum
    const exp = BigInt(expectedOut || "0");
    const minOut = exp - (exp * BigInt(slippageBps)) / 10000n;
    await run({
      venue,
      side,
      tokenAddress: addr as `0x${string}`,
      rawAmount: BigInt(rawAmount || "0"),
      recipient: me as `0x${string}`,
      slippageBps,
      amountOutMin: minOut,
      source: "market",
      symbol,
    });
  };

  return (
    <>
      <button
        onClick={handle}
        disabled={disabled || pending || placing}
        className={`h-12 w-full rounded-2xl text-sm font-bold disabled:opacity-40 ${
          side === "buy" ? "bg-up text-background hover:bg-up/90" : "bg-down text-white hover:bg-down/90"
        }`}
      >
        {pending || placing ? "Submitting…" : label}
      </button>
      {hash && (
        <a
          href={txUrl(hash)}
          target="_blank"
          rel="noreferrer"
          className="block mt-2 text-[11px] text-primary text-center hover:underline"
        >
          Tx confirmed · view on {MONAD_EXPLORER_NAME}
        </a>
      )}
      {okMsg && <p className="text-[11px] text-up text-center mt-2">{okMsg}</p>}
      {error && <p className="text-[11px] text-down text-center mt-2 truncate">{error}</p>}
    </>
  );
}

function fmtAmount(v: string | number, decimals = 18) {
  const n = typeof v === "string" ? Number(v) / 10 ** decimals : Number(v);
  if (!isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}
function fmtUsdShort(v: string | number) {
  const n = Number(v);
  if (!isFinite(n) || n < 0) return "—";
  if (n >= 1e15) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(3)}`;
}
function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
function timeAgo(ts: number) {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function TradesTab({ token, enabled, priceUsd: _priceUsd }: { token: string; enabled: boolean; priceUsd: number | null }) {
  const { trades, loading } = useTokenTrades(token, enabled);
  if (loading && trades.length === 0) return <div className="py-12 text-center text-sm text-muted-foreground">Loading trades…</div>;
  if (trades.length === 0) return <div className="py-12 text-center text-sm text-muted-foreground">No trades yet</div>;
  return (
    <>
      <ul className="md:hidden divide-y divide-border/50">
        {trades.map((s) => {
          const buy = s.side === "BUY";
          return (
            <li key={s.tx_hash} className="px-3 py-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md shrink-0 ${buy ? "bg-up/15 text-up" : "bg-down/15 text-down"}`}>
                  {buy ? "Buy" : "Sell"}
                </span>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {timeAgo(Math.floor(new Date(s.created_at_chain).getTime() / 1000))}
                </span>
                <span className={`text-sm font-semibold ml-auto ${buy ? "text-up" : "text-down"}`}>
                  {fmtUsdShort(s.value_usd ?? 0)}
                </span>
              </div>
              <WalletLabel address={s.account_address} className="text-xs block truncate max-w-full hover:underline" />
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span className="truncate">{fmtAmount(s.token_amount)} tokens</span>
                <span className="shrink-0 font-mono">${Number(s.price_usd ?? 0).toPrecision(3)}</span>
                <a
                  href={txUrl(s.tx_hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 font-mono text-primary hover:underline"
                >
                  {shortAddr(s.tx_hash)}
                </a>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase text-muted-foreground border-b border-border">
              <th className="text-left px-3 py-2.5">Time</th>
              <th className="text-left px-3 py-2.5">Trader</th>
              <th className="text-left px-3 py-2.5">Side</th>
              <th className="text-right px-3 py-2.5">USD</th>
              <th className="text-right px-3 py-2.5">Tokens</th>
              <th className="text-right px-3 py-2.5">Price</th>
              <th className="text-right px-3 py-2.5">Tx</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((s) => {
              const buy = s.side === "BUY";
              return (
                <tr key={s.tx_hash} className="border-b border-border/50 row-hover">
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {timeAgo(Math.floor(new Date(s.created_at_chain).getTime() / 1000))}
                  </td>
                  <td className="px-3 py-2.5 max-w-[180px]">
                    <WalletLabel address={s.account_address} className="text-xs block truncate hover:underline" />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${buy ? "bg-up/15 text-up" : "bg-down/15 text-down"}`}>
                      {buy ? "Buy" : "Sell"}
                    </span>
                  </td>
                  <td className={`px-3 py-2.5 text-right font-semibold ${buy ? "text-up" : "text-down"}`}>
                    {fmtUsdShort(s.value_usd ?? 0)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">{fmtAmount(s.token_amount)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">
                    ${Number(s.price_usd ?? 0).toPrecision(3)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <a
                      href={txUrl(s.tx_hash)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] font-mono text-primary hover:underline"
                    >
                      {shortAddr(s.tx_hash)}
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Badge shown next to the token creator's wallet in the holders list.
function DevTag() {
  return (
    <span
      className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/20 text-primary"
      title="Token creator (dev) wallet"
    >
      Dev
    </span>
  );
}

function HoldersTab({ token, enabled, priceUsd, dev }: { token: string; enabled: boolean; priceUsd: number | null; dev?: string | null }) {
  const { holders, loading } = useTokenHolders(token, enabled);
  const devAddr = dev?.toLowerCase() ?? null;
  const isDev = (a: string) => !!devAddr && a.toLowerCase() === devAddr;
  if (!SUPABASE_ENABLED) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Connect Supabase to load holders.</div>;
  }
  if (loading && holders.length === 0) return <div className="py-12 text-center text-sm text-muted-foreground">Loading holders…</div>;
  if (holders.length === 0) return <div className="py-12 text-center text-sm text-muted-foreground">No holders</div>;
  const totalBalance = holders.reduce((s, h) => s + Number(h.balance), 0);
  const px = priceUsd ?? 0;
  return (
    <>
      <ul className="md:hidden divide-y divide-border/50">
        {holders.map((h, i) => {
          const bal = Number(h.balance);
          const usd = (bal / 1e18) * px;
          const pct = totalBalance > 0 ? (bal / totalBalance) * 100 : 0;
          return (
            <li key={h.account_address} className="px-3 py-3 space-y-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[11px] text-muted-foreground w-5 shrink-0">{i + 1}</span>
                <WalletLabel address={h.account_address} className="text-sm font-medium block truncate min-w-0 hover:underline" />
                {isDev(h.account_address) && <DevTag />}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs pl-7">
                <span className="font-mono text-muted-foreground">{fmtAmount(h.balance)}</span>
                <span className="font-semibold">{fmtUsdShort(usd)}</span>
                <span className="text-muted-foreground tabular-nums">{pct.toFixed(1)}%</span>
              </div>
              <div className="h-1 rounded-full bg-white/5 overflow-hidden ml-7">
                <div className="h-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase text-muted-foreground border-b border-border">
              <th className="text-left px-3 py-2.5">#</th>
              <th className="text-left px-3 py-2.5">Holder</th>
              <th className="text-right px-3 py-2.5">Balance</th>
              <th className="text-right px-3 py-2.5">USD value</th>
              <th className="text-right px-3 py-2.5">% of top {holders.length}</th>
            </tr>
          </thead>
          <tbody>
            {holders.map((h, i) => {
              const bal = Number(h.balance);
              const usd = (bal / 1e18) * px;
              const pct = totalBalance > 0 ? (bal / totalBalance) * 100 : 0;
              return (
                <tr key={h.account_address} className="border-b border-border/50 row-hover">
                  <td className="px-3 py-2.5 text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2.5 max-w-[220px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <WalletLabel address={h.account_address} className="text-xs block truncate hover:underline" />
                      {isDev(h.account_address) && <DevTag />}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">{fmtAmount(h.balance)}</td>
                  <td className="px-3 py-2.5 text-right">{fmtUsdShort(usd)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex items-center gap-2">
                      <div className="h-1 w-16 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums">{pct.toFixed(2)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TopStat({
  label,
  mobileLabel,
  value,
  positive,
  sub,
}: {
  label: string;
  mobileLabel?: string;
  value: string;
  positive?: boolean;
  sub?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-muted-foreground truncate">
        <span className="sm:hidden">{mobileLabel ?? label}</span>
        <span className="hidden sm:inline">{label}</span>
        {sub && <span className="hidden sm:inline text-[9px] ml-1 opacity-70">· {sub}</span>}
      </p>
      <p className={`text-xs sm:text-sm font-semibold truncate ${typeof positive === "boolean" ? (positive ? "text-up" : "text-down") : ""}`}>
        {value}
      </p>
    </div>
  );
}

function TradeAssetIcon({
  side, symbol, imageUri, color, small,
}: {
  side: "buy" | "sell";
  symbol: string;
  imageUri?: string | null;
  color: string;
  small?: boolean;
}) {
  const size = small ? 14 : 20;
  if (side === "buy") return <MonLogo size={size} />;
  if (imageUri) {
    return (
      <img
        src={imageUri}
        alt={symbol}
        className={`rounded-full object-cover shrink-0 ${small ? "size-3.5" : "size-5"}`}
      />
    );
  }
  return (
    <span
      className={`rounded-full grid place-items-center font-bold text-background shrink-0 ${small ? "size-3.5 text-[8px]" : "size-5 text-[10px]"}`}
      style={{ background: color }}
    >
      {symbol.slice(0, 2)}
    </span>
  );
}

function TradeAssetChip({
  side, symbol, imageUri, color,
}: {
  side: "buy" | "sell";
  symbol: string;
  imageUri?: string | null;
  color: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 h-8 px-2 rounded-full bg-background/60 shrink-0">
      <TradeAssetIcon side={side} symbol={symbol} imageUri={imageUri} color={color} />
      <span className="text-sm font-bold">{side === "buy" ? "MON" : symbol}</span>
    </span>
  );
}

function TokenChat({ tokenAddress, symbol, enabled }: { tokenAddress: string; symbol: string; enabled: boolean }) {
  const me = useMe();
  const channelId = tokenAddress.toLowerCase();
  const gunRaw = useGunChat("token", SUPABASE_ENABLED ? undefined : channelId);
  const { messages: sbMsgs, loading: sbLoading } = useTokenChat(tokenAddress, enabled && SUPABASE_ENABLED);
  const [draft, setDraft] = useState("");
  const [sentiment, setSentiment] = useState<"bullish" | "bearish" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const sendBody = async (body: string) => {
    if (SUPABASE_ENABLED) {
      await sendTokenChatMessage({ data: { token: tokenAddress, me: me!, body } });
    } else {
      await gunSend("token", channelId, {
        id: crypto.randomUUID(),
        sender: me!.toLowerCase(),
        body,
        kind: body.startsWith("data:image") ? "image" : "text",
      });
    }
  };

  const send = async () => {
    if (!draft.trim() || !me) return;
    let body = draft.trim();
    if (sentiment === "bullish") body = `▲ ${body}`;
    if (sentiment === "bearish") body = `▼ ${body}`;
    try {
      await sendBody(body);
      setDraft("");
      setSentiment(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to send chat message");
    }
  };

  const sendImage = (file: File) => {
    if (!me) return;
    if (!file.type.startsWith("image/")) { alert("Only image files."); return; }
    if (file.size > 2 * 1024 * 1024) { alert("Image must be under 2 MB."); return; }
    setUploading(true);
    const r = new FileReader();
    r.onload = () => {
      sendBody(String(r.result ?? ""))
        .catch((e) => alert(e instanceof Error ? e.message : "Failed to send image"))
        .finally(() => setUploading(false));
    };
    r.onerror = () => { setUploading(false); alert("Could not read image file."); };
    r.readAsDataURL(file);
  };

  const msgs = SUPABASE_ENABLED
    ? sbMsgs
    : [...(gunRaw ?? [])].reverse().map((m) => ({
        id: m.id,
        sender_address: m.sender,
        body: m.body,
        created_at: new Date(m.ts).toISOString(),
      }));

  return (
    <div>
      {!SUPABASE_ENABLED && !GUN_ENABLED && (
        <p className="text-xs text-amber-400/90 px-4 py-2">Set VITE_SUPABASE_URL or VITE_GUN_PEERS for token chat.</p>
      )}
      <div className="p-3 sm:p-4 border-b border-white/5">
        <div className="flex gap-3">
          {me ? (
            <UserAvatar address={me} size={40} />
          ) : (
            <div className="size-10 rounded-full grid place-items-center text-sm font-bold shrink-0 bg-primary/15 text-primary border border-primary/20">
              ?
            </div>
          )}
          <div className="flex-1">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              placeholder={me ? `Say something about $${symbol}…` : "Connect wallet to chat"}
              disabled={!me}
              className="w-full bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none resize-none disabled:opacity-50"
            />
            <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setSentiment((s) => (s === "bullish" ? null : "bullish"))}
                  className={`h-7 px-3 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 ${
                    sentiment === "bullish" ? "bg-up text-background" : "bg-white/5 text-up"
                  }`}
                >
                  ▲ Bullish
                </button>
                <button
                  onClick={() => setSentiment((s) => (s === "bearish" ? null : "bearish"))}
                  className={`h-7 px-3 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 ${
                    sentiment === "bearish" ? "bg-down text-background" : "bg-white/5 text-down"
                  }`}
                >
                  ▼ Bearish
                </button>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={!me || uploading}
                  title="Attach image"
                  className="h-7 px-2.5 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 bg-white/5 text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <ImageIcon className="size-3.5" />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) sendImage(f);
                    e.target.value = "";
                  }}
                />
              </div>
              <button
                onClick={() => void send()}
                disabled={!draft.trim() || !me || uploading}
                className="h-8 px-4 rounded-full lit-purple text-xs font-bold disabled:opacity-40"
              >
                {uploading ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <ul>
        {sbLoading && msgs.length === 0 && (
          <li className="px-4 py-8 text-center text-xs text-muted-foreground">Loading chat…</li>
        )}
        {!sbLoading && msgs.length === 0 && (
          <li className="px-4 py-8 text-center text-xs text-muted-foreground">No messages yet — be first.</li>
        )}
        {msgs.map((m) => {
          const mine = me && m.sender_address === me.toLowerCase();
          const bullish = m.body.startsWith("▲");
          const bearish = m.body.startsWith("▼");
          const body = bullish || bearish ? m.body.slice(2).trim() : m.body;
          return (
            <li key={m.id} className="flex gap-3 px-3 sm:px-4 py-3 hover:bg-white/5">
              <UserAvatar address={m.sender_address} size={40} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-sm flex-wrap">
                  <HandleLink address={m.sender_address} className="text-xs text-muted-foreground hover:underline" />
                  <span className="text-muted-foreground text-xs">
                    · {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {bullish && <span className="text-[10px] px-1.5 py-0.5 rounded-full text-up bg-up/15 font-bold">▲ BULL</span>}
                  {bearish && <span className="text-[10px] px-1.5 py-0.5 rounded-full text-down bg-down/15 font-bold">▼ BEAR</span>}
                  {mine && <span className="text-[10px] text-primary">you</span>}
                </div>
                {body.startsWith("data:image") ? (
                  <img
                    src={body}
                    alt="Shared image"
                    className="mt-1 max-w-full max-h-72 rounded-lg object-contain bg-surface-2"
                  />
                ) : (
                  <p className="text-[15px] leading-snug mt-0.5 whitespace-pre-wrap break-words">
                    {renderMentions(body)}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
