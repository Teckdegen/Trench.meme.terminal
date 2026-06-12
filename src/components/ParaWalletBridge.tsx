import { useEffect, useRef } from "react";
import { setMe, useMe } from "@/lib/useMe";
import { registerParaWallet } from "@/lib/para-session";

export function ParaWalletBridge({ hooks }: { hooks: any }) {
  const me = useMe();
  if (!hooks || !me) return null;
  return <BridgeInner hooks={hooks} me={me} />;
}

function embeddedWalletFromAccount(account: any, client: any) {
  const wallets =
    account?.embedded?.wallets ??
    account?.embedded?.walletsByType?.EVM ??
    Object.values(client?.wallets ?? {}).filter((w: any) => w?.type === "EVM");
  return Array.isArray(wallets) ? wallets[0] : undefined;
}

function BridgeInner({ hooks, me }: { hooks: any; me: string }) {
  const useAccount = hooks.useAccount;
  const useClient = hooks.useClient;
  const account = useAccount?.() ?? {};
  const client = useClient?.();
  const registeredFor = useRef<string | null>(null);

  const wallet = embeddedWalletFromAccount(account, client);
  const walletId = wallet?.id ?? wallet?.walletId ?? null;
  const uiOwner =
    wallet?.address ??
    account?.address ??
    account?.embedded?.address ??
    Object.values(client?.wallets ?? {})?.find((w: any) => w?.type === "EVM")?.address ??
    null;
  const paraUserId = account?.userId ?? account?.embedded?.userId ?? client?.userId ?? null;

  useEffect(() => {
    const authOwner = typeof uiOwner === "string" ? uiOwner.toLowerCase() : "";
    if (!account?.isConnected || account?.isLoading || !client || !walletId || !me || !authOwner) return;
    const key = `${authOwner}:${walletId}:${paraUserId ?? ""}`;
    if (registeredFor.current === key) return;

    let cancel = false;
    (async () => {
      try {
        const exportSession =
          client.waitAndExportSession ??
          client.exportSession ??
          client.exportSessionAsync;
        const session = exportSession
          ? await exportSession.call(client, { excludeSigners: false })
          : null;
        const sessionCookie = client.retrieveSessionCookie?.() ?? null;
        const registered = await registerParaWallet({
          data: {
            owner: authOwner,
            paraUserId,
            walletId,
            session: typeof session === "string" ? session : null,
            sessionCookie,
          },
        });
        const apiOwner = registered?.owner?.toLowerCase?.();
        if (!cancel) {
          registeredFor.current = key;
          if (apiOwner && /^0x[a-f0-9]{40}$/.test(apiOwner)) setMe(apiOwner);
        }
      } catch (e) {
        console.warn("[ParaWalletBridge] register failed, will retry", e);
      }
    })();

    return () => {
      cancel = true;
    };
  }, [account?.isConnected, account?.isLoading, client, me, paraUserId, uiOwner, walletId]);

  return null;
}
