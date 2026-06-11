// Real TradingView Advanced Charts widget.
//
// The library itself is NOT on npm — TradingView requires you to request access
// at https://www.tradingview.com/charting-library-docs/latest/getting_started/
// and then drop their files in /public/charting_library/.
//
// Expected files after extraction:
//   /public/charting_library/charting_library.standalone.js
//   /public/charting_library/bundles/...
//   /public/datafeeds/udf/dist/bundle.js   (only if you use the UDF helper)
//
// If the library isn't present (404 on the script tag), we fall back to
// lightweight-charts. So the chart never breaks — it just downgrades.

import { useEffect, useRef, useState } from "react";
import { TradingViewChart } from "@/components/TradingViewChart";
import { makeTradingViewDatafeed } from "@/lib/tradingview-datafeed";

const LIBRARY_PATH = "/charting_library/";
const LIBRARY_SCRIPT = `${LIBRARY_PATH}charting_library.standalone.js`;

// Global once-loaded promise so we only inject the script tag once per page.
let libLoadPromise: Promise<boolean> | null = null;
function loadTvLibrary(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if ((window as any).TradingView?.widget) return Promise.resolve(true);
  if (libLoadPromise) return libLoadPromise;
  libLoadPromise = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = LIBRARY_SCRIPT;
    s.async = true;
    s.onload = () => resolve(!!(window as any).TradingView?.widget);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return libLoadPromise;
}

// UI label → TradingView interval string mapping
const TV_INTERVAL: Record<string, string> = {
  "3m": "3", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "1D",
};

export function TradingViewAdvancedChart({
  token, symbol, interval = "15m", height = 480,
}: { token: string; symbol: string; interval?: string; height?: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<any>(null);
  const [hasLib, setHasLib] = useState<boolean | null>(null);
  const tvInterval = TV_INTERVAL[interval] ?? "15";

  // Detect library availability once
  useEffect(() => {
    let cancelled = false;
    loadTvLibrary().then((ok) => { if (!cancelled) setHasLib(ok); });
    return () => { cancelled = true; };
  }, []);

  // Mount / unmount widget per token
  useEffect(() => {
    if (!hasLib || !containerRef.current) return;
    const TV = (window as any).TradingView;
    if (!TV?.widget) return;

    const widget = new TV.widget({
      symbol,
      interval: tvInterval,
      container: containerRef.current,
      datafeed: makeTradingViewDatafeed(token, symbol),
      library_path: LIBRARY_PATH,
      locale: "en",
      timezone: "Etc/UTC",
      autosize: true,
      theme: "Dark",
      style: 1,                            // candles
      toolbar_bg: "#0a0410",
      enable_publishing: false,
      hide_top_toolbar: false,
      hide_legend: false,
      hide_side_toolbar: false,
      withdateranges: true,
      allow_symbol_change: false,
      details: false,
      hotlist: false,
      calendar: false,
      studies_overrides: {},
      overrides: {
        // Our purple/up/down palette
        "paneProperties.background": "#0a0410",
        "paneProperties.backgroundType": "solid",
        "paneProperties.vertGridProperties.color": "rgba(255,255,255,0.04)",
        "paneProperties.horzGridProperties.color": "rgba(255,255,255,0.04)",
        "scalesProperties.textColor": "#9ca3af",
        "mainSeriesProperties.candleStyle.upColor": "#22c55e",
        "mainSeriesProperties.candleStyle.downColor": "#ef4444",
        "mainSeriesProperties.candleStyle.borderUpColor": "#22c55e",
        "mainSeriesProperties.candleStyle.borderDownColor": "#ef4444",
        "mainSeriesProperties.candleStyle.wickUpColor": "#22c55e",
        "mainSeriesProperties.candleStyle.wickDownColor": "#ef4444",
        "volumePaneSize": "small",
      },
      loading_screen: { backgroundColor: "#0a0410", foregroundColor: "#a855f7" },
      disabled_features: [
        "use_localstorage_for_settings",
        "header_compare",
        "header_symbol_search",
        "symbol_search_hot_key",
        "save_chart_properties_to_local_storage",
        "popup_hints",
      ],
      enabled_features: [
        "study_templates",
        "side_toolbar_in_fullscreen_mode",
        "hide_left_toolbar_by_default",
      ],
    });

    widgetRef.current = widget;
    // After load, zoom-to-fit so candles fill the visible area instead of
    // clustering on the right edge.
    try {
      widget.onChartReady?.(() => {
        try { widget.activeChart?.().executeActionById?.("timeScaleReset"); } catch {}
      });
    } catch {}
    return () => {
      try { widget.remove(); } catch {}
      widgetRef.current = null;
    };
  }, [hasLib, token, symbol, tvInterval]);

  // While we're checking for the library, render the lightweight fallback so
  // the user never sees a blank box.
  if (hasLib === false) {
    return <TradingViewChart token={token} height={height} />;
  }

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />
      {hasLib === null && (
        <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground pointer-events-none">
          Loading chart…
        </div>
      )}
    </div>
  );
}
