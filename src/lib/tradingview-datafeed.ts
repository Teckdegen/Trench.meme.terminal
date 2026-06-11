// TradingView Charting Library datafeed.
// Bridges Nad.fun's /trade/chart endpoint to the IBasicDataFeed interface
// the library expects.
//
// Docs: https://www.tradingview.com/charting-library-docs/latest/connecting_data/datafeed-api
//
// The library is loaded from /public/charting_library/charting_library.standalone.js
// at runtime (see TradingViewAdvancedChart.tsx). You request the library files
// from TradingView once and drop them in /public.

import { fetchTokenOhlc } from "@/lib/token-index";
import type { BarResponse, ChartResolution } from "@/lib/nadfun/types";

// TradingView resolution string ("1", "5", "15", "60", "240", "1D", "1W") →
// Nad.fun's resolution param.
function tvToNadfunResolution(res: string): ChartResolution {
  switch (res) {
    case "1":   return "1";
    case "5":   return "5";
    case "15":  return "15";
    case "30":  return "30";
    case "60":  return "60";
    case "240": return "240";
    case "D":
    case "1D":  return "1D";
    case "W":
    case "1W":  return "1W";
    case "M":
    case "1M":  return "1M";
    default:    return "5";
  }
}

// One symbol per Monad token. TradingView calls this synchronously, so we
// store the token's basic metadata on the symbol object.
export interface SymbolInfo {
  ticker: string;             // 0x… address
  name: string;
  description: string;
  type: "crypto";
  session: "24x7";
  timezone: "Etc/UTC";
  exchange: "Monad";
  listed_exchange: "Monad";
  format: "price";
  pricescale: number;
  minmov: 1;
  has_intraday: true;
  has_daily: true;
  has_weekly_and_monthly: true;
  supported_resolutions: string[];
  volume_precision: number;
  data_status: "streaming" | "endofday";
}

interface Bar {
  time: number;          // ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// One-shot poller per (token, resolution) for realtime bars. TradingView
// expects us to call `onTick` whenever the latest bar updates.
const liveSubscribers = new Map<string, ReturnType<typeof setInterval>>();

export function makeTradingViewDatafeed(tokenAddress: string, tokenSymbol: string) {
  const datafeed = {
    onReady(cb: (cfg: any) => void) {
      setTimeout(() => cb({
        supported_resolutions: ["1", "5", "15", "30", "60", "240", "1D", "1W"],
        supports_marks: false,
        supports_timescale_marks: false,
        supports_time: true,
        exchanges: [{ value: "Monad", name: "Monad", desc: "Monad mainnet" }],
        symbols_types: [{ name: "Crypto", value: "crypto" }],
      }), 0);
    },

    searchSymbols(
      _userInput: string,
      _exchange: string,
      _symbolType: string,
      onResult: (items: any[]) => void,
    ) {
      // Search is handled by our own Topbar (Dirol), so just echo this token.
      onResult([{
        symbol: tokenSymbol,
        full_name: `Monad:${tokenSymbol}`,
        description: tokenSymbol,
        exchange: "Monad",
        ticker: tokenAddress,
        type: "crypto",
      }]);
    },

    resolveSymbol(
      _symbolName: string,
      onResolve: (info: SymbolInfo) => void,
      _onError: (reason: string) => void,
    ) {
      const info: SymbolInfo = {
        ticker: tokenAddress,
        name: tokenSymbol,
        description: tokenSymbol,
        type: "crypto",
        session: "24x7",
        timezone: "Etc/UTC",
        exchange: "Monad",
        listed_exchange: "Monad",
        format: "price",
        pricescale: 100_000_000,         // 8 decimals — fits most low-cap memes
        minmov: 1,
        has_intraday: true,
        has_daily: true,
        has_weekly_and_monthly: true,
        supported_resolutions: ["1", "5", "15", "30", "60", "240", "1D", "1W"],
        volume_precision: 2,
        data_status: "streaming",
      };
      setTimeout(() => onResolve(info), 0);
    },

    async getBars(
      _symbolInfo: SymbolInfo,
      resolution: string,
      periodParams: { from: number; to: number; countBack: number; firstDataRequest: boolean },
      onHistoryCallback: (bars: Bar[], meta: { noData: boolean }) => void,
      onErrorCallback: (reason: string) => void,
    ) {
      try {
        const data: BarResponse = await fetchTokenOhlc({
          data: {
            token: tokenAddress,
            resolution: tvToNadfunResolution(resolution),
            from: periodParams.from,
            to: periodParams.to,
            countback: periodParams.countBack,
            chart_type: "price_usd",
          },
        });
        if (data.s !== "ok" || data.t.length === 0) {
          onHistoryCallback([], { noData: true });
          return;
        }
        const bars: Bar[] = data.t.map((t, i) => ({
          time: t * 1000,
          open: Number(data.o[i]),
          high: Number(data.h[i]),
          low: Number(data.l[i]),
          close: Number(data.c[i]),
          volume: Number(data.v[i]),
        }));
        onHistoryCallback(bars, { noData: false });
      } catch (e: any) {
        onErrorCallback(e?.message ?? "Failed to load bars");
      }
    },

    subscribeBars(
      symbolInfo: SymbolInfo,
      resolution: string,
      onTick: (bar: Bar) => void,
      subscriberUID: string,
    ) {
      // Poll the most recent bar every ~5 s and push updates.
      // (Nad.fun doesn't expose a streaming OHLCV WebSocket yet, so we poll.
      //  When they ship one, swap this for a WS subscribe.)
      const tick = async () => {
        try {
          const now = Math.floor(Date.now() / 1000);
          const data = await fetchTokenOhlc({
            data: {
              token: symbolInfo.ticker,
              resolution: tvToNadfunResolution(resolution),
              from: now - 60 * 60,
              to: now,
              countback: 2,
              chart_type: "price_usd",
            },
          });
          if (data.s === "ok" && data.t.length > 0) {
            const i = data.t.length - 1;
            onTick({
              time: data.t[i] * 1000,
              open: Number(data.o[i]),
              high: Number(data.h[i]),
              low: Number(data.l[i]),
              close: Number(data.c[i]),
              volume: Number(data.v[i]),
            });
          }
        } catch {}
      };
      const handle = setInterval(tick, 5_000);
      liveSubscribers.set(subscriberUID, handle);
    },

    unsubscribeBars(subscriberUID: string) {
      const h = liveSubscribers.get(subscriberUID);
      if (h) clearInterval(h);
      liveSubscribers.delete(subscriberUID);
    },
  };
  return datafeed;
}
