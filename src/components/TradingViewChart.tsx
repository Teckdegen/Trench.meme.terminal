// TradingView-style candle chart using lightweight-charts (TradingView's MIT
// open-source library). Data is fed from Nad.fun's /trade/chart endpoint via
// the useChart() hook, with DexScreener as fallback inside the proxy.

import { useEffect, useRef } from "react";
import {
  createChart, type IChartApi, type ISeriesApi, type Time,
  CrosshairMode, LineStyle, ColorType,
} from "lightweight-charts";
import { useChart } from "@/lib/nadfun/hooks";
import type { ChartResolution } from "@/lib/nadfun/types";

export function TradingViewChart({
  token, height = 360, resolution = "5", rangeSeconds = 60 * 60 * 6,
}: {
  token: string;
  height?: number;
  resolution?: ChartResolution;
  rangeSeconds?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const { data, isLoading, isError } = useChart(token, { resolution, rangeSeconds });

  // Create chart once
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height,
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
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: "rgba(168,85,247,0.6)", style: LineStyle.Dashed, labelBackgroundColor: "#8b5cf6" },
        horzLine: { color: "rgba(168,85,247,0.6)", style: LineStyle.Dashed, labelBackgroundColor: "#8b5cf6" },
      },
    });
    const candle = chart.addCandlestickSeries({
      upColor: "#22c55e", downColor: "#ef4444",
      borderUpColor: "#22c55e", borderDownColor: "#ef4444",
      wickUpColor: "#22c55e", wickDownColor: "#ef4444",
      priceFormat: { type: "price", precision: 8, minMove: 0.00000001 },
    });
    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: "rgba(168,85,247,0.4)",
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;

    const ro = new ResizeObserver((entries) => {
      for (const e of entries) chart.applyOptions({ width: e.contentRect.width });
    });
    ro.observe(ref.current);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [height]);

  // Feed data when it arrives / updates
  useEffect(() => {
    if (!data || data.s !== "ok") return;
    const candles = data.t.map((t, i) => ({
      time: t as Time,
      open: Number(data.o[i]),
      high: Number(data.h[i]),
      low: Number(data.l[i]),
      close: Number(data.c[i]),
    }));
    const vols = data.t.map((t, i) => ({
      time: t as Time,
      value: Number(data.v[i]),
      color: Number(data.c[i]) >= Number(data.o[i])
        ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)",
    }));
    candleRef.current?.setData(candles);
    volumeRef.current?.setData(vols);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return (
    <div className="relative w-full h-full" style={height > 0 ? { height } : { position: "absolute", inset: 0 }}>
      <div ref={ref} className="absolute inset-0" />
      {isLoading && (
        <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground pointer-events-none">
          Loading chart…
        </div>
      )}
      {isError && (
        <div className="absolute inset-0 grid place-items-center text-xs text-down pointer-events-none">
          Chart unavailable
        </div>
      )}
    </div>
  );
}
