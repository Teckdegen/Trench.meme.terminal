export const MONAD_EXPLORER_NAME = "MonadVision";
export const MONAD_EXPLORER_URL = "https://monadvision.com";

export function txUrl(hash: string) {
  return `${MONAD_EXPLORER_URL}/tx/${hash}`;
}

export function addressUrl(address: string) {
  return `${MONAD_EXPLORER_URL}/address/${address}`;
}
