// Lightweight 4-step tour. Triggered automatically on the user's first session
// (gated by accounts.onboarded_at or localStorage fallback). Persists "done"
// to the DB so it doesn't re-appear on a new device.

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X, ChevronRight, Sparkles, TrendingUp, Bell, Settings as Cog } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { SUPABASE_ENABLED } from "@/lib/supabase-hooks";
import { useMe } from "@/lib/useMe";
import { ModalShell } from "@/components/ui/modal-shell";

const KEY = "monad.onboarded";

const steps = [
  {
    icon: TrendingUp,
    title: "Discover live tokens",
    body: "The dashboard streams New Pairs, Final Stretch, and Migrated tokens in real time. Tap any card to open the full trading view.",
    cta: { to: "/", label: "Show me" },
  },
  {
    icon: Sparkles,
    title: "Search anything",
    body: "Top bar search resolves token names, tickers, or contract addresses. You can also tap any $TICKER or @handle in posts.",
    cta: null,
  },
  {
    icon: Bell,
    title: "Set alerts",
    body: "Get pinged when prices move, wallets buy, tokens migrate, or volume spikes — all in your in-app Alerts inbox.",
    cta: { to: "/alerts", label: "Create your first" },
  },
  {
    icon: Cog,
    title: "Tune your defaults",
    body: "Slippage, gas priority, quick-buy amounts, and your block list all live in Settings.",
    cta: { to: "/settings", label: "Open settings" },
  },
] as const;

export function OnboardingTour() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(KEY) === "1") return;
    if (!SUPABASE_ENABLED || !me) {
      // Anon fallback — show once based on localStorage alone
      setOpen(true);
      return;
    }
    (async () => {
      const { data } = await supabase().from("accounts")
        .select("onboarded_at").eq("address", me).maybeSingle();
      if (!(data as any)?.onboarded_at) setOpen(true);
    })();
  }, [me]);

  const finish = async () => {
    setOpen(false);
    try { localStorage.setItem(KEY, "1"); } catch {}
    if (me && SUPABASE_ENABLED) {
      await supabase().from("accounts")
        .update({ onboarded_at: new Date().toISOString() }).eq("address", me);
    }
  };

  if (!open) return null;
  const s = steps[step];
  const Icon = s.icon;
  const last = step === steps.length - 1;

  return (
    <ModalShell onClose={finish} className="sm:max-w-md" z="z-[60]">
        <div className="px-4 py-3 flex items-center justify-between border-b border-white/10">
          <div className="flex items-center gap-1">
            {steps.map((_, i) => (
              <span key={i} className={`h-1 rounded-full transition-all ${i === step ? "w-6 bg-primary" : "w-2 bg-white/15"}`} />
            ))}
          </div>
          <button onClick={finish} className="size-7 grid place-items-center rounded-full bg-white/5 text-muted-foreground">
            <X className="size-3.5" />
          </button>
        </div>
        <div className="px-6 py-6">
          <div className="size-12 rounded-2xl bg-primary/15 text-primary grid place-items-center mx-auto">
            <Icon className="size-5" />
          </div>
          <h2 className="text-lg font-bold text-center mt-3">{s.title}</h2>
          <p className="text-sm text-muted-foreground text-center mt-1.5 leading-relaxed">{s.body}</p>
          <div className="flex items-center gap-2 mt-5">
            {s.cta && (
              <Link
                to={s.cta.to as any}
                onClick={finish}
                className="flex-1 h-11 rounded-xl bg-white/5 text-sm font-semibold inline-flex items-center justify-center"
              >
                {s.cta.label}
              </Link>
            )}
            <button
              onClick={() => (last ? finish() : setStep((s) => s + 1))}
              className="flex-1 h-11 rounded-xl lit-purple text-sm font-bold inline-flex items-center justify-center gap-1.5"
            >
              {last ? "Let's go" : "Next"} {!last && <ChevronRight className="size-4" />}
            </button>
          </div>
          {!last && (
            <button onClick={finish} className="block mx-auto mt-3 text-[11px] text-muted-foreground hover:text-foreground">
              Skip tour
            </button>
          )}
        </div>
    </ModalShell>
  );
}
