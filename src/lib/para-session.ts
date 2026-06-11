import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/lib/supabase";
import { defaultAccountHandle, defaultDisplayName } from "@/lib/handles";
import {
  createPublicClient, encodeFunctionData, fallback, http, parseAbi, type Address,
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

const ERC20_TRANSFER_ABI = parseAbi([
  "function transfer(address to,uint256 amount) returns (bool)",
]);

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
    const addr = data.owner.toLowerCase();

    await admin.from("para_wallets").upsert({
      owner_address: addr,
      para_user_id: data.paraUserId ?? null,
      wallet_id: data.walletId,
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

    return { ok: true };
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
      const { sendViaPara } = await import("./para-server-execute");
      return await sendViaPara(owner, { to, value: amountWei });
    } catch (e: any) {
      throw new Error(e?.shortMessage ?? e?.message ?? "Withdrawal RPC request failed.");
    }
  });

export const withdrawErc20 = createServerFn({ method: "POST" })
  .inputValidator((d: {
    owner: string;
    to: string;
    tokenAddress: string;
    amountRaw: string;
  }) => d)
  .handler(async ({ data }) => {
    const owner = data.owner.toLowerCase() as Address;
    const to = data.to.trim() as Address;
    const tokenAddress = data.tokenAddress.trim() as Address;

    if (!/^0x[a-fA-F0-9]{40}$/.test(owner)) throw new Error("Invalid connected wallet.");
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) throw new Error("Invalid withdrawal address.");
    if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) throw new Error("Invalid token address.");
    if (!/^\d+$/.test(data.amountRaw)) throw new Error("Invalid withdrawal amount.");

    const amountRaw = BigInt(data.amountRaw);
    if (amountRaw <= 0n) throw new Error("Withdrawal amount must be greater than zero.");

    const transferData = encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [to, amountRaw],
    });

    try {
      const { sendViaPara } = await import("./para-server-execute");
      return await sendViaPara(owner, { to: tokenAddress, data: transferData });
    } catch (e: any) {
      throw new Error(e?.shortMessage ?? e?.message ?? "Token withdrawal RPC request failed.");
    }
  });
