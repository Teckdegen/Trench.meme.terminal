// DexScreener embedded chart. First tries to resolve the top pair via the
// public API, then renders their iframe. Falls back to GeckoTerminal, then
// TradingView lightweight-charts if neither has data.

import { useEffect, useState } from "react";

const DS_API_V1 = "https://api.dexscreener.com/latest/dex/tokens";
const DS_API_V2 = "https://api.dexscreener.com/token-pairs/v1/monad";

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

    // Pick the highest-liquidity Monad pair out of a DexScreener response.
    const topMonadPair = (j: any): string | null => {
      const pairs: any[] = Array.isArray(j) ? j : (j?.pairs ?? []);
      const monad = pairs.filter((p: any) => p?.chainId === "monad" && p?.pairAddress);
      monad.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
      return monad[0]?.pairAddress ?? null;
    };

    const fetchJson = (url: string) =>
      fetch(url, { headers: { accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

    // Try v2 (token-pairs) first; only fall back to v1 if v2 has no pair. This
    // avoids Promise.any resolving to a null v2 result over a real v1 pair.
    (async () => {
      let pair = topMonadPair(await fetchJson(`${DS_API_V2}/${token}`));
      if (!pair) pair = topMonadPair(await fetchJson(`${DS_API_V1}/${token}`));
      if (cancelled) return;
      cache.set(token, { pair, at: Date.now() });
      setS(pair ? { state: "pair", pair } : { state: "nopair" });
    })();

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
  // DexScreener official embed URL — uses the same domain as the main site
  // with ?embed=1 which switches to iframe-friendly mode (no nav, dark theme).
  const src = `https://dexscreener.com/monad/${pair}?embed=1&theme=dark&info=0&trades=0`;

  return (
    <iframe
      title="DexScreener chart"
      src={src}
      className={`w-full h-full border-0 ${className}`}
      allow="clipboard-write"
      allowFullScreen
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
    />
  );
}
