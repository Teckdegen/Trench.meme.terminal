import "@getpara/react-sdk-lite/styles.css";

import { Suspense, createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setMe, useMe } from "@/lib/useMe";
import { getParaConfig } from "@/lib/para-config";
import { APP_NAME, APP_LOGO } from "@/lib/brand";
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
        apiKey,
        env: Environment.PROD,
      }}
      config={{
        appName: APP_NAME,
      }}
      configOverrides={{
        authConfig: {
          oAuthMethods: ["GOOGLE", "APPLE"],
        },
        modalConfig: {
          hideWallets: true,
          logo: APP_LOGO,
        },
        // Black / white / purple only. NOTE: Para derives every surface and
        // muted-text shade by mixing the background ladder toward the ACCENT
        // color by foregroundMixRatio (their default is 0.04). A ratio of 1
        // collapses the whole palette to flat #a855f7 — purple-on-purple,
        // i.e. the invisible modal we shipped. Keep this small.
        themeConfig: {
          mode: "dark",
          backgroundColor: "#000000",
          foregroundColor: "#ffffff",
          accentColor: "#a855f7",
          borderRadius: "lg",
          foregroundMixRatio: 0.08,
        },
      }}
      paraModalConfig={{
        authLayout: ["AUTH:FULL"],
        oAuthMethods: ["GOOGLE", "APPLE"],
        disableEmailLogin: false,
        disablePhoneLogin: true,
        hideWallets: true,
        logo: APP_LOGO,
        theme: {
          mode: "dark",
          backgroundColor: "#000000",
          foregroundColor: "#ffffff",
          accentColor: "#a855f7",
          borderRadius: "lg",
          foregroundMixRatio: 0.08,
        },
        recoverySecretStepEnabled: true,
        twoFactorAuthEnabled: false,
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
  const account = useAccount?.() ?? { isLoading: true, isConnected: false };
  const client = useClient?.();
  const wallet = embeddedWalletFromAccount(account);
  const address: string | undefined =
    wallet?.address ??
    account?.address ??
    account?.embedded?.address ??
    Object.values(client?.wallets ?? {})?.find((w: any) => w?.type === "EVM")?.address;

  useEffect(() => {
    if (isSigningOut()) {
      if (me) setMe(undefined);
      return;
    }
    const addr = account?.isConnected ? address?.toLowerCase() : undefined;
    if (addr && !me) setMe(addr);
    else if (!account?.isLoading && !account?.isConnected && me) setMe(undefined);
  }, [account?.isConnected, account?.isLoading, address, me]);

  useEffect(() => {
    if (client) (window as any).__trenchParaClient = client;
    else delete (window as any).__trenchParaClient;
    return () => {
      if ((window as any).__trenchParaClient === client) delete (window as any).__trenchParaClient;
    };
  }, [client]);

  return null;
}
