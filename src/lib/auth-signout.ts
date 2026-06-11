import { setMe } from "./useMe";

const SIGNING_OUT_UNTIL = "trench.signing_out_until";

function markSigningOut() {
  try {
    sessionStorage.setItem(SIGNING_OUT_UNTIL, String(Date.now() + 15_000));
  } catch {}
}

export function isSigningOut() {
  if (typeof window === "undefined") return false;
  try {
    return Number(sessionStorage.getItem(SIGNING_OUT_UNTIL) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

function clearParaStorage() {
  if (typeof window === "undefined") return;
  for (const storage of [localStorage, sessionStorage]) {
    for (const key of Object.keys(storage)) {
      const k = key.toLowerCase();
      if (k.includes("para") || k.includes("getpara")) storage.removeItem(key);
    }
  }
}

async function callMaybe(fn: unknown) {
  if (typeof fn !== "function") return;
  try {
    await fn();
  } catch {}
}

export async function signOutEverywhere(logoutHookResult?: any) {
  markSigningOut();
  const client = typeof window !== "undefined" ? (window as any).__trenchParaClient : null;

  await Promise.all([
    callMaybe(logoutHookResult?.logoutAsync?.bind(logoutHookResult)),
    callMaybe(logoutHookResult?.logout?.bind(logoutHookResult)),
    callMaybe(client?.logoutAsync?.bind(client)),
    callMaybe(client?.logout?.bind(client)),
    callMaybe(client?.signOut?.bind(client)),
    callMaybe(client?.clearSession?.bind(client)),
    callMaybe(client?.disconnect?.bind(client)),
  ]);

  clearParaStorage();
  if (typeof window !== "undefined") delete (window as any).__trenchParaClient;
  setMe(undefined);
  if (typeof window !== "undefined") {
    window.setTimeout(() => setMe(undefined), 100);
    window.setTimeout(() => setMe(undefined), 750);
  }
}
