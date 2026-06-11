import { useEffect, useRef } from "react";
import { useMe } from "@/lib/useMe";
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
  const paraUserId = account?.userId ?? account?.embedded?.userId ?? client?.userId ?? null;

  useEffect(() => {
    if (!client || !walletId || !me) return;
    const key = `${me.toLowerCase()}:${walletId}`;
    if (registeredFor.current === key) return;

    let cancel = false;
    (async () => {
      try {
        const exportSession = client.exportSession ?? client.exportSessionAsync;
        const session = exportSession ? await exportSession.call(client) : null;
        const sessionCookie = client.retrieveSessionCookie?.() ?? null;
        await registerParaWallet({
          data: {
            owner: me,
            paraUserId,
            walletId,
            session: typeof session === "string" ? session : null,
            sessionCookie,
          },
        });
        if (!cancel) registeredFor.current = key;
      } catch (e) {
        console.warn("[ParaWalletBridge] register failed, will retry", e);
      }
    })();

    return () => {
      cancel = true;
    };
  }, [client, me, paraUserId, walletId]);

  return null;
}
