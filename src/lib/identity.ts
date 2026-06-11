// Handle-first identity: default handle is the wallet address; UI shortens it.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { SUPABASE_ENABLED } from "@/lib/supabase-hooks";
import { formatHandleLabel, isWalletAddress } from "@/lib/handles";

export type AccountIdentity = {
  address: string;
  handle: string | null;
  display_name: string | null;
  image_uri?: string | null;
};

const cache = new Map<string, AccountIdentity>();
const inflight = new Map<string, Promise<void>>();
let version = 0;
const subs = new Set<() => void>();

function bump() {
  version += 1;
  subs.forEach((fn) => fn());
}

// ─────────── Live profile patches ───────────────────────────────────
// Optimistic updates after Edit Profile + listeners for full-profile hooks.
const profileBus = typeof window !== "undefined" ? new EventTarget() : null;

export type IdentityPatch = Partial<
  Pick<AccountIdentity, "handle" | "display_name" | "image_uri">
>;

/** Immediately refresh every <Handle> / <UserAvatar> for this wallet. */
export function patchIdentity(address: string, patch: IdentityPatch) {
  const addr = address.toLowerCase();
  const prev = cache.get(addr) ?? { address: addr, handle: null, display_name: null };
  cache.set(addr, {
    ...prev,
    ...patch,
    address: addr,
  });
  bump();
  profileBus?.dispatchEvent(
    new CustomEvent("profile:patch", { detail: { address: addr, patch } }),
  );
}

export function subscribeIdentityPatches(
  cb: (address: string, patch: IdentityPatch) => void,
): () => void {
  if (!profileBus) return () => {};
  const fn = (e: Event) => {
    const { address, patch } = (e as CustomEvent<{ address: string; patch: IdentityPatch }>).detail;
    cb(address, patch);
  };
  profileBus.addEventListener("profile:patch", fn);
  return () => profileBus.removeEventListener("profile:patch", fn);
}

function mergeAccountRow(addr: string, row: Partial<AccountIdentity>): AccountIdentity {
  const prev = cache.get(addr);
  return {
    address: addr,
    handle: row.handle !== undefined ? (row.handle ?? null) : (prev?.handle ?? null),
    display_name:
      row.display_name !== undefined ? (row.display_name ?? null) : (prev?.display_name ?? null),
    image_uri:
      row.image_uri !== undefined ? (row.image_uri ?? null) : (prev?.image_uri ?? null),
  };
}

function applyAccountRow(addr: string, row: Partial<AccountIdentity>, deleted = false) {
  if (deleted) {
    cache.delete(addr);
    bump();
    return;
  }
  const merged = mergeAccountRow(addr, row);
  cache.set(addr, merged);
  bump();
  profileBus?.dispatchEvent(
    new CustomEvent("profile:patch", {
      detail: {
        address: addr,
        patch: {
          handle: merged.handle,
          display_name: merged.display_name,
          image_uri: merged.image_uri,
        },
      },
    }),
  );
}

