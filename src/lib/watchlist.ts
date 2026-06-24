// Token watchlist — a per-device list of starred token addresses, kept in
// localStorage and synced across every component (and browser tab) via a tiny
// event bus. No account/Supabase needed; it just follows the browser.

import { useEffect, useMemo, useState } from "react";

const KEY = "trench.watchlist.v1";
const bus = typeof window !== "undefined" ? new EventTarget() : null;

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((a) => typeof a === "string") : [];
  } catch {
    return [];
  }
}

function write(list: string[]) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* quota */ }
  bus?.dispatchEvent(new Event("change"));
}

/** Add/remove a token from the watchlist (most-recent first). */
export function toggleWatch(address: string) {
  const a = address.toLowerCase();
  const list = read();
  const i = list.indexOf(a);
  if (i >= 0) list.splice(i, 1);
  else list.unshift(a);
  write(list);
}

export function isWatched(address: string): boolean {
  return read().includes(address.toLowerCase());
}

/** Reactive watchlist. Returns the ordered list + a Set + helpers. */
export function useWatchlist() {
  const [list, setList] = useState<string[]>(read);

  useEffect(() => {
    if (!bus) return;
    const onChange = () => setList(read());
    bus.addEventListener("change", onChange);
    // Cross-tab sync via the real storage event.
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setList(read()); };
    window.addEventListener("storage", onStorage);
    // Re-sync once on mount in case it changed before the listener attached.
    setList(read());
    return () => {
      bus.removeEventListener("change", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const set = useMemo(() => new Set(list), [list]);
  return {
    list,
    set,
    has: (a: string) => set.has(a.toLowerCase()),
    toggle: toggleWatch,
  };
}
