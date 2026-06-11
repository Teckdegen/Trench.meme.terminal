// Platform fees. Intentionally not surfaced in the UI.
// Activated when the smart-wallet layer is wired so the fee transfer can be
// batched atomically with the swap.
//
// Override at deploy time via env vars (see .env.example).

export type FeeKind = "market" | "limit" | "copy";

// Basis points (10000 = 100%)
export const FEE_BPS: Record<FeeKind, number> = {
  market: Number(process.env.FEE_BPS_MARKET ?? "85"),    // 0.85%
  limit:  Number(process.env.FEE_BPS_LIMIT  ?? "250"),   // 2.50%
  copy:   Number(process.env.FEE_BPS_COPY   ?? "350"),   // 3.50%
};

export const FEE_WALLET = (
  process.env.FEE_WALLET_ADDRESS ?? ""
) as `0x${string}` | "";

/**
 * Compute the fee carved out of an amount.
 * @returns { fee, net } both as bigint in the same unit as the input
 */
export function computeFee(amountIn: bigint, kind: FeeKind) {
  const bps = BigInt(FEE_BPS[kind] ?? 0);
  const fee = (amountIn * bps) / 10000n;
  const net = amountIn - fee;
  return { fee, net };
}

export function feesConfigured(): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(FEE_WALLET);
}
