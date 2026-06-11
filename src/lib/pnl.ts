// Shared PnL window keys and UI mapping (used by frontend + bot worker).

export const PNL_WINDOWS = [
  { key: "24H", seconds: 86_400 },
  { key: "7D", seconds: 86_400 * 7 },
  { key: "30D", seconds: 86_400 * 30 },
  { key: "90D", seconds: 86_400 * 90 },
  { key: "180D", seconds: 86_400 * 180 },
  { key: "1Y", seconds: 86_400 * 365 },
  { key: "ALL", seconds: null as number | null },
] as const;

export type PnlWindowKey = (typeof PNL_WINDOWS)[number]["key"];

export type PnlTrade = {
  token_address: string;
  side: "BUY" | "SELL";
  token_amount: string;
  value_usd: number | null;
  created_at_chain: string;
};

export type TokenPosition = {
  bal: number;
  avgCost: number;
  realized: number;
  volume: number;
  trades: number;
  sells: number;
  wins: number;
  bestUsd: number;
  bestTok: string;
  worstUsd: number;
  worstTok: string;
};

export type WindowRollup = {
  realized: number;
  volume: number;
  trades: number;
  sells: number;
  wins: number;
  bestUsd: number;
  bestTok: string;
  worstUsd: number;
  worstTok: string;
};

export function emptyWindowRollup(): WindowRollup {
  return {
    realized: 0,
    volume: 0,
    trades: 0,
    sells: 0,
    wins: 0,
    bestUsd: 0,
    bestTok: "",
    worstUsd: 0,
    worstTok: "",
  };
}

export function emptyPosition(token: string): TokenPosition {
  return {
    bal: 0,
    avgCost: 0,
    realized: 0,
    volume: 0,
    trades: 0,
    sells: 0,
    wins: 0,
    bestUsd: 0,
    bestTok: token,
    worstUsd: 0,
    worstTok: token,
  };
}

export function tradeInWindow(
  createdAtChain: string,
  seconds: number | null,
  now = Date.now(),
): boolean {
  if (seconds == null) return true;
  return new Date(createdAtChain).getTime() >= now - seconds * 1000;
}

export function cutoffForWindow(
  key: PnlWindowKey,
  now = Date.now(),
): Date | null {
  const w = PNL_WINDOWS.find((x) => x.key === key);
  if (!w || w.seconds == null) return null;
  return new Date(now - w.seconds * 1000);
}

export function cutoffMsForWindow(key: PnlWindowKey, now = Date.now()): number | null {
  const w = PNL_WINDOWS.find((x) => x.key === key);
  if (!w || w.seconds == null) return null;
  return now - w.seconds * 1000;
}

/** Map Smart Money UI range labels to pnl_snapshots.window keys. */
export function uiRangeToPnlWindow(range: string): PnlWindowKey {
  if (range === "All") return "ALL";
  if (range === "1Y") return "1Y";
  return range as PnlWindowKey;
}

export function winRatePct(wins: number, sells: number): number | null {
  if (sells <= 0) return null;
  return (wins / sells) * 100;
}

/**
 * Walk trades in time order: maintain cost basis, accumulate all-time positions,
 * and per-window rollups (realized only on sells inside each window).
 */
export function computePnlFromTrades(trades: PnlTrade[]) {
  const positions = new Map<string, TokenPosition>();
  const byWindow = new Map<PnlWindowKey, WindowRollup>();
  for (const w of PNL_WINDOWS) byWindow.set(w.key, emptyWindowRollup());

  const sorted = [...trades].sort(
    (a, b) => new Date(a.created_at_chain).getTime() - new Date(b.created_at_chain).getTime(),
  );

  for (const t of sorted) {
    const tok = t.token_address;
    const p = positions.get(tok) ?? emptyPosition(tok);
    const amt = Number(t.token_amount) / 1e18;
    const usd = Number(t.value_usd ?? 0);
    const absUsd = Math.abs(usd);

    p.volume += absUsd;
    p.trades += 1;

    let tradePnl = 0;
    if (t.side === "BUY") {
      const newBal = p.bal + amt;
      if (newBal > 0) p.avgCost = ((p.bal * p.avgCost) + usd) / newBal;
      p.bal = newBal;
    } else {
      const cost = amt * p.avgCost;
      tradePnl = usd - cost;
      p.realized += tradePnl;
      p.bal = Math.max(0, p.bal - amt);
      p.sells += 1;
      if (tradePnl > 0) p.wins += 1;
      if (tradePnl > p.bestUsd) {
        p.bestUsd = tradePnl;
        p.bestTok = tok;
      }
      if (tradePnl < p.worstUsd) {
        p.worstUsd = tradePnl;
        p.worstTok = tok;
      }
    }
    positions.set(tok, p);

    for (const w of PNL_WINDOWS) {
      if (!tradeInWindow(t.created_at_chain, w.seconds)) continue;
      const roll = byWindow.get(w.key)!;
      roll.volume += absUsd;
      roll.trades += 1;
      if (t.side === "SELL") {
        roll.realized += tradePnl;
        roll.sells += 1;
        if (tradePnl > 0) roll.wins += 1;
        if (tradePnl > roll.bestUsd) {
          roll.bestUsd = tradePnl;
          roll.bestTok = tok;
        }
        if (tradePnl < roll.worstUsd) {
          roll.worstUsd = tradePnl;
          roll.worstTok = tok;
        }
      }
    }
  }

  return { positions, byWindow };
}

/** Per-token realized PnL for sells that fall inside a time window (cost basis from full history). */
export function tokenRealizedInWindow(
  trades: PnlTrade[],
  windowKey: PnlWindowKey,
): Map<string, number> {
  const cutoff = cutoffForWindow(windowKey);
  const positions = new Map<string, { bal: number; avgCost: number }>();
  const realized = new Map<string, number>();

  const sorted = [...trades].sort(
    (a, b) => new Date(a.created_at_chain).getTime() - new Date(b.created_at_chain).getTime(),
  );

  for (const t of sorted) {
    const tok = t.token_address;
    const st = positions.get(tok) ?? { bal: 0, avgCost: 0 };
    const amt = Number(t.token_amount) / 1e18;
    const usd = Number(t.value_usd ?? 0);
    const at = new Date(t.created_at_chain);

    if (t.side === "BUY") {
      const newBal = st.bal + amt;
      if (newBal > 0) st.avgCost = ((st.bal * st.avgCost) + usd) / newBal;
      st.bal = newBal;
    } else {
      const tradePnl = usd - amt * st.avgCost;
      st.bal = Math.max(0, st.bal - amt);
      if (!cutoff || at >= cutoff) {
        realized.set(tok, (realized.get(tok) ?? 0) + tradePnl);
      }
    }
    positions.set(tok, st);
  }

  return realized;
}

export function unrealizedUsd(bal: number, avgCost: number, priceUsd: number): number {
  if (bal <= 0 || priceUsd <= 0) return 0;
  return bal * priceUsd - bal * avgCost;
}
