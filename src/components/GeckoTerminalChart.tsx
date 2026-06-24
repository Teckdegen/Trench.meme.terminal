// Embedded GeckoTerminal chart for graduated ("bonded") tokens — once a token
// completes its bonding curve and lives on a real DEX pool, GeckoTerminal has
// full TradingView-grade candles, so we embed their iframe. If GeckoTerminal
// has no pool indexed for the token, callers fall back to our native
// TradingView chart (see useGeckoPool's "nopool" state).

import { useEffect, useState } from "react";
import { fetchGeckoPool } from "@/lib/geckoterminal";

export type GeckoPoolState = {
  state: "idle" | "loading" | "pool" | "nopool";
  pool: string | null;
  network: string;
};

/** Resolve a token's GeckoTerminal pool. `token` undefined = idle (no fetch). */
export function useGeckoPool(token: string | undefined): GeckoPoolState {
  const [s, setS] = useState<GeckoPoolState>({ state: "idle", pool: null, network: "monad" });

  useEffect(() => {
    if (!token) { setS({ state: "idle", pool: null, network: "monad" }); return; }
    let cancel = false;
    setS((prev) => ({ ...prev, state: "loading" }));
    fetchGeckoPool({ data: { token } })
      .then((r) => {
        if (cancel) return;
        setS({ state: r.pool ? "pool" : "nopool", pool: r.pool, network: r.network });
      })
      .catch(() => { if (!cancel) setS({ state: "nopool", pool: null, network: "monad" }); });
    return () => { cancel = true; };
  }, [token]);

  return s;
}

/** The GeckoTerminal iframe for a resolved pool. Fills its parent's height so
 *  the chart column can stretch to match the trade panel (no blank gap). */
export function GeckoEmbed({
  pool, network, minHeight = 480,
}: { pool: string; network: string; minHeight?: number }) {
  // Dark, chart-only embed (hide the info bar + swaps panel).
  const src =
    `https://www.geckoterminal.com/${network}/pools/${pool}` +
    `?embed=1&info=0&swaps=0&grayscale=0&light_chart=0&theme=dark`;
  return (
    <iframe
      title="GeckoTerminal chart"
      src={src}
      width="100%"
      allow="clipboard-write"
      allowFullScreen
      className="w-full h-full flex-1 rounded-xl border border-white/5"
      style={{ minHeight }}
    />
  );
}
