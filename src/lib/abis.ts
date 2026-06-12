// Minimal ABIs for browser-side execution. We deliberately don't import the
// full Nad.fun SDK in the browser bundle — it's a server-side dependency.

import { parseAbi } from "viem";

export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

// NadFunRouter v2 — buy/sell helpers used by simpleBuy / simpleSell.
// Source: nadfun-contract-v2 INadFunRouter.
export const NAD_FUN_ROUTER_ABI = parseAbi([
  "function buyWithNative((uint256 amountOutMin,address token,address to,uint256 deadline)) payable returns (uint256)",
  "function sell((uint256 amountIn,uint256 amountOutMin,address token,address to,uint256 deadline)) returns (uint256)",
  "function sellToNative((uint256 amountIn,uint256 amountOutMin,address token,address to,uint256 deadline)) returns (uint256)",
  "function sellToNativeWithPermit((uint256 amountIn,uint256 amountOutMin,uint256 amountAllowance,address token,address to,uint256 deadline,uint8 v,bytes32 r,bytes32 s)) returns (uint256)",
  "function getAmountOut(address token,uint256 amountIn,bool isBuy) view returns (uint256)",
  "function getAmountIn(address token,uint256 amountOut,bool isBuy) view returns (uint256)",
  "function isGraduated(address token) view returns (bool)",
]);

export const NAD_FUN_LEGACY_LENS_ABI = parseAbi([
  "function getAmountOut(address token,uint256 amountIn,bool isBuy) view returns (address router,uint256 amountOut)",
]);

// Mainnet addresses (confirm against nadfun-contract-v2 deploy.md before prod)
export const NADFUN_MAINNET = {
  V2_NAD_FUN_ROUTER: "0x8986C8fD44eb85294A725a7e61AF35E76bA26F91",
  V2_BONDING_CURVE:  "0x9f3832732923252A21044F21eE6bd87F09514ae4",
  V2_NAD_FUN_FACTORY: "0xA25b13127e63ddae6d0b35570FF3D39dBD621001",
  LEGACY_LENS:       "0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea",
  WMON:              "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
} as const;

export const MONAD_MAINNET = {
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
} as const;
