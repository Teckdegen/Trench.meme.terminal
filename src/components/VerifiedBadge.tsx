// Verification badge — shown inline at the end of display names when an
// account is verified. Backend-controlled: flip accounts.is_verified
// to true in Supabase and it appears everywhere automatically.

import { useEffect, useState } from "react";
import { VERIFIED_BADGE } from "@/lib/brand";
import { supabase } from "@/lib/supabase";
import { SUPABASE_ENABLED } from "@/lib/supabase-hooks";

/**
 * Render the badge if `verified` is true. Pass either:
 *   * verified={boolean} when you already know the state, or
 *   * address={"0x…"} to look it up automatically.
 *
 * Omit `size` to match one letter of the surrounding text (1em). Pass a
 * number only when the badge sits outside a text-sized container.
 */
export function VerifiedBadge({
  verified, address, size, className = "",
}: {
  verified?: boolean;
  address?: string;
  size?: number;
  className?: string;
}) {
  const lookup = useIsVerified(verified === undefined ? address : undefined);
  const show = verified ?? lookup;
  if (!show) return null;

  // The hosted PNG is mostly empty padding — the glyph is ~25% of the
  // canvas. Scale it up inside a clip so the visible badge matches
  // ~85% of one letter height, with a small gap after the name.
  const ZOOM = 4;
  const SCALE = 0.85;
  const box =
    size != null
      ? { width: size * SCALE, height: size * SCALE }
      : { width: `${SCALE}em`, height: `${SCALE}em` };
  const glyph =
    size != null
      ? { height: size * SCALE * ZOOM, width: "auto" as const }
      : { height: `${SCALE * ZOOM}em`, width: "auto" as const };

  return (
    <span
      title="Verified"
      className={`inline-flex items-center justify-center shrink-0 overflow-hidden rounded-full align-text-bottom ml-[0.18em] ${className}`}
      style={box}
    >
      <img
        src={VERIFIED_BADGE}
        alt="Verified"
        draggable={false}
        className="max-w-none pointer-events-none"
        style={glyph}
      />
    </span>
  );
}

// Lightweight cache so the same address isn't re-queried by every component
const cache = new Map<string, boolean>();
const subs = new Map<string, Set<(v: boolean) => void>>();

function useIsVerified(address: string | undefined): boolean {
  const [v, setV] = useState<boolean>(address ? cache.get(address.toLowerCase()) ?? false : false);

  useEffect(() => {
    if (!address || !SUPABASE_ENABLED) return;
    const key = address.toLowerCase();
    const cached = cache.get(key);
    if (cached !== undefined) { setV(cached); return; }

    const set = subs.get(key) ?? new Set();
    const handler = (val: boolean) => setV(val);
    set.add(handler);
    const isFirst = set.size === 1;
    subs.set(key, set);

    if (isFirst) {
      supabase()
        .from("accounts")
        .select("is_verified")
        .eq("address", key)
        .maybeSingle()
        .then(({ data }) => {
          const value = !!(data as any)?.is_verified;
          cache.set(key, value);
          for (const h of subs.get(key) ?? []) h(value);
          subs.delete(key);
        });
    }

    return () => {
      set.delete(handler);
      if (set.size === 0) subs.delete(key);
    };
  }, [address]);

  return v;
}
