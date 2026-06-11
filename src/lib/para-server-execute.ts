import {
  createPublicClient, fallback, http, encodeFunctionData, parseAbi,
  type Address, type Hex,
} from "viem";
import { supabaseAdmin } from "@/lib/supabase";

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

const NADFUN_ROUTER = "0x8986C8fD44eb85294A725a7e61AF35E76bA26F91" as Address;
const NADFUN_LEGACY_LENS = "0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea" as Address;
const NADFUN_BASE = process.env.NADFUN_API_BASE ?? "https://api.nad.fun";
const NADFUN_KEY = process.env.NADFUN_API_KEY ?? "";
const DIROL_BASE = process.env.DIROL_API_BASE ?? "https://api.dirol.io/api/v1";
const WMON = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A" as Address;

const NADFUN_ROUTER_ABI = parseAbi([
  "function buyWithNative((address token,uint256 amountOutMin,address to,uint256 deadline)) payable returns (uint256)",
  "function sell((address token,uint256 amountIn,uint256 amountOutMin,address to,uint256 deadline)) returns (uint256)",
  "function sellToNative((address token,uint256 amountIn,uint256 amountOutMin,address to,uint256 deadline)) returns (uint256)",
  "function getAmountOut(address token,uint256 amountIn,bool isBuy) view returns (uint256)",
]);

const NADFUN_LEGACY_LENS_ABI = parseAbi([
  "function getAmountOut(address token,uint256 amountIn,bool isBuy) view returns (address router,uint256 amountOut)",
]);

const NADFUN_LEGACY_ROUTER_ABI = parseAbi([
  "function buy((uint256 amountOutMin,address token,address to,uint256 deadline)) payable returns (uint256)",
  "function sell((uint256 amountIn,uint256 amountOutMin,address token,address to,uint256 deadline)) returns (uint256)",
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
]);

function admin() {
  return supabaseAdmin();
}

function paraCreds() {
  const apiKey = (process.env.PARA_API_KEY || process.env.VITE_PARA_API_KEY || "").trim();
  const apiSecret = (process.env.PARA_API_SECRET || "").trim();
  if (!apiKey) throw new Error("Para server is not configured: set PARA_API_KEY.");
  if (!apiSecret) {
    console.warn("[para] PARA_API_SECRET is empty; SDK signing uses PARA_API_KEY, but keep the secret in Vercel for REST/admin flows.");
  }
  return { apiKey };
}

function assertHeadlessSession(owner: string, session: string | null) {
  if (!session) {
    throw new Error(`No zero-popup Para session for ${owner.slice(0, 6)}...${owner.slice(-4)}. Sign out and back in.`);
  }
  try {
    const decoded = JSON.parse(Buffer.from(session, "base64").toString("utf8"));
    const wallets = Object.values(decoded.wallets ?? {}) as any[];
    const hasEvmSigner = wallets.some((w) => w?.type === "EVM" && w?.signer);
    if (!hasEvmSigner || !decoded.sessionCookie) {
      throw new Error("missing signer");
    }
  } catch {
    throw new Error(`Saved Para session is not zero-popup ready for ${owner.slice(0, 6)}...${owner.slice(-4)}. Sign out and back in.`);
  }
}

async function paraSessionFor(owner: string): Promise<{ session: string }> {
  const { data } = await admin().from("para_wallets")
    .select("session, session_cookie, expires_at, updated_at")
    .eq("owner_address", owner.toLowerCase())
    .maybeSingle();
  const expiresAt = (data as any)?.expires_at
    ? +new Date((data as any).expires_at)
    : (data as any)?.updated_at
      ? +new Date((data as any).updated_at) + 7 * 86_400_000
      : 0;
  if (expiresAt && Date.now() > expiresAt) {
    throw new Error("Para session expired - sign in again.");
  }
  const session = (data as any)?.session ?? null;
  assertHeadlessSession(owner, session);
  return { session };
}

