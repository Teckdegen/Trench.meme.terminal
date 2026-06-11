import {
  createPublicClient, http, encodeFunctionData, parseAbi,
  type Address, type Hex,
} from "viem";
import { supabaseAdmin } from "@/lib/supabase";

const RPC = process.env.MONAD_RPC_URL || "https://rpc.monad.xyz";

const monadChain = {
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

const NADFUN_ROUTER = "0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137" as Address;
const WMON = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A" as Address;
const DIROL_BASE = "https://api.dirol.io/api/v1";

const NADFUN_ROUTER_ABI = parseAbi([
  "function buyWithNative((address token,uint256 amountOutMin,address to,uint256 deadline)) payable returns (uint256)",
  "function sell((address token,uint256 amountIn,uint256 amountOutMin,address to,uint256 deadline)) returns (uint256)",
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function transfer(address to,uint256 amount) returns (bool)",
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

async function paraSessionFor(owner: string): Promise<{ session: string | null; sessionCookie: string | null }> {
  const { data } = await admin().from("para_wallets")
    .select("session, session_cookie")
    .eq("owner_address", owner.toLowerCase())
    .maybeSingle();
  if ((data as any)?.session || (data as any)?.session_cookie) {
    return {
      session: (data as any).session ?? null,
      sessionCookie: (data as any).session_cookie ?? null,
    };
  }
  throw new Error(`No Para session for ${owner.slice(0, 6)}...${owner.slice(-4)}. Sign out and back in.`);
}

async function paraClientFor(owner: string) {
  const { apiKey } = paraCreds();
  const [{ Para, Environment }, { createParaViemClient }] = await Promise.all([
    import("@getpara/server-sdk") as Promise<any>,
    import("@getpara/viem-v2-integration") as Promise<any>,
  ]);

  const para = new Para(Environment.PROD, apiKey);
  const { session, sessionCookie } = await paraSessionFor(owner);

  if (session && typeof para.importSession === "function") {
    await para.importSession(session);
  } else if (sessionCookie) {
    para.retrieveSessionCookie = () => sessionCookie;
  } else {
    throw new Error(`Para session for ${owner.slice(0, 6)}...${owner.slice(-4)} is empty. Sign out and back in.`);
  }

  return createParaViemClient({
    para,
    walletClientConfig: {
      account: owner as Address,
      chain: monadChain as any,
      transport: http(RPC),
    },
  });
}

async function sendViaPara(owner: string, opts: {
  to: Address;
  data?: Hex;
  value?: bigint;
  gas?: bigint;
}): Promise<Hex> {
  const client = await paraClientFor(owner);
  return await client.sendTransaction({
    account: owner as Address,
    chain: monadChain as any,
    to: opts.to,
    data: opts.data,
    value: opts.value,
    gas: opts.gas,
  });
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
  let venue = p.venue;
  if (venue === "auto") {
    const { data: tok } = await admin().from("tokens")
      .select("is_graduated").eq("address", p.tokenAddress).maybeSingle();
    venue = tok && (tok as any).is_graduated ? "dirol" : "nadfun";
  }

  const pub = createPublicClient({ chain: monadChain as any, transport: http(RPC) });
  const ownerAddr = p.owner as Address;

  const FEE_BPS: Record<string, number> = {
    market: Number(process.env.FEE_BPS_MARKET ?? "85"),
    limit: Number(process.env.FEE_BPS_LIMIT ?? "250"),
    copy: Number(process.env.FEE_BPS_COPY ?? "350"),
  };
  const FEE_WALLET = (process.env.FEE_WALLET_ADDRESS ?? "") as Address;
  const feeOk = /^0x[a-fA-F0-9]{40}$/.test(FEE_WALLET);
  const feeBps = BigInt(FEE_BPS[p.source] ?? 0);
  const feeAmount = feeOk && feeBps > 0n ? (p.amountIn * feeBps) / 10000n : 0n;
  const netIn = p.amountIn - feeAmount;
  const isBuy = p.side === "BUY";
  let feePaidMon = 0n;

  if (isBuy && feeAmount > 0n) {
    let feeHash: Hex;
    try {
      feeHash = await sendViaPara(p.owner, { to: FEE_WALLET, value: feeAmount });
    } catch (e: any) {
      const { apiKey } = paraCreds();
      const keyHint = apiKey ? `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}` : "(empty)";
      throw new Error(`fee tx submission failed: ${e?.shortMessage ?? e?.message ?? e} [para apiKey=${keyHint}]`);
    }
    const feeReceipt = await pub.waitForTransactionReceipt({ hash: feeHash, timeout: 60_000 });
    if (feeReceipt.status !== "success") {
      throw new Error(`fee tx reverted (${feeHash}) - aborting swap to prevent free trade`);
    }
    feePaidMon = feeAmount;
  }

  let hash: Hex;
  if (venue === "dirol") {
    const isNativeIn = isBuy;
    const tokenIn = isNativeIn ? WMON : (p.tokenAddress as Address);
    const tokenOut = isNativeIn ? (p.tokenAddress as Address) : WMON;
    const q = new URLSearchParams({
      tokenIn,
      tokenOut,
      amount: (isBuy ? netIn : p.amountIn).toString(),
      recipient: p.owner,
      slippageBps: String(p.slippageBps),
    });
    const res = await fetch(`${DIROL_BASE}/swap?${q}`);
    if (!res.ok) throw new Error(`dirol /swap ${res.status}`);
    const swap = await res.json();

    if (!isNativeIn) {
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [swap.tx.to as Address, p.amountIn],
      });
      const ah = await sendViaPara(p.owner, { to: tokenIn, data: approveData });
      await pub.waitForTransactionReceipt({ hash: ah });
    }
    hash = await sendViaPara(p.owner, {
      to: swap.tx.to as Address,
      data: swap.tx.data as Hex,
      value: isNativeIn ? netIn : BigInt(swap.tx.value),
      gas: BigInt(swap.tx.estimatedGas),
    });
  } else {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    if (isBuy) {
      const data = encodeFunctionData({
        abi: NADFUN_ROUTER_ABI,
        functionName: "buyWithNative",
        args: [{ token: p.tokenAddress as Address, amountOutMin: 0n, to: ownerAddr, deadline }],
      });
      hash = await sendViaPara(p.owner, { to: NADFUN_ROUTER, data, value: netIn });
    } else {
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [NADFUN_ROUTER, p.amountIn],
      });
      const ah = await sendViaPara(p.owner, { to: p.tokenAddress as Address, data: approveData });
      await pub.waitForTransactionReceipt({ hash: ah });
      const sellData = encodeFunctionData({
        abi: NADFUN_ROUTER_ABI,
        functionName: "sell",
        args: [{
          token: p.tokenAddress as Address,
          amountIn: p.amountIn,
          amountOutMin: 0n,
          to: ownerAddr,
          deadline,
        }],
      });
      hash = await sendViaPara(p.owner, { to: NADFUN_ROUTER, data: sellData });
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
