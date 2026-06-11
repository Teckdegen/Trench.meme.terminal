// Robust token resolver — never gives up on a valid address.
//
// Strategy (in order of preference, each step is a fallback if the
// previous returned nothing):
//
//   1. Dirol /tokens?search=...      — fast, verified, has logos
//   2. Nad.fun /token/<addr>         — fills in image_uri + socials when
//                                      Dirol doesn't know the token yet
//                                      (especially fresh bonding-curve launches)
//   3. RPC ERC-20 reads via viem     — last resort: any deployed ERC-20
//                                      gives us name + symbol + decimals
//                                      even if no indexer has touched it
//
// Returns a unified DirolToken shape so the topbar search renders
// identically regardless of where the data came from.

import { createServerFn } from "@tanstack/react-start";
import {
  searchTokens,
  type DirolToken,
} from "@/lib/dirol";

const NADFUN_BASE = process.env.NADFUN_API_BASE || "https://api.nad.fun";
const NADFUN_KEY = process.env.NADFUN_API_KEY || "";
const MONAD_RPC = process.env.MONAD_RPC_URL || "https://rpc.monad.xyz";

const isAddress = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);

// ─────────── Nad.fun per-token metadata ────────────────────────────────
async function fromNadfun(address: string): Promise<Partial<DirolToken> | null> {
  try {
    const r = await fetch(`${NADFUN_BASE}/token/${address}`, {
      headers: {
        accept: "application/json",
        ...(NADFUN_KEY ? { "X-API-Key": NADFUN_KEY } : {}),
      },
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const ti = j?.token_info;
    if (!ti?.token_id) return null;
    return {
      address: ti.token_id.toLowerCase(),
      symbol: ti.symbol ?? "?",
      name: ti.name ?? "Unknown",
      decimals: 18,
      logoURI: ti.image_uri ?? "",
      isVerified: false,
    };
  } catch {
    return null;
  }
}

// ─────────── RPC ERC-20 reads (last resort) ────────────────────────────
async function fromRpc(address: string): Promise<Partial<DirolToken> | null> {
  try {
    const viem: any = await import("viem");
    const { createPublicClient, http, parseAbi } = viem;
    const monad = {
      id: 143,
      name: "Monad",
      nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
      rpcUrls: { default: { http: [MONAD_RPC] } },
    };
    const client = createPublicClient({ chain: monad, transport: http() });
    const erc20 = parseAbi([
      "function name() view returns (string)",
      "function symbol() view returns (string)",
      "function decimals() view returns (uint8)",
    ]);
    // All three calls in parallel via multicall-style Promise.all.
    // If ANY core field fails (no name/symbol), we treat it as not-a-token.
    const [name, symbol, decimals] = await Promise.all([
      client.readContract({ address, abi: erc20, functionName: "name" }).catch(() => null),
      client.readContract({ address, abi: erc20, functionName: "symbol" }).catch(() => null),
      client.readContract({ address, abi: erc20, functionName: "decimals" }).catch(() => null),
    ]);
    if (!symbol && !name) return null;
    return {
      address: address.toLowerCase(),
      symbol: String(symbol ?? "?"),
      name: String(name ?? "Unknown"),
      decimals: Number(decimals ?? 18),
      logoURI: "",
      isVerified: false,
    };
  } catch {
    return null;
  }
}

// ─────────── Public resolver ───────────────────────────────────────────
// Returns the full union of what every source knew about the token,
// merging fields so Dirol's logoURI fills in even if Nad.fun gave us
// the symbol first, etc.
export const resolveToken = createServerFn({ method: "GET" })
  .inputValidator((d: { query: string }) => d)
  .handler(async ({ data }): Promise<DirolToken[]> => {
    const q = data.query.trim();
    if (!q) return [];

    // 1. Always try Dirol first — covers the common case (text search +
    //    address-by-text) and gives us logos for verified tokens.
    let dirolResults: DirolToken[] = [];
    try {
      dirolResults = await searchTokens({ data: { search: q, limit: 20 } });
    } catch (e) {
      console.warn("[resolveToken] Dirol search failed:", e);
    }
    if (dirolResults.length > 0) return dirolResults;

    // 2. If Dirol didn't find it and the query is an address, fall
    //    through to Nad.fun (best chance of metadata for fresh tokens).
    if (!isAddress(q)) return [];

    const nad = await fromNadfun(q);

    // 3. If Nad.fun is missing the symbol/name/logo, fill from RPC.
    //    The RPC read is bulletproof — every ERC-20 has name() symbol()
    //    decimals() if it's a real token at all.
    const rpc = (!nad || !nad.symbol || nad.symbol === "?" || !nad.logoURI)
      ? await fromRpc(q)
      : null;

    // Merge: Nad.fun wins for logo + verified, RPC wins for name/symbol
    // when Nad didn't have them.
    const merged: DirolToken | null = nad || rpc ? {
      address: q.toLowerCase(),
      symbol: nad?.symbol && nad.symbol !== "?" ? nad.symbol : (rpc?.symbol ?? "?"),
      name:   nad?.name && nad.name !== "Unknown" ? nad.name : (rpc?.name ?? "Unknown"),
      decimals: nad?.decimals ?? rpc?.decimals ?? 18,
      logoURI: nad?.logoURI || rpc?.logoURI || "",
      isVerified: !!nad?.isVerified,
    } : null;

    return merged ? [merged] : [];
  });
