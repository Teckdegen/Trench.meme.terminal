// DexScreener embedded chart. First tries to resolve the top pair via the
// public API, then renders their iframe. Falls back to GeckoTerminal, then
// TradingView lightweight-charts if neither has data.

import { useEffect, useState } from "react";

const DS_EMBED = "https://dexscreener.com";
const DS_API   = "https://api.dexscreener.com/latest/dex/tokens";

export type DsEmbedState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "pair"; pair: string }
  | { state: "nopair" };

const cache = new Map<string, { pair: string | null; at: number }>();
const TTL = 60_000;

export function useDexScreenerPair(token: string | undefined): DsEmbedState {
  const [s, setS] = useState<DsEmbedState>({ state: "idle" });

  useEffect(() => {
    if (!token) { setS({ state: "idle" }); return; }
    const hit = cache.get(token);
    if (hit && Date.now() - hit.at < TTL) {
      setS(hit.pair ? { state: "pair", pair: hit.pair } : { state: "nopair" });
      return;
    }
    let cancelled = false;
    setS({ state: "loading" });
    fetch(`${DS_API}/${token}`, { headers: { accept: "application/json" } })
      .then((r) => r.json())
      .then((j: any) => {
        if (cancelled) return;
        const pairs: any[] = (j?.pairs ?? []).filter((p: any) => p.chainId === "monad");
        pairs.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
        const pair = pairs[0]?.pairAddress ?? null;
        cache.set(token, { pair, at: Date.now() });
        setS(pair ? { state: "pair", pair } : { state: "nopair" });
      })
      .catch(() => {
        if (!cancelled) {
          cache.set(token, { pair: null, at: Date.now() });
          setS({ state: "nopair" });
        }
      });
    return () => { cancelled = true; };
  }, [token]);

  return s;
}

export function DexScreenerEmbed({
  pair,
  className = "",
}: {
  pair: string;
  className?: string;
}) {
  // embed=1 → iframe mode, theme=dark, info=0 hides the token info bar inside
  // the embed (we have our own), makeItStick=1 keeps the chart docked.
  const src =
    `${DS_EMBED}/monad/${pair}` +
    `?embed=1&theme=dark&info=0&trades=0`;

  return (
    <iframe
      title="DexScreener chart"
      src={src}
      className={`w-full h-full border-0 ${className}`}
      allow="clipboard-write"
      allowFullScreen
    />
  );
}
