// Current user's wallet address — shared across every component via a tiny
// in-memory event bus.
//
// The old implementation dispatched a synthetic `StorageEvent` to notify
// listeners, which silently fails: the `storage` event only fires for
// changes in OTHER tabs/windows, never the same one. That meant
// ParaWalletProvider could call setMe(addr) but the Topbar's useMe()
// instance never re-rendered → "wallet not connected" everywhere except
// the place that set it. This rewrite uses a normal EventTarget so all
// instances stay in sync.

import { useEffect, useState } from "react";

const KEY = "monad.me.address";

// Shared bus — one per page load. Components subscribe; setMe broadcasts.
const bus = typeof window !== "undefined" ? new EventTarget() : null;

function readStored(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return localStorage.getItem(KEY) ?? undefined;
}

export function useMe(): string | undefined {
  const [addr, setAddr] = useState<string | undefined>(readStored);

  useEffect(() => {
    if (!bus) return;
    const onLocal = (e: Event) => {
      const next = (e as CustomEvent<string | undefined>).detail;
      setAddr(next);
    };
    // Re-sync once on mount in case setMe() fired before the listener attached
    setAddr(readStored());
    bus.addEventListener("me:change", onLocal);
    // Cross-tab sync via the real storage event
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setAddr(e.newValue ?? undefined);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      bus.removeEventListener("me:change", onLocal);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return addr;
}

export function setMe(address: string | undefined) {
  if (typeof window === "undefined") return;
  const next = address ? address.toLowerCase() : undefined;
  const prev = localStorage.getItem(KEY) ?? undefined;
  if (next) localStorage.setItem(KEY, next);
  else localStorage.removeItem(KEY);
  if (prev === next) return; // no-op
  bus?.dispatchEvent(new CustomEvent("me:change", { detail: next }));
}
