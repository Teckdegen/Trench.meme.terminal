// Forced login gate. Renders an overlay when no wallet is connected and
// auto-opens Para's modal (Google / Apple / X / Discord / Farcaster /
// Telegram / email / phone). The user can't dismiss the modal — closing
// it just reopens it immediately.
//
// Mounted in __root.tsx alongside the rest of the global overlays.

import { useEffect, useState } from "react";
import { useMe } from "@/lib/useMe";
import { APP_NAME, APP_LOGO } from "@/lib/brand";
import { useParaSdk } from "@/components/ParaWalletProvider";

// Routes that are viewable WITHOUT logging in. The gate still mounts the
// Para modal so users can sign in if they want, but it doesn't force them.
// Any action inside these pages (follow, message, react) must use
// useRequireAuth() so it triggers the modal on click.
function isPublicRoute(pathname: string): boolean {
  // Profiles — /@handle and /profile/handle (no login required to view)
  if (pathname.startsWith("/profile/")) return true;
  if (pathname.startsWith("/@")) return true;
  return false;
}

export function LoginGate() {
  const me = useMe();
  const hooks = useParaSdk();
  const [pathname, setPathname] = useState(() =>
    typeof window === "undefined" ? "/" : window.location.pathname,
  );

  // Track route changes so the gate re-evaluates when navigating
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", update);
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args) { origPush.apply(this, args); update(); };
    history.replaceState = function (...args) { origReplace.apply(this, args); update(); };
    return () => {
      window.removeEventListener("popstate", update);
      history.pushState = origPush;
      history.replaceState = origReplace;
    };
  }, []);

  // Don't show the gate while Para is still hydrating — that's what caused
  // the "flickering between gate and app" bug. We need to KNOW the user is
  // unauthenticated before forcing them to login.
  if (!hooks) return null;
  if (me) return null;
  if (isPublicRoute(pathname)) return null;
  return <GateInner hooks={hooks} />;
}

function GateInner({ hooks }: { hooks: any }) {
  const useAccount = hooks.useAccount;
  const account = useAccount?.() ?? { isLoading: true, isConnected: false };

  // Two more guards: Para reports ready=false while it boots, and
  // authenticated=true means the user IS signed in (race with useMe()).
  // Either case → don't show the gate.
  if (account.isLoading) return null;
  if (account.isConnected) return null;

  return (
    <>
      <div className="fixed inset-0 z-20 grid place-items-center px-3">
        <div className="absolute inset-0 bg-black/85 backdrop-blur-xl" />
        {/* Brand glow behind the card */}
        <div className="absolute pointer-events-none"
          style={{
            width: 600, height: 600,
            background: "radial-gradient(circle, rgba(168,85,247,0.25), transparent 65%)",
            filter: "blur(40px)",
          }}
        />
        <div
          className="relative w-full max-w-sm rounded-3xl bg-background/95 backdrop-blur-sm border border-white/10 p-8 text-center overflow-hidden"
          style={{ boxShadow: "0 30px 80px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05)" }}
        >
          {/* Top sheen */}
          <div className="absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

          <img
            src={APP_LOGO}
            alt={APP_NAME}
            className="size-16 rounded-2xl mx-auto object-cover"
            style={{ boxShadow: "0 8px 30px -6px rgba(168,85,247,0.5)" }}
          />
          <h2 className="text-xl font-bold mt-5 tracking-tight">Sign in to {APP_NAME}</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Login or create an account to start trading.
          </p>
          {hooks ? (
            <OpenParaModalButton hooks={hooks} />
          ) : (
            <button disabled className="mt-6 w-full h-12 rounded-2xl bg-white/5 text-sm font-bold opacity-60 inline-flex items-center justify-center gap-2">
              <span className="size-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              Loading…
            </button>
          )}
          <p className="text-[10px] text-muted-foreground mt-5">
            By signing up, you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
      {/* Auto-opener uses Para's usePara hook — must be a child of
          ParaProvider, which it is (mounted in __root.tsx). */}
      {hooks && <AutoOpener hooks={hooks} />}
    </>
  );
}

// Click handler that calls Para's login() to trigger the OAuth flow.
function OpenParaModalButton({ hooks }: { hooks: any }) {
  const useModal = hooks.useModal;
  const modal = useModal?.() ?? { openModal: () => {} };
  return (
    <button
      onClick={() => modal.openModal?.()}
      className="mt-6 w-full h-12 rounded-2xl lit-purple text-sm font-bold"
    >
      Continue
    </button>
  );
}

// Auto-opens Para's modal ONCE per page load. We deliberately do NOT
// re-open on close — Para's email-code flow has multiple steps (enter
// email → enter code) and any forced re-open during the flow resets the
// modal to step 1, which is the "stuck on email page" bug we shipped.
// If the user closes the modal, our gate UI still shows the Continue
// button so they can re-trigger it themselves.
//
// The flag is MODULE-level, not a ref: the gate unmounts/remounts on
// route changes (e.g. clicking the topbar logo), and a per-mount ref made
// every remount auto-open the modal again — for signed-in users a brief
// auth-state flicker then popped Para's wallet screen out of nowhere.
let autoOpenedThisPageLoad = false;

function AutoOpener({ hooks }: { hooks: any }) {
  const useAccount = hooks.useAccount;
  const useModal = hooks.useModal;
  const account = useAccount?.() ?? { isLoading: true, isConnected: false };
  const modal = useModal?.();

  useEffect(() => {
    if (account.isLoading) return;
    if (!autoOpenedThisPageLoad && account.isConnected === false) {
      modal?.openModal?.();
      autoOpenedThisPageLoad = true;
    }
  }, [account.isLoading, account.isConnected, modal]);

  return null;
}