async function paraClientFor(owner: string) {
  const { apiKey } = paraCreds();
  const [{ Para, Environment }, { createParaViemClient }] = await Promise.all([
    import("@getpara/server-sdk") as Promise<any>,
    import("@getpara/viem-v2-integration") as Promise<any>,
  ]);

  const para = new Para(Environment.PROD, apiKey);
  const { session } = await paraSessionFor(owner);

  if (typeof para.importSession === "function") {
    await para.importSession(session);
  } else {
    throw new Error(`Para session for ${owner.slice(0, 6)}...${owner.slice(-4)} is empty. Sign out and back in.`);
  }

  return createParaViemClient({
    para,
    walletClientConfig: {
      chain: monadChain as any,
      transport: monadTransport,
    },
  });
}

export async function sendViaPara(owner: string, opts: {
  to: Address;
  data?: Hex;
  value?: bigint;
  gas?: bigint;
}): Promise<Hex> {
  const pub = createPublicClient({ chain: monadChain as any, transport: monadTransport });
  let gas = opts.gas;
  if (!gas) {
    try {
      gas = await pub.estimateGas({
        account: owner as Address,
        to: opts.to,
        data: opts.data,
        value: opts.value,
      });
      gas = (gas * 13n) / 10n;
    } catch {
      if (!opts.data) gas = 42_000n;
    }
  }
  if ((opts.value ?? 0n) > 0n) {
    const bal = await pub.getBalance({ address: owner as Address });
    const gasPrice = await pub.getGasPrice().catch(() => 0n);
    const needed = (opts.value ?? 0n) + (gas && gasPrice ? gas * gasPrice : 0n);
    if (bal < needed) throw new Error("Insufficient MON for amount plus gas.");
  }
  const client = await paraClientFor(owner);
  const tx = {
    chain: monadChain as any,
    to: opts.to,
    data: opts.data,
    value: opts.value,
    gas,
  };
  try {
    return await client.sendTransaction(tx);
  } catch (e: any) {
    const msg = String(e?.shortMessage ?? e?.message ?? e);
    if (!/rpc request failed|network|timeout|fetch/i.test(msg)) throw e;
    await new Promise((resolve) => setTimeout(resolve, 900));
    return await client.sendTransaction(tx);
  }
}

type NadfunTokenMeta = {
  version: "V1" | "V2" | null;
  marketType: string | null;
  isGraduated: boolean | null;
};

