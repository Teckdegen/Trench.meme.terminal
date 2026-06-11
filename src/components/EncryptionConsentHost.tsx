// Mounts once at the app root. Exposes window.__trenchAskEncryptionConsent()
// as a promise that resolves when the user clicks "Set up" or "Skip".
// cabal-crypto.ts awaits this before triggering Para's signature popup so
// the user understands WHY their wallet is asking them to sign.

import { useEffect, useRef, useState } from "react";
import { Lock, X, ShieldCheck, Key as KeyIcon } from "lucide-react";

type Resolver = (accept: boolean) => void;

export function EncryptionConsentHost() {
  const [open, setOpen] = useState(false);
  const resolverRef = useRef<Resolver | null>(null);

  useEffect(() => {
    (window as any).__trenchAskEncryptionConsent = () =>
      new Promise<boolean>((resolve) => {
        // If already mounted dialog (shouldn't happen) resolve previous first
        if (resolverRef.current) resolverRef.current(false);
        resolverRef.current = resolve;
        setOpen(true);
      });
    return () => { delete (window as any).__trenchAskEncryptionConsent; };
  }, []);

  const finish = (accept: boolean) => {
    setOpen(false);
    resolverRef.current?.(accept);
    resolverRef.current = null;
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center px-3">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm rounded-3xl bg-background border border-white/10 p-6 text-center overflow-hidden"
           style={{ boxShadow: "0 30px 80px rgba(0,0,0,0.8)" }}>
        <button onClick={() => finish(false)} className="absolute top-3 right-3 size-7 grid place-items-center rounded-full bg-white/5 text-muted-foreground">
          <X className="size-3.5" />
        </button>
        <div className="size-14 rounded-2xl bg-primary/15 text-primary grid place-items-center mx-auto">
          <Lock className="size-6" />
        </div>
        <h2 className="text-lg font-bold mt-4">Set up encrypted chat</h2>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          Your cabal messages are end-to-end encrypted. We need <b>one wallet signature</b> to
          generate your private chat keys and back them up so you can recover them on any device.
        </p>
        <ul className="text-left text-[12px] text-muted-foreground space-y-2 mt-4 px-1">
          <li className="inline-flex items-start gap-2"><ShieldCheck className="size-4 text-up shrink-0 mt-px" /> The signature is read-only — no transaction, no gas.</li>
          <li className="inline-flex items-start gap-2"><KeyIcon className="size-4 text-primary shrink-0 mt-px" /> Only you can decrypt your messages. Not us, not the relay.</li>
        </ul>
        <div className="mt-5 flex gap-2">
          <button
            onClick={() => finish(false)}
            className="flex-1 h-11 rounded-xl bg-white/5 text-sm font-semibold"
          >
            Skip
          </button>
          <button
            onClick={() => finish(true)}
            className="flex-1 h-11 rounded-xl lit-purple text-sm font-bold"
          >
            Set up
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
          Skip and your chat keys won't be backed up — clearing browser storage will lose
          access to your cabals.
        </p>
      </div>
    </div>
  );
}
