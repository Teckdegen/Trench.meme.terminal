// Embedded GeckoTerminal chart for graduated ("bonded") tokens — once a token
// completes its bonding curve and lives on a real DEX pool, GeckoTerminal has
// full TradingView-grade candles, so we embed their iframe instead of our own
// lightweight-charts feed. Bonding-curve tokens (no DEX pool yet) keep the
// native Nad.fun chart.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchGeckoPool } from "@/lib/geckoterminal";

export function GeckoTerminalChart({
  token,
  height = 480,
}: {
  token: string;
  height?: number;
}) {
  const [pool, setPool] = useState<string | null>(null);
  const [network, setNetwork] = useState("monad");
  const [state, setState] = useState<"loading" | "ready" | "nopool">("loading");

  useEffect(() => {
    let cancel = false;
    setState("loading");
    fetchGeckoPool({ data: { token } })
      .then((r) => {
        if (cancel) return;
        setNetwork(r.network);
        if (r.pool) {
          setPool(r.pool);
          setState("ready");
        } else {
          setState("nopool");
        }
      })
      .catch(() => { if (!cancel) setState("nopool"); });
    return () => { cancel = true; };
  }, [token]);

  if (state === "loading") {
    return (
      <div className="grid place-items-center text-muted-foreground" style={{ height }}>
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (state === "nopool" || !pool) {
    return (
      <div className="grid place-items-center text-xs text-muted-foreground px-6 text-center" style={{ height }}>
        Chart isn't available for this pool yet.
      </div>
    );
  }

  // Dark, chart-only embed (hide the info bar + swaps panel so it slots into
  // our layout cleanly). theme=dark matches the app.
  const src =
    `https://www.geckoterminal.com/${network}/pools/${pool}` +
    `?embed=1&info=0&swaps=0&grayscale=0&light_chart=0&theme=dark`;

  return (
    <iframe
      title="GeckoTerminal chart"
      src={src}
      height={height}
      width="100%"
      allow="clipboard-write"
      allowFullScreen
      className="w-full rounded-xl border border-white/5"
      style={{ height }}
    />
  );
}
