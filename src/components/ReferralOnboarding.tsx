// First-time referral bonding modal.
//
// Triggered once per wallet, after sign-in. Shown only if:
//   1. We have a connected wallet (`useMe`)
//   2. That wallet has no row in `referrals` yet (not bonded to anyone)
//   3. We haven't already shown + dismissed it this session
//
// User either types in a referrer's code (`trench042`, etc) and applies,
// or skips. Either way we call `bondReferralForNewUser` — on skip the
// server falls back to the platform default (env: DEFAULT_REFERRAL_CODE)
// so every user ends up bonded to someone. They never see the default.

import { useEffect, useState } from "react";
import { X, Loader2, Check } from "lucide-react";
import { useMe } from "@/lib/useMe";
import { SUPABASE_ENABLED } from "@/lib/supabase-hooks";
import { bondReferralForNewUser, isReferralBonded } from "@/lib/rewards";
import { REFERRAL_CODE_STORAGE_KEY } from "@/components/ReferralCapture";

const DISMISSED_KEY = "monad.ref.bonded";

export function ReferralOnboarding() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Decide whether to show. Runs once per `me` (per wallet, per browser).
  //
  //   1. If we've already shown + bonded this wallet on this device, the
  //      DISMISSED_KEY localStorage entry tells us to stay shut — never
  //      pop again, even on full page reload. (Old code cleared this on
  //      a null DB read, which fired EVERY reload because the anon
  //      client can't read `referrals` under RLS.)
  //   2. Otherwise hit the admin-backed server fn to authoritatively
  //      check if the wallet is bonded. If yes, persist DISMISSED and
  //      stay shut. If no, pop the modal once.
  useEffect(() => {
    if (!me || !SUPABASE_ENABLED) return;
    const lc = me.toLowerCase();
    if (typeof window !== "undefined" && localStorage.getItem(DISMISSED_KEY) === lc) {
      return; // shown + handled before on this device, don't re-prompt
    }
    let cancel = false;
    (async () => {
      try {
        const { bonded } = await isReferralBonded({ data: { me: lc } });
        if (cancel) return;
        if (bonded) {
          try { localStorage.setItem(DISMISSED_KEY, lc); } catch {}
          return;
        }
        const fromUrl = typeof window !== "undefined"
          ? localStorage.getItem(REFERRAL_CODE_STORAGE_KEY)
          : null;
        if (fromUrl) setCode(fromUrl.replace(/[^a-zA-Z0-9]/g, "").toLowerCase());
        setOpen(true);
      } catch {
        // server fn failed — don't pop the modal on transient errors,
        // user can always enter their code later from /rewards.
      }
    })();
    return () => { cancel = true; };
  }, [me]);

  const markBonded = () => {
    if (!me) return;
    try {
      localStorage.setItem(DISMISSED_KEY, me.toLowerCase());
      localStorage.removeItem(REFERRAL_CODE_STORAGE_KEY);
    } catch { /* ignore */ }
  };

  const closeWithoutBond = () => {
    // Even on close-without-bond, mark dismissed so the modal doesn't
    // hammer the user on every reload. They can still enter a code
    // from /rewards if they change their mind.
    if (me) {
      try { localStorage.setItem(DISMISSED_KEY, me.toLowerCase()); } catch {}
    }
    setOpen(false);
  };

  const finishSuccess = () => {
    markBonded();
    setDone(true);
    setTimeout(() => setOpen(false), 1000);
  };

  // Apply (with the typed code) or Skip (no code → server default).
  const submit = async (withCode: boolean) => {
    if (!me) return;
    const trimmed = code.trim().toLowerCase();
    if (withCode && trimmed.length < 3) {
      setErr("Enter a valid code (at least 3 characters).");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await bondReferralForNewUser({
        data: { owner: me, code: withCode ? trimmed : null },
      });
      if (res.bonded) {
        finishSuccess();
        return;
      }
      if (res.reason === "no_valid_code" && withCode) {
        setErr("That code doesn't exist. Check the spelling (e.g. trench042).");
        return;
      }
      if (res.reason === "self_referral") {
        setErr("You can't use your own referral code.");
        return;
      }
      if (res.reason === "already_bonded") {
        markBonded();
        setErr("You're already linked to a referrer.");
        setTimeout(() => setOpen(false), 2000);
        return;
      }
      if (!withCode) {
        setErr("No default referrer configured — try entering a friend's code.");
        return;
      }
      setErr("Could not apply that code. Try again.");
    } catch (e: any) {
      setErr(e?.message ?? "Could not apply code");
    } finally {
      setBusy(false);
    }
  };

  if (!open || !me) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center px-3">
      <button
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        onClick={closeWithoutBond}
        aria-label="Close"
      />
      <div
        className="relative w-full max-w-sm rounded-3xl bg-background border border-white/10 overflow-hidden"
        style={{ boxShadow: "0 30px 80px rgba(0,0,0,0.8)" }}
      >
        <div className="px-5 pt-5 flex items-center justify-between">
          <h2 className="font-bold text-base">Got a referral code?</h2>
          <button
            onClick={closeWithoutBond}
            className="size-8 grid place-items-center rounded-full hover:bg-white/10 text-muted-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 pb-5 pt-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Enter the code your friend shared so they earn a kickback on every
            trade you make. Codes look like <span className="font-mono text-foreground">trench042</span>.
          </p>

          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase())}
            onKeyDown={(e) => e.key === "Enter" && code.trim() && submit(true)}
            placeholder="trench042"
            disabled={busy || done}
            autoFocus
            className="mt-4 w-full h-12 rounded-xl bg-white/[0.04] border border-white/10 px-4 text-[15px] font-mono tracking-wide focus:outline-none focus:border-primary/40 disabled:opacity-50"
            maxLength={20}
          />
          {err && <p className="text-xs text-down mt-2">{err}</p>}
          {done && (
            <p className="text-xs text-primary mt-2 inline-flex items-center gap-1">
              <Check className="size-3" /> Locked in. Welcome to trench.meme.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 mt-4">
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={busy || done}
              className="h-11 rounded-xl bg-white/5 hover:bg-white/10 text-sm font-bold disabled:opacity-50"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={busy || done || code.trim().length < 3}
              className="h-11 rounded-xl lit-purple text-sm font-bold disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {busy ? "Applying…" : "Apply"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
