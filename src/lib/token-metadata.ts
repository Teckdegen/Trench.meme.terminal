import { createServerFn } from "@tanstack/react-start";

export type TokenMeta = {
  address: string;
  symbol: string;
  name: string;
  imageUri: string | null;
};

const NADFUN_BASE = process.env.NADFUN_API_BASE ?? "https://api.nad.fun";
const NADFUN_KEY = process.env.NADFUN_API_KEY ?? "";
const DIROL_BASE = process.env.DIROL_API_BASE ?? "https://api.dirol.io/api/v1";

async function nadMeta(address: string): Promise<TokenMeta | null> {
  try {
    const res = await fetch(`${NADFUN_BASE}/token/metadata/${address}`, {
      headers: { accept: "application/json", ...(NADFUN_KEY ? { "X-API-Key": NADFUN_KEY } : {}) },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const info = json?.token_info;
    if (!info) return null;
    return {
      address,
      symbol: String(info.symbol ?? address.slice(2, 6)),
      name: String(info.name ?? info.symbol ?? "Token"),
      imageUri: typeof info.image_uri === "string" ? info.image_uri : null,
    };
  } catch {
    return null;
  }
}

let dirolTokensCache: any[] | null = null;
let dirolTokensAt = 0;

async function dirolTokens() {
  if (dirolTokensCache && Date.now() - dirolTokensAt < 60_000) return dirolTokensCache;
  const res = await fetch(`${DIROL_BASE}/tokens`, { headers: { accept: "application/json" } });
  if (!res.ok) return [];
  const json = await res.json();
  const rows = Array.isArray(json?.tokens) ? json.tokens : Array.isArray(json) ? json : [];
  dirolTokensCache = rows;
  dirolTokensAt = Date.now();
  return rows;
}

async function dirolMeta(address: string): Promise<TokenMeta | null> {
  try {
    const lc = address.toLowerCase();
    const tok = (await dirolTokens()).find((t: any) => String(t.address ?? "").toLowerCase() === lc);
    if (!tok) return null;
    return {
      address,
      symbol: String(tok.symbol ?? address.slice(2, 6)),
      name: String(tok.name ?? tok.symbol ?? "Token"),
      imageUri: typeof tok.logoURI === "string" ? tok.logoURI : typeof tok.image === "string" ? tok.image : null,
    };
  } catch {
    return null;
  }
}

export const fetchTokenMetas = createServerFn({ method: "GET" })
  .inputValidator((d: { addresses: string[] }) => d)
  .handler(async ({ data }): Promise<TokenMeta[]> => {
    const addresses = [...new Set(data.addresses.map((a) => a.toLowerCase()))]
      .filter((a) => /^0x[a-f0-9]{40}$/.test(a))
      .slice(0, 50);
    const rows: TokenMeta[] = [];
    for (const address of addresses) {
      const meta = await nadMeta(address) ?? await dirolMeta(address) ?? {
        address,
        symbol: `${address.slice(2, 6)}...`,
        name: "Token",
        imageUri: null,
      };
      rows.push(meta);
    }
    return rows;
  });
