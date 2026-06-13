import {HardhatUserConfig} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// Monad mainnet = chain id 143. Put MONAD_RPC_URL + PRIVATE_KEY in your env
// (e.g. a .env loaded by your shell, or CI secrets). Never commit keys.
const MONAD_RPC_URL = process.env.MONAD_RPC_URL ?? "https://rpc.monad.xyz";
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {enabled: true, runs: 200},
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    monad: {
      url: MONAD_RPC_URL,
      chainId: 143,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};

export default config;
