// Trading defaults — slippage, gas priority, quick-buy amounts.
// Mirrors to localStorage for instant reads; syncs to Supabase when enabled.
// Emits `monad:tradeprefs.updated` so every open trade panel picks up changes live.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { SUPABASE_ENABLED } from "@/lib/supabase-hooks";

export type GasPriority = "low" | "med" | "high";

export type TradePrefs = {
  pref_slippage_bps: number;
  pref_gas_priority: GasPriority;
  pref_quick_amounts: number[];
};

export const DEFAULT_TRADE_PREFS: TradePrefs = {
  pref_slippage_bps: 50,
  pref_gas_priority: "med",
  pref_quick_amounts: [50, 500, 2000, 5000],
};

const EVENT = "monad:tradeprefs.updated";
const SLIPPAGE_OPTIONS = [25, 50, 100, 200, 500] as const;

export { SLIPPAGE_OPTIONS };

function storageKey(owner: string) {
  return `monad.tradeprefs.${owner.trim().toLowerCase()}`;
}

function normalize(p: Partial<TradePrefs> | null | undefined): TradePrefs {
  const base = { ...DEFAULT_TRADE_PREFS, ...p };
  const amounts = (base.pref_quick_amounts ?? [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 6);
  return {
    pref_slippage_bps: SLIPPAGE_OPTIONS.includes(base.pref_slippage_bps as typeof SLIPPAGE_OPTIONS[number])
      ? base.pref_slippage_bps
      : DEFAULT_TRADE_PREFS.pref_slippage_bps,
    pref_gas_priority: (["low", "med", "high"] as const).includes(base.pref_gas_priority)
      ? base.pref_gas_priority
      : DEFAULT_TRADE_PREFS.pref_gas_priority,
    pref_quick_amounts: amounts.length > 0 ? amounts : DEFAULT_TRADE_PREFS.pref_quick_amounts,
  };
}

function readLocal(owner: string): TradePrefs {
  if (typeof window === "undefined") return DEFAULT_TRADE_PREFS;
  try {
    const raw = localStorage.getItem(storageKey(owner));
    if (!raw) return DEFAULT_TRADE_PREFS;
    return normalize(JSON.parse(raw) as Partial<TradePrefs>);
  } catch {
    return DEFAULT_TRADE_PREFS;
  }
}

function writeLocal(owner: string, prefs: TradePrefs) {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(owner), JSON.stringify(prefs));
}

export function emitTradePrefsUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT));
  }
}

/** Sync read — safe outside React (e.g. right before a swap). */
export function readTradePrefs(owner: string | undefined): TradePrefs {
  if (!owner) return DEFAULT_TRADE_PREFS;
  return readLocal(owner);
}

async function fetchRemote(owner: string): Promise<TradePrefs | null> {
  if (!SUPABASE_ENABLED) return null;
  const { data } = await supabase()
    .from("accounts")
    .select("pref_slippage_bps, pref_gas_priority, pref_quick_amounts")
    .eq("address", owner)
    .maybeSingle();
  if (!data) return null;
  return normalize(data as Partial<TradePrefs>);
}

async function persistRemote(owner: string, prefs: TradePrefs) {
  if (!SUPABASE_ENABLED) return;
  const addr = owner.trim().toLowerCase();
  const { error } = await supabase()
    .from("accounts")
    .upsert({
      address: addr,
      pref_slippage_bps: prefs.pref_slippage_bps,
      pref_gas_priority: prefs.pref_gas_priority,
      pref_quick_amounts: prefs.pref_quick_amounts,
    }, { onConflict: "address" });
  if (error) throw error;
}

export function useTradePrefs(me: string | undefined) {
  const [prefs, setPrefs] = useState<TradePrefs>(() =>
    me ? readLocal(me) : DEFAULT_TRADE_PREFS,
  );
  const [ready, setReady] = useState(!me);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!me) {
      setPrefs(DEFAULT_TRADE_PREFS);
      setReady(true);
      return;
    }

    const local = readLocal(me);
    setPrefs(local);
    setReady(true);

    const onUpdate = () => setPrefs(readLocal(me));
    window.addEventListener(EVENT, onUpdate);

    const hasStored = typeof window !== "undefined" && !!localStorage.getItem(storageKey(me));
    if (!hasStored) {
      fetchRemote(me)
        .then((remote) => {
          if (remote) {
            writeLocal(me, remote);
            setPrefs(remote);
            emitTradePrefsUpdated();
          }
        })
        .catch(() => {});
    }

    return () => window.removeEventListener(EVENT, onUpdate);
  }, [me]);

  const update = useCallback(
    async (patch: Partial<TradePrefs>) => {
      if (!me) return;
      const next = normalize({ ...readLocal(me), ...patch });
      writeLocal(me, next);
      setPrefs(next);
      emitTradePrefsUpdated();
      setSaving(true);
      try {
        await persistRemote(me, next);
      } catch (e) {
        console.warn("[tradeprefs] remote sync failed — saved locally", e);
      } finally {
        setSaving(false);
      }
    },
    [me],
  );

  return {
    prefs,
    ready,
    saving,
    update,
    slippagePct: prefs.pref_slippage_bps / 100,
    quickAmounts: prefs.pref_quick_amounts,
  };
}
