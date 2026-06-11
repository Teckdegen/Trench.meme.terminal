// NadFun V2 mainnet addresses + minimal ABIs for discovery/indexing.
// Source: NadFun V2 integration docs (bonding curve + DEX + router).

import { parseAbi, type Address } from "viem";

export const NADFUN_V2_MAINNET = {
  bondingCurve: "0x9f3832732923252A21044F21eE6bd87F09514ae4" as Address,
  nadFunRouter: "0x8986C8fD44eb85294A725a7e61AF35E76bA26F91" as Address,
  nadFunFactory: "0xA25b13127e63ddae6d0b35570FF3D39dBD621001" as Address,
  feeCollector: "0xE1C8b73343f5A83EBe165BE90470d84B00e33022" as Address,
  wmon: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A" as Address,
  deploymentBlocks: {
    bondingCurve: 73_857_231n,
    nadFunFactory: 73_857_264n,
  },
  /** Shared quote config — used to derive bonding % from getCurve(). */
  virtualTokenReserve: 1_060_569_000_000_000_000_000_000_000n,
  minTokenReserve: 251_660_440_677_966_101_694_915_255n,
} as const;

/** Nad.fun V1 mainnet curve (still emits Create for older launches). */
export const NADFUN_V1_MAINNET_CURVE =
  "0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE" as Address;

export const NAD_LENS_MAINNET =
  "0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea" as Address;

// V2-only Create event in this ABI. We removed the V1 `Create` overload
// because viem's parseAbi rejects two events with the same name in one
// ABI bundle — it throws at MODULE LOAD, which crashes the entire SSR
// bundle and 500s every route (including /favicon.ico).
// V1 Create still gets decoded by the standalone ABI below.
export const BONDING_CURVE_ABI = parseAbi([
  "event Create(address indexed creator, address indexed token, address indexed pair, address quoteToken, string name, string symbol, string tokenURI, uint256 virtualQuoteReserve, uint256 virtualTokenReserve, uint256 minTokenReserve)",
  "event Graduate(address indexed token, address indexed pair)",
  "function getCurve(address token) view returns ((address token, address creator, address quoteToken, uint256 virtualQuoteReserve, uint256 virtualTokenReserve, uint256 k, uint256 minTokenReserve, uint256 createdAtBlock, bool graduated, uint256 creatorFeeRate, uint8 dexType, address pair, uint256 graduateFee))",
]);

// Standalone V1 Create event — kept separate so it doesn't collide with
// the V2 Create above. Used when scanning the legacy V1 curve contract.
export const BONDING_CURVE_V1_CREATE_ABI = parseAbi([
  "event Create(address indexed token, address indexed creator, string name, string symbol, string uri)",
]);

export const NAD_FUN_FACTORY_ABI = parseAbi([
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint256)",
]);

export const NAD_FUN_ROUTER_ABI = parseAbi([
  "function isGraduated(address token) view returns (bool)",
]);

export const NAD_LENS_ABI = parseAbi([
  "function getProgress(address token) view returns (uint256)",
  "function isGraduated(address token) view returns (bool)",
]);

/** Bonding % from V2 curve state (0..10000 bps). */
export function progressBpsFromCurve(
  virtualTokenReserve: bigint,
  minTokenReserve: bigint = NADFUN_V2_MAINNET.minTokenReserve,
  initialReserve: bigint = NADFUN_V2_MAINNET.virtualTokenReserve,
): number {
  if (virtualTokenReserve <= minTokenReserve) return 10_000;
  const span = initialReserve - minTokenReserve;
  if (span <= 0n) return 0;
  const bonded = initialReserve - virtualTokenReserve;
  if (bonded <= 0n) return 0;
  return Math.max(0, Math.min(10_000, Number((bonded * 10_000n) / span)));
}
