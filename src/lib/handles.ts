// Username / handle helpers. Default handle for new accounts is the full
// wallet address; users can later pick a shorter custom @handle.

export const WALLET_HANDLE_RE = /^0x[a-f0-9]{40}$/;

export function isWalletAddress(s: string | null | undefined): boolean {
  if (!s) return false;
  return WALLET_HANDLE_RE.test(s.toLowerCase());
}

/** Stored handle for a brand-new account — full lower-case wallet address. */
export function defaultAccountHandle(address: string): string {
  return address.toLowerCase();
}

/** Short label shown in UI when the handle is still the wallet address.
 *  Format: `0x` + first 3 chars of the address body + `...` + last 4.
 *  Example: `0x742…35Cc` becomes `0x742...35Cc`.
 *  Uses three dots (not the ellipsis char) per product spec — easier to
 *  read on low-DPI screens and copy-safe.
 */
export function defaultDisplayName(address: string): string {
  const a = address.toLowerCase();
  return `${a.slice(0, 5)}...${a.slice(-4)}`;
}

export function normalizeHandleInput(raw: string): string {
  return raw.replace(/^@/, "").trim().toLowerCase();
}

/** Custom @handles (after the user edits away from their wallet address). */
export function isValidCustomHandle(raw: string): boolean {
  const h = normalizeHandleInput(raw);
  if (!h || isWalletAddress(h)) return false;
  return /^[a-z0-9_.]{2,20}$/.test(h);
}

/** Accept either a wallet address or a custom handle. */
export function isValidHandle(raw: string): boolean {
  const h = normalizeHandleInput(raw);
  if (!h) return false;
  if (isWalletAddress(h)) return true;
  return /^[a-z0-9_.]{2,20}$/.test(h);
}

/** User-visible @label — shortens wallet handles, keeps custom handles as-is. */
export function formatHandleLabel(
  handle: string | null | undefined,
  opts?: { at?: boolean },
): string {
  if (!handle) return "…";
  const at = opts?.at !== false;
  if (isWalletAddress(handle)) {
    const short = defaultDisplayName(handle);
    return at ? `@${short}` : short;
  }
  return at ? `@${handle}` : handle;
}
