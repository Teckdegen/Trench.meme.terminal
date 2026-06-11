// useRequireAuth — wrap any click handler so it triggers Para's login modal
// instead of running when the user isn't signed in.
//
// Usage:
//   const requireAuth = useRequireAuth();
//   <button onClick={() => requireAuth(() => follow.toggle())}>Follow</button>
//
// If the user is already signed in, the callback fires immediately. If not,
// Para's social/email modal opens and the callback is queued — it fires
// automatically once `me` becomes defined (so the click "completes" after
// they finish authing).

import { useEffect, useRef, useState } from "react";
import { useMe } from "@/lib/useMe";

type Pending = (() => void | Promise<void>) | null;

export function useRequireAuth() {
  const me = useMe();
  const [paraHooks, setParaHooks] = useState<any>(null);
  const pendingRef = useRef<Pending>(null);

  useEffect(() => {
    if (paraHooks) return;
    import("@getpara/react-sdk-lite").then((m: any) => setParaHooks(m)).catch(() => {});
  }, [paraHooks]);

  // When the user finishes auth, drain any pending action.
  useEffect(() => {
    if (!me) return;
    const fn = pendingRef.current;
    if (fn) {
      pendingRef.current = null;
      // microtask so React has settled first
      Promise.resolve().then(() => { void fn(); });
    }
  }, [me]);

  // Returned callable
  return (action: () => void | Promise<void>) => {
    if (me) return action();
    pendingRef.current = action;
    void paraHooks; // kept for symmetry — actual login() lives in Opener below
    window.dispatchEvent(new Event("trench.require-auth"));
  };
}

/**
 * Mount this once at the app root (alongside LoginGate). Listens for the
 * "trench.require-auth" event dispatched by useRequireAuth() and opens
 * Para's modal. Decoupled from useRequireAuth so we don't have to call
 * Para hooks inside every component that uses requireAuth.
 */
export function RequireAuthModalHost() {
  const me = useMe();
  const [hooks, setHooks] = useState<any>(null);

  useEffect(() => {
    import("@getpara/react-sdk-lite").then((m: any) => setHooks(m)).catch(() => {});
  }, []);

  if (me || !hooks) return null;
  return <Opener hooks={hooks} />;
}

function Opener({ hooks }: { hooks: any }) {
  const useModal = hooks.useModal;
  const modal = useModal?.();

  useEffect(() => {
    const handler = () => modal?.openModal?.();
    window.addEventListener("trench.require-auth", handler);
    return () => window.removeEventListener("trench.require-auth", handler);
  }, [modal]);

  return null;
}
