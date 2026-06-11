// Captures ?ref=CODE on landing → stashes in localStorage for the
// ReferralOnboarding modal (user confirms with Apply). We do NOT auto-bond
// on wallet connect — that raced the modal and could bond the wrong referrer.

import { useEffect } from "react";

const KEY = "monad.refCode";

export function ReferralCapture() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const u = new URL(window.location.href);
    const ref = u.searchParams.get("ref");
    if (!ref) return;
    if (!localStorage.getItem(KEY)) {
      localStorage.setItem(KEY, ref.trim().toLowerCase());
    }
    u.searchParams.delete("ref");
    window.history.replaceState({}, "", u.toString());
  }, []);

  return null;
}

export { KEY as REFERRAL_CODE_STORAGE_KEY };
