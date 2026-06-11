const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

/** Whether the connected wallet owns the profile being viewed. */
export function isOwnAccount(
  me: string | undefined,
  resolvedAddr: string | undefined,
  urlHandle: string,
  myHandle?: string | null,
): boolean {
  if (!me) return false;
  const meL = me.toLowerCase();
  const handle = urlHandle.replace(/^@/, "").toLowerCase();
  if (resolvedAddr && meL === resolvedAddr.toLowerCase()) return true;
  if (WALLET_RE.test(handle) && meL === handle) return true;
  if (myHandle && myHandle.toLowerCase() === handle) return true;
  return false;
}
