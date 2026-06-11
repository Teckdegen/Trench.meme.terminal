import { createContext } from "react";
import type { ReactNode } from "react";

export const allWallets = [];
export const WalletList = [];

export const EvmExternalWalletContext = createContext(null);
export const CosmosExternalWalletContext = createContext(null);
export const SolanaExternalWalletContext = createContext(null);

export function ParaEvmProvider({ children }: { children: ReactNode }) {
  return children;
}

export function ParaCosmosProvider({ children }: { children: ReactNode }) {
  return children;
}

export function ParaSolanaProvider({ children }: { children: ReactNode }) {
  return children;
}

export function getWagmiConfig() {
  return null;
}

export default {
  allWallets,
  WalletList,
  EvmExternalWalletContext,
  CosmosExternalWalletContext,
  SolanaExternalWalletContext,
  ParaEvmProvider,
  ParaCosmosProvider,
  ParaSolanaProvider,
  getWagmiConfig,
};
