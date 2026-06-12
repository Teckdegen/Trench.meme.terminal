import { http, type Chain, type WalletClient } from "viem";
import { MONAD_EXPLORER_NAME, MONAD_EXPLORER_URL } from "@/lib/explorer";

export const MONAD_MAINNET: Chain = {
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_MONAD_RPC_URL || "https://rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: MONAD_EXPLORER_NAME, url: MONAD_EXPLORER_URL },
  },
} as const;

export async function getParaWalletClient(account: `0x${string}`): Promise<WalletClient | null> {
  try {
    const para = (window as any).__trenchParaClient;
    if (!para) return null;
    const { createParaViemClient } = await import("@getpara/viem-v2-integration");
    return createParaViemClient({
      para,
      walletClientConfig: {
        chain: MONAD_MAINNET,
        transport: http(import.meta.env.VITE_MONAD_RPC_URL || "https://rpc.monad.xyz"),
      },
    }) as WalletClient;
  } catch (e) {
    console.warn("[para] wallet client unavailable", e);
    return null;
  }
}
