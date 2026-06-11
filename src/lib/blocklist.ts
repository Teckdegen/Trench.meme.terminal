// Private blocklist — only visible to the signed-in wallet (you).
// Syncs to Supabase when enabled; always mirrors to localStorage for instant reads.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { SUPABASE_ENABLED } from "@/lib/supabase-hooks";

export type BlocklistEntry = {
  address: string;
  note: string | null;
  createdAt: string;
};

export type BlocklistSnapshot = {
  wallets: BlocklistEntry[];
  tokens: BlocklistEntry[];
};

export type TokenBlockCheck = {
  tokenBlocked: boolean;
  launcherBlocked: boolean;
  tokenEntry: BlocklistEntry | null;
  launcherEntry: BlocklistEntry | null;
};

const EVENT = "monad:blocklist.updated";
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

export const BLOCKLIST_LIMIT = 1500;

export function normAddr(a: string) {
  return a.trim().toLowerCase();
}

export function isValidAddr(a: string) {
  return ADDR_RE.test(a.trim());
}

function storageKey(owner: string) {
  return `monad.blocklist.${normAddr(owner)}`;
}

function readLocal(owner: string): BlocklistSnapshot {
  if (typeof window === "undefined") return { wallets: [], tokens: [] };
  try {
    const raw = localStorage.getItem(storageKey(owner));
    if (!raw) return { wallets: [], tokens: [] };
    const parsed = JSON.parse(raw) as BlocklistSnapshot;
    return {
      wallets: parsed.wallets ?? [],
      tokens: parsed.tokens ?? [],
    };
  } catch {
    return { wallets: [], tokens: [] };
  }
}

function writeLocal(owner: string, snap: BlocklistSnapshot) {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(owner), JSON.stringify(snap));
}

export function emitBlocklistUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT));
  }
}

async function fetchRemote(owner: string): Promise<BlocklistSnapshot | null> {
  if (!SUPABASE_ENABLED) return null;
  const sb = supabase();
  const ownerLc = normAddr(owner);
  const [wRes, tRes] = await Promise.all([
    sb.from("user_blocklist_wallets")
      .select("wallet_address, note, created_at")
      .eq("owner_address", ownerLc)
      .order("created_at", { ascending: false }),
    sb.from("user_blocklist_tokens")
      .select("token_address, note, created_at")
      .eq("owner_address", ownerLc)
      .order("created_at", { ascending: false }),
  ]);
  if (wRes.error || tRes.error) return null;
  return {
    wallets: (wRes.data ?? []).map((r) => ({
      address: r.wallet_address as string,
      note: (r.note as string | null) ?? null,
      createdAt: r.created_at as string,
    })),
    tokens: (tRes.data ?? []).map((r) => ({
      address: r.token_address as string,
      note: (r.note as string | null) ?? null,
      createdAt: r.created_at as string,
    })),
  };
}

async function persistRemote(
  owner: string,
  kind: "wallet" | "token",
  address: string,
  note: string | null,
  op: "add" | "remove",
) {
  if (!SUPABASE_ENABLED) return;
  const sb = supabase();
  const ownerLc = normAddr(owner);
  const addrLc = normAddr(address);
  await sb.from("accounts").upsert({ address: ownerLc }, { onConflict: "address" });
  if (kind === "wallet") {
    if (op === "add") {
      await sb.from("user_blocklist_wallets").upsert({
        owner_address: ownerLc,
        wallet_address: addrLc,
        note,
      });
    } else {
      await sb.from("user_blocklist_wallets").delete()
        .eq("owner_address", ownerLc)
        .eq("wallet_address", addrLc);
    }
  } else if (op === "add") {
    await sb.from("user_blocklist_tokens").upsert({
      owner_address: ownerLc,
      token_address: addrLc,
      note,
    });
  } else {
    await sb.from("user_blocklist_tokens").delete()
      .eq("owner_address", ownerLc)
      .eq("token_address", addrLc);
  }
}

export function checkTokenAgainstBlocklist(
  snap: BlocklistSnapshot,
  tokenAddress: string,
  creatorAddress?: string | null,
): TokenBlockCheck {
  const tok = normAddr(tokenAddress);
  const tokenEntry = snap.tokens.find((e) => normAddr(e.address) === tok) ?? null;
  const creator = creatorAddress ? normAddr(creatorAddress) : null;
  const launcherEntry = creator
    ? snap.wallets.find((e) => normAddr(e.address) === creator) ?? null
    : null;
  return {
    tokenBlocked: !!tokenEntry,
    launcherBlocked: !!launcherEntry,
    tokenEntry,
    launcherEntry,
  };
}

