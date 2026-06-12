// Zerion API client — fetches wallet positions (token balances + USD values)
// directly from Zerion's portfolio indexer, which reads the chain in real
// time. No reliance on our Supabase `position_snapshots` (which lags
// behind chain state by however long the PnL worker took to catch up).
//
// Auth: HTTP Basic with the API key as the username and an empty password.
// Get a key at https://developers.zerion.io — set ZERION_API_KEY on Vercel.
//
// Monad support: Zerion's `chain_ids` filter accepts string slugs like
// "monad". If Zerion hasn't shipped Monad yet, the endpoint returns
// either an empty `data: []` or a 400. We handle both gracefully — the
// frontend hook falls back to its multicall path so users never see a
// blank wallet page.

import { createServerFn } from "@tanstack/react-start";

export type ZerionPosition = {
  address: string;            // token contract — lowercase
  symbol: string;
  name: string;
  decimals: number;
  imageUri: string | null;
  balance: number;            // human-readable
  balanceRaw: string;         // wei string
  priceUsd: number | null;
  valueUsd: number | null;
  chainId: string;            // "monad", "ethereum", etc.
};

export type ZerionTransaction = {
  id: string;
  hash: string;
  direction: "in" | "out" | "self" | "unknown";
  type: string;
  minedAt: string | null;
  status: string | null;
  title: string;
  subtitle: string;
  valueUsd: number | null;
  changes: Array<{
    address: string | null;
    symbol: string;
    name: string;
    imageUri: string | null;
    amount: number | null;
    amountRaw: string | null;
    valueUsd: number | null;
  }>;
};

const ZERION_BASE = "https://api.zerion.io/v1";
const CHAIN_SLUG = process.env.ZERION_CHAIN_SLUG ?? "monad";

function authHeader() {
  const key = process.env.ZERION_API_KEY ?? "";
  if (!key) return null;
  // Basic auth: base64(`<key>:`) — key is username, password empty
  const token = Buffer.from(`${key}:`).toString("base64");
  return `Basic ${token}`;
}

export const fetchZerionPositions = createServerFn({ method: "GET" })
  .inputValidator((d: { address: string }) => d)
  .handler(async ({ data }): Promise<{ positions: ZerionPosition[]; source: "zerion" | "empty" }> => {
    const auth = authHeader();
    if (!auth) {
      return { positions: [], source: "empty" };
    }
    const addr = data.address.toLowerCase();
    const url = `${ZERION_BASE}/wallets/${addr}/positions/?filter[chain_ids]=${CHAIN_SLUG}&filter[positions]=only_simple&filter[trash]=only_non_trash&sort=value`;
    try {
      const r = await fetch(url, {
        headers: {
          Authorization: auth,
          Accept: "application/json",
        },
      });
      if (!r.ok) {
        // 401 = bad key, 400 = unsupported chain, etc. Surface zero so
        // the hook falls back to its on-chain multicall path.
        console.warn(`[zerion] ${addr} → ${r.status}`);
        return { positions: [], source: "empty" };
      }
      const json: any = await r.json();
      const rows = Array.isArray(json?.data) ? json.data : [];
      const positions: ZerionPosition[] = rows.map((p: any) => {
        const a = p.attributes ?? {};
        const fi = a.fungible_info ?? {};
        const impl = (fi.implementations ?? []).find((i: any) => i.chain_id === CHAIN_SLUG)
          ?? fi.implementations?.[0]
          ?? {};
        return {
          address: (impl.address ?? "").toLowerCase(),
          symbol: fi.symbol ?? "?",
          name: fi.name ?? "",
          decimals: Number(impl.decimals ?? 18),
          imageUri: fi.icon?.url ?? null,
          balance: Number(a.quantity?.float ?? 0),
          balanceRaw: String(a.quantity?.int ?? "0"),
          priceUsd: a.price != null ? Number(a.price) : null,
          valueUsd: a.value != null ? Number(a.value) : null,
          chainId: impl.chain_id ?? CHAIN_SLUG,
        };
      }).filter((p: ZerionPosition) => p.balance > 0 && /^0x[a-f0-9]{40}$/.test(p.address));
      return { positions, source: "zerion" };
    } catch (e) {
      console.warn("[zerion] fetch failed:", e);
      return { positions: [], source: "empty" };
    }
  });

export const fetchZerionTransactions = createServerFn({ method: "GET" })
  .inputValidator((d: { address: string; limit?: number }) => d)
  .handler(async ({ data }): Promise<{ transactions: ZerionTransaction[]; source: "zerion" | "empty" }> => {
    const auth = authHeader();
    if (!auth) return { transactions: [], source: "empty" };
    const addr = data.address.toLowerCase();
    const limit = Math.max(1, Math.min(100, data.limit ?? 50));
    const url = `${ZERION_BASE}/wallets/${addr}/transactions/?filter[chain_ids]=${CHAIN_SLUG}&page[size]=${limit}`;
    try {
      const r = await fetch(url, {
        headers: {
          Authorization: auth,
          Accept: "application/json",
        },
      });
      if (!r.ok) {
        console.warn(`[zerion-tx] ${addr} -> ${r.status}`);
        return { transactions: [], source: "empty" };
      }
      const json: any = await r.json();
      const rows = Array.isArray(json?.data) ? json.data : [];
      const transactions: ZerionTransaction[] = rows.map((row: any) => {
        const a = row.attributes ?? {};
        const transfers = [
          ...(Array.isArray(a.transfers) ? a.transfers : []),
          ...(Array.isArray(a.fungible_transfers) ? a.fungible_transfers : []),
          ...(Array.isArray(a.changes) ? a.changes : []),
        ];
        const changes = transfers.map((t: any) => {
          const fi = t.fungible_info ?? t.asset?.fungible_info ?? t.asset ?? {};
          const impl = (fi.implementations ?? []).find((i: any) => i.chain_id === CHAIN_SLUG)
            ?? fi.implementations?.[0]
            ?? {};
          const quantity = t.quantity ?? t.amount ?? {};
          return {
            address: typeof impl.address === "string" ? impl.address.toLowerCase() : null,
            symbol: String(fi.symbol ?? t.symbol ?? "?"),
            name: String(fi.name ?? t.name ?? fi.symbol ?? "Token"),
            imageUri: fi.icon?.url ?? t.icon?.url ?? null,
            amount: quantity.float != null ? Number(quantity.float) : null,
            amountRaw: quantity.int != null ? String(quantity.int) : null,
            valueUsd: t.value != null ? Number(t.value) : t.value_usd != null ? Number(t.value_usd) : null,
          };
        });
        const txHash = String(a.hash ?? row.id ?? "");
        const type = String(a.operation_type ?? a.type ?? "transaction");
        const title = String(a.title ?? type.replace(/_/g, " "));
        return {
          id: String(row.id ?? txHash),
          hash: txHash,
          direction: ["in", "out", "self"].includes(a.direction) ? a.direction : "unknown",
          type,
          minedAt: a.mined_at ?? a.minedAt ?? null,
          status: a.status ?? null,
          title,
          subtitle: a.subtitle ?? "",
          valueUsd: a.value != null ? Number(a.value) : null,
          changes,
        };
      }).filter((tx: ZerionTransaction) => /^0x[a-fA-F0-9]{64}$/.test(tx.hash));
      return { transactions, source: "zerion" };
    } catch (e) {
      console.warn("[zerion-tx] fetch failed:", e);
      return { transactions: [], source: "empty" };
    }
  });
