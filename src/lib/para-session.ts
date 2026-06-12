import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/lib/supabase";
import { defaultAccountHandle, defaultDisplayName } from "@/lib/handles";
import {
  createPublicClient, fallback, http, type Address,
} from "viem";

const RPC_URLS = [
  process.env.MONAD_RPC_URL,
  process.env.VITE_MONAD_RPC_URL,
  ...(process.env.MONAD_RPC_FALLBACK_URLS ?? "").split(","),
  "https://rpc.monad.xyz",
].map((url) => url?.trim()).filter((url): url is string => !!url);
const UNIQUE_RPC_URLS = [...new Set(RPC_URLS)];
const RPC = UNIQUE_RPC_URLS[0];
const monadTransport = fallback(UNIQUE_RPC_URLS.map((url) => http(url)), {
  rank: false,
  retryCount: 1,
});
const monadChain = {
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

type ParaApiWallet = {
  id: string;
  address?: string;
  status?: string;
};

function paraRestCreds() {
  const apiKey = (process.env.PARA_API_SECRET || process.env.PARA_REST_API_KEY || process.env.PARA_API_KEY || "").trim();
  if (!apiKey) throw new Error("Para REST API is not configured: set PARA_API_SECRET.");
  const baseUrl = (process.env.PARA_API_BASE || "https://api.getpara.com").replace(/\/$/, "");
  return { apiKey, baseUrl };
}

async function paraRest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { apiKey, baseUrl } = paraRestCreds();
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("X-API-Key", apiKey);
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.message || json?.error || `Para REST request failed (${res.status})`;
    const code = json?.code ? `${json.code}: ` : "";
    const err = new Error(`${code}${message}`) as Error & { code?: string; walletId?: string };
    err.code = json?.code;
    err.walletId = json?.walletId;
    throw err;
  }
  return json as T;
}

function apiWalletIdentifier(data: { owner: string; paraUserId?: string | null }) {
  const stableId = data.paraUserId?.trim();
  return stableId ? `para:${stableId}` : data.owner.toLowerCase();
}

async function ensureParaApiWallet(data: { owner: string; paraUserId?: string | null }) {
  const userIdentifier = apiWalletIdentifier(data);
  const query = new URLSearchParams({
    type: "EVM",
    status: "ready",
    userIdentifier,
    userIdentifierType: "CUSTOM_ID",
    limit: "10",
  });
  const list = await paraRest<{ data?: ParaApiWallet[] }>(`/v1/wallets?${query}`);
  const existing = list.data?.find((wallet) => wallet.id && wallet.address);
  if (existing?.address) return existing;

  let wallet: ParaApiWallet | undefined;
  try {
    wallet = await paraRest<ParaApiWallet>("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        type: "EVM",
        userIdentifier,
        userIdentifierType: "CUSTOM_ID",
        scheme: "DKLS",
      }),
    });
  } catch (e: any) {
    if (e?.walletId) wallet = await paraRest<ParaApiWallet>(`/v1/wallets/${encodeURIComponent(e.walletId)}`);
    else throw e;
  }

  if (!wallet?.id || !wallet.address) {
    throw new Error("Para API wallet is still creating. Try again in a moment.");
  }
  return wallet;
}

export const registerParaWallet = createServerFn({ method: "POST" })
  .inputValidator((d: {
    owner: string;
    paraUserId?: string | null;
    walletId: string;
    session?: string | null;
    sessionCookie?: string | null;
  }) => d)
  .handler(async ({ data }) => {
    const admin = supabaseAdmin();
    const wallet = await ensureParaApiWallet(data);
    const addr = wallet.address!.toLowerCase();

    await admin.from("para_wallets").upsert({
      owner_address: addr,
      para_user_id: data.paraUserId ?? null,
      wallet_id: wallet.id,
      session: data.session ?? null,
      session_cookie: data.sessionCookie ?? null,
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      chain_type: "ethereum",
      updated_at: new Date().toISOString(),
    }, { onConflict: "owner_address" });

    await admin.from("accounts").upsert({
      address: addr,
      handle: defaultAccountHandle(addr),
      display_name: defaultDisplayName(addr),
      image_uri: "https://www.image2url.com/r2/default/images/1779999303234-5b9fa706-14c0-4309-af0f-f5f17112bb1c.jpg",
    }, { onConflict: "address", ignoreDuplicates: true });

    return { ok: true, owner: addr, walletId: wallet.id };
  });

export const executeServerSwap = createServerFn({ method: "POST" })
  .inputValidator((d: {
    owner: string;
    venue: "nadfun" | "dirol" | "auto";
    side: "BUY" | "SELL";
    tokenAddress: string;
    amountIn: string;
    slippageBps?: number;
    source?: "market" | "limit" | "copy";
  }) => d)
  .handler(async ({ data }) => {
    // Transaction execution is intentionally server-only. The UI submits
    // intent here, then waits for the Vercel/server function to sign and
    // broadcast through Para REST. No browser transaction popup is involved.
    const { fireWithPara } = await import("./para-server-execute");
    return await fireWithPara({
      owner: data.owner.toLowerCase(),
      venue: data.venue,
      side: data.side,
      tokenAddress: data.tokenAddress.toLowerCase(),
      amountIn: BigInt(data.amountIn),
      slippageBps: data.slippageBps ?? 50,
      source: data.source ?? "market",
    });
  });

export const withdrawMon = createServerFn({ method: "POST" })
  .inputValidator((d: {
    owner: string;
    to: string;
    amountWei: string;
  }) => d)
  .handler(async ({ data }) => {
    const owner = data.owner.toLowerCase() as Address;
    const to = data.to.trim() as Address;

    if (!/^0x[a-fA-F0-9]{40}$/.test(owner)) throw new Error("Invalid connected wallet.");
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) throw new Error("Invalid withdrawal address.");

    if (!/^\d+$/.test(data.amountWei)) throw new Error("Invalid withdrawal amount.");
    const amountWei = BigInt(data.amountWei);
    if (amountWei <= 0n) throw new Error("Withdrawal amount must be greater than zero.");

    const pub = createPublicClient({ chain: monadChain as any, transport: monadTransport });
    const balance = await pub.getBalance({ address: owner });

    let gasCost = 0n;
    try {
      const [gas, gasPrice] = await Promise.all([
        pub.estimateGas({ account: owner, to, value: amountWei }),
        pub.getGasPrice(),
      ]);
      gasCost = gas * gasPrice * 2n;
    } catch {
      gasCost = 5_000_000_000_000_000n; // 0.005 MON fallback buffer
    }

    if (amountWei + gasCost > balance) {
      const available = balance > gasCost ? balance - gasCost : 0n;
      throw new Error(
        `Not enough MON after gas. Max withdraw is ${(Number(available) / 1e18).toFixed(6)} MON.`,
      );
    }

    try {
      // MON withdrawals follow the same server-only Para REST path as swaps.
      const { sendViaPara } = await import("./para-server-execute");
      return await sendViaPara(owner, { to, value: amountWei });
    } catch (e: any) {
      throw new Error(e?.shortMessage ?? e?.message ?? "Withdrawal RPC request failed.");
    }
  });