async function nadfunTokenMeta(token: string): Promise<NadfunTokenMeta | null> {
  try {
    const res = await fetch(`${NADFUN_BASE}/token/metadata/${token}`, {
      headers: { accept: "application/json", ...(NADFUN_KEY ? { "X-API-Key": NADFUN_KEY } : {}) },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const version = json?.token_info?.version;
    const marketType = typeof json?.market_info?.market_type === "string"
      ? json.market_info.market_type
      : null;
    const isGraduated = typeof json?.token_info?.is_graduated === "boolean"
      ? json.token_info.is_graduated
      : null;
    return {
      version: version === "V1" || version === "V2" ? version : null,
      marketType,
      isGraduated,
    };
  } catch {
    return null;
  }
}

function isNadfunCurve(meta: NadfunTokenMeta | null) {
  if (!meta) return false;
  if (meta.isGraduated === false) return true;
  return /CURVE/i.test(meta.marketType ?? "");
}

function applySlippage(amount: bigint, slippageBps: number) {
  if (amount <= 0n) return 0n;
  const bps = BigInt(Math.max(0, Math.min(10_000, slippageBps || 50)));
  return amount - (amount * bps) / 10000n;
}

async function getNadfunRoute(pub: ReturnType<typeof createPublicClient>, token: Address, amountIn: bigint, isBuy: boolean) {
  const version = (await nadfunTokenMeta(token))?.version ?? null;
  if (version !== "V1") {
    try {
      const amountOut = await pub.readContract({
        address: NADFUN_ROUTER,
        abi: NADFUN_ROUTER_ABI,
        functionName: "getAmountOut",
        args: [token, amountIn, isBuy],
      });
      return { kind: "v2" as const, router: NADFUN_ROUTER, amountOut };
    } catch {
      if (version === "V2") throw new Error("Nad.fun V2 quote failed for this token.");
    }
  }

  const [router, amountOut] = await pub.readContract({
    address: NADFUN_LEGACY_LENS,
    abi: NADFUN_LEGACY_LENS_ABI,
    functionName: "getAmountOut",
    args: [token, amountIn, isBuy],
  });
  return { kind: "legacy" as const, router, amountOut };
}

async function getDirolSwap(input: {
  token: Address;
  owner: Address;
  amountIn: bigint;
  isBuy: boolean;
  slippageBps: number;
}) {
  const q = new URLSearchParams({
    tokenIn: input.isBuy ? WMON : input.token,
    tokenOut: input.isBuy ? input.token : WMON,
    amount: input.amountIn.toString(),
    recipient: input.owner,
    slippageBps: String(input.slippageBps || 50),
  });
  const res = await fetch(`${DIROL_BASE}/swap?${q}`, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`dirol /swap ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const swap = await res.json();
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(swap?.tx?.to ?? "")) || !String(swap?.tx?.data ?? "").startsWith("0x")) {
    throw new Error("dirol /swap returned an invalid transaction");
  }
  return swap as {
    amountOut?: string;
    tx: {
      to: Address;
      data: Hex;
      value?: string;
      estimatedGas?: string;
    };
  };
}

async function fireDirol(p: {
  pub: ReturnType<typeof createPublicClient>;
  owner: string;
  ownerAddr: Address;
  token: Address;
  amountIn: bigint;
  netIn: bigint;
  isBuy: boolean;
  slippageBps: number;
}) {
  const swap = await getDirolSwap({
    token: p.token,
    owner: p.ownerAddr,
    amountIn: p.isBuy ? p.netIn : p.amountIn,
    isBuy: p.isBuy,
    slippageBps: p.slippageBps,
  });

  if (!p.isBuy) {
    const approveData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [swap.tx.to, p.amountIn],
    });
    const approveHash = await sendViaPara(p.owner, { to: p.token, data: approveData });
    await p.pub.waitForTransactionReceipt({ hash: approveHash, timeout: 60_000 });
  }

  return sendViaPara(p.owner, {
    to: swap.tx.to,
    data: swap.tx.data,
    value: p.isBuy ? p.netIn : BigInt(swap.tx.value || "0"),
    gas: swap.tx.estimatedGas ? BigInt(swap.tx.estimatedGas) : undefined,
  });
}

async function fireDirectNadfun(p: {
  pub: ReturnType<typeof createPublicClient>;
  owner: string;
  ownerAddr: Address;
  token: Address;
  amountIn: bigint;
  netIn: bigint;
  isBuy: boolean;
  slippageBps: number;
}) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const route = await getNadfunRoute(p.pub, p.token, p.isBuy ? p.netIn : p.amountIn, p.isBuy);
  const amountOutMin = applySlippage(route.amountOut, p.slippageBps);

  if (route.kind === "v2") {
    if (p.isBuy) {
      const data = encodeFunctionData({
        abi: NADFUN_ROUTER_ABI,
        functionName: "buyWithNative",
        args: [{ token: p.token, amountOutMin, to: p.ownerAddr, deadline }],
      });
      return sendViaPara(p.owner, { to: NADFUN_ROUTER, data, value: p.netIn });
    }

    const approveData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [NADFUN_ROUTER, p.amountIn],
    });
    const ah = await sendViaPara(p.owner, { to: p.token, data: approveData });
    await p.pub.waitForTransactionReceipt({ hash: ah });
    const sellData = encodeFunctionData({
      abi: NADFUN_ROUTER_ABI,
      functionName: "sellToNative",
      args: [{ token: p.token, amountIn: p.amountIn, amountOutMin, to: p.ownerAddr, deadline }],
    });
    return sendViaPara(p.owner, { to: NADFUN_ROUTER, data: sellData });
  }

  if (p.isBuy) {
    const data = encodeFunctionData({
      abi: NADFUN_LEGACY_ROUTER_ABI,
      functionName: "buy",
      args: [{ token: p.token, amountOutMin, to: p.ownerAddr, deadline }],
    });
    return sendViaPara(p.owner, { to: route.router, data, value: p.netIn });
  }

  const approveData = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [route.router, p.amountIn],
  });
  const ah = await sendViaPara(p.owner, { to: p.token, data: approveData });
  await p.pub.waitForTransactionReceipt({ hash: ah });
  const sellData = encodeFunctionData({
    abi: NADFUN_LEGACY_ROUTER_ABI,
    functionName: "sell",
    args: [{ token: p.token, amountIn: p.amountIn, amountOutMin, to: p.ownerAddr, deadline }],
  });
  return sendViaPara(p.owner, { to: route.router, data: sellData });
}

export async function fireWithPara(p: {
  owner: string;
  venue: "nadfun" | "dirol" | "auto";
  side: "BUY" | "SELL";
  tokenAddress: string;
  amountIn: bigint;
  slippageBps: number;
  source: "market" | "limit" | "copy";
}): Promise<Hex> {
  const pub = createPublicClient({ chain: monadChain as any, transport: monadTransport });
  const ownerAddr = p.owner as Address;

  const FEE_BPS: Record<string, number> = {
    market: Number(process.env.FEE_BPS_MARKET ?? "85"),
    limit: Number(process.env.FEE_BPS_LIMIT ?? "250"),
    copy: Number(process.env.FEE_BPS_COPY ?? "350"),
  };
  const FEE_WALLET = (process.env.FEE_WALLET_ADDRESS ?? "") as Address;
  const feeOk = /^0x[a-fA-F0-9]{40}$/.test(FEE_WALLET);
  const feeBps = BigInt(FEE_BPS[p.source] ?? 0);
  const isBuy = p.side === "BUY";
  const feeAmount = !isBuy && feeOk && feeBps > 0n ? (p.amountIn * feeBps) / 10000n : 0n;
  const netIn = p.amountIn;
  let feePaidMon = 0n;

  if (isBuy && feeOk && feeBps > 0n) {
    console.warn("[para-exec] buy fee transfer skipped; executing swap without pre-fee tx");
  }

  let hash: Hex;
  const token = p.tokenAddress as Address;
  const directNadfun = isNadfunCurve(await nadfunTokenMeta(p.tokenAddress));

  if (directNadfun) {
    hash = await fireDirectNadfun({
      pub,
      owner: p.owner,
      ownerAddr,
      token,
      amountIn: p.amountIn,
      netIn,
      isBuy,
      slippageBps: p.slippageBps,
    });
  } else {
    try {
      hash = await fireDirol({
        pub,
        owner: p.owner,
        ownerAddr,
        token,
        amountIn: p.amountIn,
        netIn,
        isBuy,
        slippageBps: p.slippageBps,
      });
    } catch (e) {
      console.warn("[para-exec] Dirol route failed, falling back to direct Nad.fun route", e);
      hash = await fireDirectNadfun({
        pub,
        owner: p.owner,
        ownerAddr,
        token,
        amountIn: p.amountIn,
        netIn,
        isBuy,
        slippageBps: p.slippageBps,
      });
    }
  }

  if (!isBuy && feeAmount > 0n) {
    const rcpt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (rcpt.status !== "success") throw new Error(`swap tx reverted (${hash})`);
    const preMon = await pub.getBalance({ address: ownerAddr, blockTag: rcpt.blockNumber - 1n });
    const postMon = await pub.getBalance({ address: ownerAddr, blockNumber: rcpt.blockNumber });
    const monOut = postMon > preMon ? postMon - preMon : 0n;
    const sellFeeMon = (monOut * feeBps) / 10000n;
    if (sellFeeMon > 0n) {
      const feeHash = await sendViaPara(p.owner, { to: FEE_WALLET, value: sellFeeMon });
      const feeRcpt = await pub.waitForTransactionReceipt({ hash: feeHash, timeout: 60_000 });
      if (feeRcpt.status !== "success") throw new Error(`sell fee tx reverted (${feeHash})`);
      feePaidMon = sellFeeMon;
    }
  }

  try {
    const feeUsd = Number(feePaidMon) / 1e18;
    if (feeUsd > 0) {
      await admin().rpc("record_trade_fee", {
        p_trader: p.owner,
        p_fee_usd: feeUsd,
        p_source_tx: hash,
        p_source: p.source,
      });
    }
  } catch (e) {
    console.warn("[para-exec] reward credit failed", e);
  }

  return hash;
}