// ─────────── Realtime invalidation ──────────────────────────────────
// One global Supabase channel listens for any update on `accounts`.
// Merges partial realtime payloads so a display_name-only UPDATE doesn't
// wipe handle/image_uri. Started lazily on first identity fetch.
let realtimeStarted = false;
function startRealtime() {
  if (realtimeStarted || typeof window === "undefined" || !SUPABASE_ENABLED) return;
  realtimeStarted = true;
  const sb = supabase();
  sb.channel(`identity:accounts:${Math.random().toString(36).slice(2, 10)}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "accounts" },
      (payload: any) => {
        const row =
          (payload?.new as Partial<AccountIdentity> | undefined) ??
          (payload?.old as Partial<AccountIdentity> | undefined);
        const addr = row?.address?.toLowerCase();
        if (!addr) return;
        const isNew = payload.eventType === "INSERT";
        if (!cache.has(addr) && !isNew) return;
        if (payload.eventType === "DELETE") {
          applyAccountRow(addr, {}, true);
          return;
        }
        if (payload?.new) {
          applyAccountRow(addr, payload.new as Partial<AccountIdentity>);
        }
      },
    )
    .subscribe();
}

function subscribe(cb: () => void) {
  subs.add(cb);
  return () => subs.delete(cb);
}

function getSnapshot() {
  return version;
}

export function getCachedIdentity(address: string | undefined): AccountIdentity | undefined {
  if (!address) return undefined;
  return cache.get(address.toLowerCase());
}

/** User-visible label — shortens wallet handles, never a full 0x… string. */
export function labelFor(id: AccountIdentity | undefined, opts?: { at?: boolean }): string {
  if (!id) return "…";
  if (id.handle) return formatHandleLabel(id.handle, opts);
  if (id.display_name) return id.display_name;
  if (isWalletAddress(id.address)) return formatHandleLabel(id.address, opts);
  return "…";
}

/** Profile route param — handle only (no address in URLs). */
export function profileSlug(id: AccountIdentity | undefined): string | null {
  return id?.handle?.toLowerCase() ?? null;
}

/** Spread-friendly Link target for a profile page. Saves callers from
 *  repeating the `to + params` boilerplate (and centralises the path so
 *  the route can be renamed in one place). Usage:
 *    <Link {...profileRoute("alice")}>…</Link>
 */
export function profileRoute(handle: string) {
  const slug = handle.replace(/^@/, "").toLowerCase();
  if (isWalletAddress(slug)) {
    return {
      to: "/profile/$username" as const,
      params: { username: slug },
    };
  }
  return {
    to: "/@{$handle}" as const,
    params: { handle: slug },
  };
}

/** Normalize @handle or 0x… input to wallet address (backend). */
export async function resolveToAddress(input: string): Promise<string | null> {
  const raw = input.replace(/^@/, "").trim();
  if (!raw) return null;
  if (/^0x[a-fA-F0-9]{40}$/.test(raw)) return raw.toLowerCase();
  if (!SUPABASE_ENABLED) return null;
  const { data } = await supabase()
    .from("accounts")
    .select("address")
    .ilike("handle", raw.toLowerCase())
    .maybeSingle();
  return (data as { address?: string } | null)?.address?.toLowerCase() ?? null;
}

export async function fetchIdentities(addresses: string[]): Promise<void> {
  startRealtime();        // lazy-start the global accounts channel
  const uniq = [...new Set(addresses.map((a) => a.toLowerCase()).filter((a) => /^0x[a-f0-9]{40}$/.test(a)))];
  const missing = uniq.filter((a) => !cache.has(a));
  if (!missing.length) return;

  const key = missing.sort().join(",");
  if (inflight.has(key)) return inflight.get(key)!;

  const job = (async () => {
    if (SUPABASE_ENABLED) {
      const { data } = await supabase()
        .from("accounts")
        .select("address, handle, display_name, image_uri")
        .in("address", missing);
      for (const row of (data ?? []) as AccountIdentity[]) {
        cache.set(row.address.toLowerCase(), mergeAccountRow(row.address.toLowerCase(), row));
      }
    }
    for (const a of missing) {
      if (!cache.has(a)) {
        cache.set(a, { address: a, handle: null, display_name: null });
      }
    }
    bump();
  })().finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}

export function useIdentity(address: string | undefined): AccountIdentity | undefined {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!address) return;
    fetchIdentities([address]);
  }, [address?.toLowerCase()]);

  return address ? cache.get(address.toLowerCase()) : undefined;
}

export function useIdentities(addresses: string[]): Record<string, AccountIdentity> {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const key = useMemo(
    () => [...new Set(addresses.map((a) => a.toLowerCase()).filter(Boolean))].sort().join(","),
    [addresses.join(",")],
  );

  useEffect(() => {
    const list = key ? key.split(",") : [];
    if (list.length) fetchIdentities(list);
  }, [key]);

  return useMemo(() => {
    const out: Record<string, AccountIdentity> = {};
    for (const a of addresses) {
      const lc = a?.toLowerCase();
      if (!lc) continue;
      const hit = cache.get(lc);
      if (hit) out[lc] = hit;
    }
    return out;
  }, [addresses, version]);
}

/** Batch-resolve handles for rows with an address field. */
export async function enrichWithHandles<T extends { author_address?: string; account_address?: string }>(
  rows: T[],
): Promise<(T & { author_handle: string | null })[]> {
  const addrs = rows.map((r) => (r.author_address ?? r.account_address ?? "").toLowerCase()).filter(Boolean);
  await fetchIdentities(addrs);
  return rows.map((r) => {
    const addr = (r.author_address ?? r.account_address ?? "").toLowerCase();
    const id = cache.get(addr);
    return { ...r, author_handle: id?.handle ?? null };
  });
}
