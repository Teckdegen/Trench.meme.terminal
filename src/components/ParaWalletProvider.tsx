import "@getpara/react-sdk-lite/styles.css";

import { Suspense, createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { setMe, useMe } from "@/lib/useMe";
import { getParaConfig } from "@/lib/para-config";
import { APP_NAME } from "@/lib/brand";
import { ParaWalletBridge } from "@/components/ParaWalletBridge";
import { isSigningOut } from "@/lib/auth-signout";

type Config = { apiKey: string | null };
const ParaSdkContext = createContext<any>(null);

export function useParaSdk() {
  return useContext(ParaSdkContext);
}

export function ParaWalletProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    getParaConfig().then(setConfig).catch(() => setConfig({ apiKey: null }));
  }, []);

  if (typeof window === "undefined") return <>{children}</>;
  if (config === null) return <>{children}</>;
  if (!config.apiKey) return <>{children}</>;

  return (
    <Suspense fallback={<>{children}</>}>
      <ParaInner apiKey={config.apiKey}>{children}</ParaInner>
    </Suspense>
  );
}

function ParaInner({ apiKey, children }: { apiKey: string; children: ReactNode }) {
  const [Mod, setMod] = useState<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const m: any = await import("@getpara/react-sdk-lite");
        setMod(m);
      } catch (e) {
        console.warn("[para] SDK failed to load", e);
      }
    })();
  }, []);

  if (!Mod) return <>{children}</>;
  const ParaProvider = Mod.ParaProvider;
  const Environment = Mod.Environment;

  return (
    <ParaProvider
      paraClientConfig={{
        env: Environment.PROD, // production app
        apiKey,
      }}
      config={{ appName: APP_NAME }}
      configOverrides={{
        themeConfig: { "borderRadius": "md", "foregroundMixRatio": 0.08, "foregroundColor": "#000000", "font": "Inter" },
        authConfig: {
          oAuthMethods: ["GOOGLE", "TWITTER", "APPLE"],
          disableEmailLogin: true,
          disablePhoneLogin: true,
          isGuestModeEnabled: false,
          twoFactorAuthEnabled: false,
        },
        modalConfig: {
          // true — Para must never pop its wallet/add-funds screen on its
          // own. The modal only opens when WE call openModal().
          disableAddFundsPrompt: true,
          authLayout: ["AUTH:FULL"],
          hideWallets: false,
        },
      }}
      paraModalConfig={{
        recoverySecretStepEnabled: true,
        onRampTestMode: true,
      }}
    >
      <ParaSdkContext.Provider value={Mod}>
        {children}
        <ParaSync hooks={Mod} />
        <ParaWalletBridge hooks={Mod} />
      </ParaSdkContext.Provider>
    </ParaProvider>
  );
}

function embeddedWalletFromAccount(account: any) {
  const embedded = account?.embedded;
  const wallets = embedded?.wallets ?? embedded?.walletsByType?.EVM ?? [];
  return Array.isArray(wallets) ? wallets[0] : undefined;
}

function ParaSync({ hooks }: { hooks: any }) {
  const me = useMe();
  const useAccount = hooks.useAccount;
  const useClient = hooks.useClient;
  const useModal = hooks.useModal;
  const account = useAccount?.() ?? { isLoading: true, isConnected: false };
  const client = useClient?.();
  const modal = useModal?.();
  const wallet = embeddedWalletFromAccount(account);
  const address: string | undefined =
    wallet?.address ??
    account?.address ??
    account?.embedded?.address ??
    Object.values(client?.wallets ?? {})?.find((w: any) => w?.type === "EVM")?.address;

  useEffect(() => {
    // Explicit sign-out is the ONLY thing that clears `me`.
    if (isSigningOut()) {
      if (me) setMe(undefined);
      return;
    }
    // BOOTSTRAP ONLY — set `me` only when it is empty. This is the modal's
    // embedded-wallet address, used purely to wake the ParaWalletBridge (which
    // requires a truthy `me` to mount). The bridge then resolves the canonical
    // PREGEN / API wallet and calls setMe() with ITS address — the only wallet
    // the user ever uses, and the one `para_wallets` + server-side signing are
    // keyed to. We must NOT override the bridge's address here on later account
    // refreshes, or trades fail with "No Para REST wallet for 0x…" because `me`
    // got reset to the unused embedded wallet.
    //
    // We also never CLEAR `me` on a disconnect: `me` lives in localStorage and
    // is the source of truth for "signed in". Para's useAccount() reports
    // isConnected=false during hydration and on client navigations even with a
    // live session cookie (good ~a month); clearing on that flicker is what was
    // flashing the login gate and re-firing the referral prompt. A genuinely
    // expired session surfaces at trade time, not as a surprise logout.
    const addr = account?.isConnected ? address?.toLowerCase() : undefined;
    if (addr && !me) setMe(addr);
  }, [account?.isConnected, address, me]);

  // The Para modal must never linger once the user is authenticated — if it
  // is open when the account flips to connected (post-login, or a stray
  // auto-open during an auth-state flicker), close it. The wallet screen in
  // the modal is not part of our UX; funds live in our own Funds modal.
  const wasConnected = useRef(false);
  useEffect(() => {
    if (account?.isConnected && !wasConnected.current) {
      wasConnected.current = true;
      if (modal?.isOpen) modal.closeModal?.();
    } else if (account?.isConnected === false) {
      wasConnected.current = false;
    }
  }, [account?.isConnected, modal?.isOpen]);

  useEffect(() => {
    if (client) (window as any).__trenchParaClient = client;
    else delete (window as any).__trenchParaClient;
    return () => {
      if ((window as any).__trenchParaClient === client) delete (window as any).__trenchParaClient;
    };
  }, [client]);

  return null;
}
