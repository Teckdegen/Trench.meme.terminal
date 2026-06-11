# TradingView Charting Library

This folder is **empty by default** because TradingView's Advanced Charts library
isn't on npm — they require a one-time email request to grant access.

## How to get it (free, ~3 minutes)

1. Go to https://www.tradingview.com/charting-library-docs/latest/getting_started/
2. Fill in the form ("I want to use it for: trading interface for Monad mainnet").
3. They email you back within a few hours with a private GitHub repo invite.
4. Clone that repo, take the `charting_library/` folder, and copy its contents
   into THIS folder. The structure should end up as:

   ```
   public/charting_library/
     charting_library.standalone.js
     charting_library.esm.js
     bundles/
       …many files…
   ```

5. Restart the dev server. Reload the token page. The chart upgrades from
   `lightweight-charts` to the full TradingView Advanced Charts UI — toolbar,
   indicators, drawings, the works.

## Verifying

Open browser devtools → Network → reload `/token/0x<any-real-token>`. You should
see a 200 response for `/charting_library/charting_library.standalone.js`.

If it's 404, the file isn't there — and the chart stays on the lightweight
fallback (still real Nad.fun data, just minimal UI).

## What the datafeed does

`src/lib/tradingview-datafeed.ts` bridges TradingView's expected `IBasicDataFeed`
to our `fetchChart()` server function which hits Nad.fun's `/trade/chart`. So
all symbols, timeframes, indicators in the TradingView UI render off the same
candle data the lightweight version uses.

Realtime bars are polled every 5 seconds. When Nad.fun ships an OHLCV
WebSocket, swap `setInterval` in `subscribeBars()` for a WS subscribe.

## License

You self-host TradingView's files under their free Charting Library license.
Read it once at the URL above. Short version: free for trading interfaces,
keep their attribution, don't repackage and resell the library itself.
