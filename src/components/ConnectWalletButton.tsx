// Topbar wallet pill. Uses Para hooks and opens the Para modal.

import { useEffect, useState } from "react";
import { Wallet, LogOut, Copy, Check } from "lucide-react";
import { useMe, setMe } from "@/lib/useMe";
import { useIdentity, labelFor } from "@/lib/identity";

export function ConnectWalletButton({ compact = false }: { compact?: boolean }) {
  const me = useMe();
  const myId = useIdentity(me);
  const [mod, setMod] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    import("@getpara/react-sdk").then(setMod).catch(() => {});
  }, []);

  const copy = () => {
    if (!me) return;
    const h = myId?.handle;
    navigator.clipboard?.writeText(h ? `@${h}` : me);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // CONNECTED
  if (me) {
    return (
      <div className={`inline-flex items-center gap-1 ${compact ? "h-9" : "h-11"} pr-1 rounded-full bg-white/5`}>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 h-full pl-3 pr-2 text-xs font-mono font-semibold"
          title="Copy @handle"
        >
          <span className="size-2 rounded-full bg-up" />
          {labelFor(myId)}
          {copied ? <Check className="size-3 text-up" /> : <Copy className="size-3 text-muted-foreground" />}
        </button>
        {mod ? <ParaLogoutBtn hooks={mod} /> : (
          <button onClick={() => setMe(undefined)} className="size-7 grid place-items-center rounded-full hover:bg-white/10 text-muted-foreground" title="Sign out">
            <LogOut className="size-3.5" />
          </button>
        )}
      </div>
    );
  }

  // NOT CONNECTED
  if (mod) return <ConnectViaPara hooks={mod} compact={compact} />;
  return (
    <button
      disabled
      className={`${compact ? "h-9 px-3 sm:px-4" : "h-11 px-5"} rounded-full lit-purple inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold`}
    >
      <Wallet className="size-4" />
      {compact ? "Connect" : "Connect wallet"}
    </button>
  );
}

function ConnectViaPara({ hooks, compact }: { hooks: any; compact: boolean }) {
  const useModal = hooks.useModal;
  const modal = useModal?.() ?? { openModal: () => {} };
  return (
    <button
      onClick={() => modal.openModal?.()}
      className={`${compact ? "h-9 px-3 sm:px-4" : "h-11 px-5"} rounded-full lit-purple inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold`}
    >
      <Wallet className="size-4" />
      {compact ? "Connect" : "Connect wallet"}
    </button>
  );
}

function ParaLogoutBtn({ hooks }: { hooks: any }) {
  const useLogout = hooks.useLogout;
  const p = useLogout?.() ?? { logoutAsync: async () => {} };
  const signOut = async () => {
    try { await p.logoutAsync?.(); } catch {}
    setMe(undefined);
  };
  return (
    <button
      onClick={signOut}
      title="Sign out"
      className="size-7 grid place-items-center rounded-full hover:bg-white/10 text-muted-foreground"
    >
      <LogOut className="size-3.5" />
    </button>
  );
}
