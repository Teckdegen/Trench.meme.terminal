import { createContext } from "react";
import type { ReactNode } from "react";
import {
  defaultCosmosExternalWallet,
  defaultEvmExternalWallet,
  defaultSolanaExternalWallet,
} from "@getpara/react-common";

export const allWallets = [];
export const WalletList = [];

export const EvmExternalWalletContext = createContext(defaultEvmExternalWallet);
export const CosmosExternalWalletContext = createContext(defaultCosmosExternalWallet);
export const SolanaExternalWalletContext = createContext(defaultSolanaExternalWallet);

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