export function useBlocklist(owner: string | undefined) {
  const [snap, setSnap] = useState<BlocklistSnapshot>({ wallets: [], tokens: [] });
  const [loading, setLoading] = useState(true);

  const applyLocal = useCallback(() => {
    if (!owner) return;
    setSnap(readLocal(owner));
  }, [owner]);

  useEffect(() => {
    if (!owner) {
      setSnap({ wallets: [], tokens: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    const local = readLocal(owner);
    setSnap(local);
    fetchRemote(owner).then((remote) => {
      // Only seed from remote when local is empty — never wipe local adds
      // (Supabase RLS may block writes; localStorage is source of truth).
      if (remote && local.wallets.length === 0 && local.tokens.length === 0) {
        setSnap(remote);
        writeLocal(owner, remote);
      }
      setLoading(false);
    });
    window.addEventListener(EVENT, applyLocal);
    return () => window.removeEventListener(EVENT, applyLocal);
  }, [owner, applyLocal]);

  const walletSet = new Set(snap.wallets.map((w) => normAddr(w.address)));
  const tokenSet = new Set(snap.tokens.map((t) => normAddr(t.address)));

  const mutate = useCallback(
    async (
      kind: "wallet" | "token",
      address: string,
      op: "add" | "remove",
      note?: string | null,
    ) => {
      if (!owner || !isValidAddr(address)) return false;
      const current = readLocal(owner);
      if (op === "add" && current.wallets.length + current.tokens.length >= BLOCKLIST_LIMIT) return false;
      const addrLc = normAddr(address);
      const next: BlocklistSnapshot = {
        wallets: [...current.wallets],
        tokens: [...current.tokens],
      };
      const list = kind === "wallet" ? next.wallets : next.tokens;
      const idx = list.findIndex((e) => normAddr(e.address) === addrLc);
      if (op === "add") {
        const entry: BlocklistEntry = {
          address: addrLc,
          note: note?.trim() || null,
          createdAt: new Date().toISOString(),
        };
        if (idx >= 0) list[idx] = entry;
        else list.unshift(entry);
      } else if (idx >= 0) {
        list.splice(idx, 1);
      }
      writeLocal(owner, next);
      setSnap(next);
      emitBlocklistUpdated();
      try {
        await persistRemote(owner, kind, addrLc, note?.trim() || null, op);
      } catch (e) {
        console.warn("[blocklist] remote sync failed — saved locally", e);
      }
      return true;
    },
    [owner],
  );

  const replaceAll = useCallback(
    async (next: BlocklistSnapshot) => {
      if (!owner) return false;
      if (next.wallets.length + next.tokens.length > BLOCKLIST_LIMIT) return false;
      const capped: BlocklistSnapshot = {
        wallets: next.wallets,
        tokens: next.tokens,
      };
      setSnap(capped);
      writeLocal(owner, capped);
      emitBlocklistUpdated();
      if (!SUPABASE_ENABLED) return true;
      const sb = supabase();
      const ownerLc = normAddr(owner);
      await sb.from("accounts").upsert({ address: ownerLc }, { onConflict: "address" });
      await sb.from("user_blocklist_wallets").delete().eq("owner_address", ownerLc);
      await sb.from("user_blocklist_tokens").delete().eq("owner_address", ownerLc);
      if (capped.wallets.length) {
        await sb.from("user_blocklist_wallets").upsert(
          capped.wallets.map((w) => ({
            owner_address: ownerLc,
            wallet_address: normAddr(w.address),
            note: w.note,
          })),
        );
      }
      if (capped.tokens.length) {
        await sb.from("user_blocklist_tokens").upsert(
          capped.tokens.map((t) => ({
            owner_address: ownerLc,
            token_address: normAddr(t.address),
            note: t.note,
          })),
        );
      }
      return true;
    },
    [owner],
  );

  const clearAll = useCallback(async () => {
    return replaceAll({ wallets: [], tokens: [] });
  }, [replaceAll]);

  const importSnapshot = useCallback(
    async (incoming: BlocklistSnapshot, mode: "merge" | "replace") => {
      if (!owner) return false;
      const merged: BlocklistSnapshot = mode === "replace"
        ? incoming
        : {
            wallets: [...snap.wallets],
            tokens: [...snap.tokens],
          };
      if (mode === "merge") {
        for (const w of incoming.wallets) {
          if (!merged.wallets.some((x) => normAddr(x.address) === normAddr(w.address))) {
            merged.wallets.unshift(w);
          }
        }
        for (const t of incoming.tokens) {
          if (!merged.tokens.some((x) => normAddr(x.address) === normAddr(t.address))) {
            merged.tokens.unshift(t);
          }
        }
      }
      if (merged.wallets.length + merged.tokens.length > BLOCKLIST_LIMIT) {
        return false;
      }
      return replaceAll(merged);
    },
    [owner, snap, replaceAll],
  );

  const totalCount = snap.wallets.length + snap.tokens.length;

  return {
    loading,
    snap,
    wallets: snap.wallets,
    tokens: snap.tokens,
    totalCount,
    walletSet,
    tokenSet,
    isWalletBlocked: (a: string) => walletSet.has(normAddr(a)),
    isTokenBlocked: (a: string) => tokenSet.has(normAddr(a)),
    blockWallet: (a: string, note?: string) => mutate("wallet", a, "add", note),
    unblockWallet: (a: string) => mutate("wallet", a, "remove"),
    blockToken: (a: string, note?: string) => mutate("token", a, "add", note),
    unblockToken: (a: string) => mutate("token", a, "remove"),
    checkToken: (token: string, creator?: string | null) =>
      checkTokenAgainstBlocklist(snap, token, creator),
    refresh: applyLocal,
    clearAll,
    importSnapshot,
    replaceAll,
  };
}

/** Session-only dismiss of token-page warnings (per token). */
export function dismissTokenWarning(tokenAddress: string) {
  if (typeof window === "undefined") return;
  const key = `monad.blocklist.dismiss.${normAddr(tokenAddress)}`;
  sessionStorage.setItem(key, "1");
}

export function isTokenWarningDismissed(tokenAddress: string) {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(`monad.blocklist.dismiss.${normAddr(tokenAddress)}`) === "1";
}

export type BlocklistFilter = "all" | "dev" | "ca";

export type UnifiedBlocklistRow = {
  id: string;
  address: string;
  kind: "dev" | "ca";
  note: string | null;
  createdAt: string;
};

export function mergeBlocklistRows(snap: BlocklistSnapshot): UnifiedBlocklistRow[] {
  const rows: UnifiedBlocklistRow[] = [
    ...snap.wallets.map((w) => ({
      id: `dev:${normAddr(w.address)}`,
      address: w.address,
      kind: "dev" as const,
      note: w.note,
      createdAt: w.createdAt,
    })),
    ...snap.tokens.map((t) => ({
      id: `ca:${normAddr(t.address)}`,
      address: t.address,
      kind: "ca" as const,
      note: t.note,
      createdAt: t.createdAt,
    })),
  ];
  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return rows;
}

export function exportBlocklistJson(snap: BlocklistSnapshot): string {
  return JSON.stringify(
    { version: 1, exportedAt: new Date().toISOString(), wallets: snap.wallets, tokens: snap.tokens },
    null,
    2,
  );
}

export function parseBlocklistImport(raw: string): BlocklistSnapshot | null {
  try {
    const data = JSON.parse(raw) as {
      wallets?: BlocklistEntry[];
      tokens?: BlocklistEntry[];
    };
    const wallets = (data.wallets ?? [])
      .filter((e) => isValidAddr(e.address))
      .map((e) => ({
        address: normAddr(e.address),
        note: e.note ?? null,
        createdAt: e.createdAt ?? new Date().toISOString(),
      }));
    const tokens = (data.tokens ?? [])
      .filter((e) => isValidAddr(e.address))
      .map((e) => ({
        address: normAddr(e.address),
        note: e.note ?? null,
        createdAt: e.createdAt ?? new Date().toISOString(),
      }));
    return { wallets, tokens };
  } catch {
    return null;
  }
}

/** Guess CA vs dev when adding from the "All" filter. */
export async function inferBlocklistKind(address: string): Promise<"dev" | "ca"> {
  if (!SUPABASE_ENABLED) return "dev";
  const { data } = await supabase()
    .from("tokens")
    .select("address")
    .eq("address", normAddr(address))
    .maybeSingle();
  return data ? "ca" : "dev";
}
