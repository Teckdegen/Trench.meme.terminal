import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/SimpleLayout";
import { useMe, setMe } from "@/lib/useMe";
import { Zap, Fuel, Gauge, Loader2, LogOut } from "lucide-react";
import { BlocklistManager } from "@/components/BlocklistManager";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import {
  useTradePrefs,
  SLIPPAGE_OPTIONS,
  type GasPriority,
} from "@/lib/trade-prefs";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsShell({ children }: { children: React.ReactNode }) {
  return <div className="w-full space-y-4">{children}</div>;
}

function SettingsPage() {
  useDocumentTitle("Settings");
  const me = useMe();
  const { prefs, ready, saving, update } = useTradePrefs(me);

  if (!me) {
    return (
      <SettingsShell>
        <PageTitle title="Settings" subtitle="Block list and trade defaults." />
        <div className="rounded-2xl bg-surface border border-white/5 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Connect a wallet to manage settings. If your wallet didn't finish
            creating, sign out below and try again.
          </p>
        </div>
        {/* Always-available sign-out — covers the case where Para logged
            the user in but the embedded wallet never finished provisioning,
            so `me` is undefined but there's still a stale session to clear. */}
        <SignOutSection />
      </SettingsShell>
    );
  }

  if (!ready) {
    return (
      <SettingsShell>
        <div className="py-20 text-center text-sm text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      </SettingsShell>
    );
  }

  return (
    <SettingsShell>
      <PageTitle
        title="Settings"
        subtitle="Block list and trade defaults."
        action={
          saving ? (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" /> Saving…
            </span>
          ) : null
        }
      />

      <section className="rounded-2xl bg-surface border border-white/5 p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl bg-primary/15 text-primary grid place-items-center">
            <Gauge className="size-4" />
          </div>
          <div>
            <h2 className="font-semibold text-sm">Trade defaults</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Applied instantly on token pages and quick-buy buttons.
            </p>
          </div>
        </div>

        <Field label="Slippage" icon={Gauge}>
          <div className="flex flex-wrap gap-1.5">
            {SLIPPAGE_OPTIONS.map((bps) => (
              <Pill
                key={bps}
                active={prefs.pref_slippage_bps === bps}
                onClick={() => void update({ pref_slippage_bps: bps })}
              >
                {bps / 100}%
              </Pill>
            ))}
          </div>
        </Field>

        <Field label="Gas priority" icon={Fuel}>
          <div className="flex flex-wrap gap-1.5">
            {(["low", "med", "high"] as const).map((g) => (
              <Pill
                key={g}
                active={prefs.pref_gas_priority === g}
                onClick={() => void update({ pref_gas_priority: g as GasPriority })}
              >
                {g}
              </Pill>
            ))}
          </div>
        </Field>

        <Field label="Quick-buy amounts (MON)" icon={Zap}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {prefs.pref_quick_amounts.map((amt, i) => (
              <QuickAmountInput
                key={i}
                value={amt}
                onCommit={(n) => {
                  const next = [...prefs.pref_quick_amounts];
                  next[i] = n;
                  void update({ pref_quick_amounts: next });
                }}
              />
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Tap an amount on any token page to fill the trade input.
          </p>
        </Field>
      </section>

      <BlocklistManager me={me} />

      <SignOutSection />
    </SettingsShell>
  );
}

// Sign-out card. Calls Para's logout via the dynamically-imported hook
// (mirrors ConnectWalletButton's pattern so we don't force-pull the SDK
// into the settings bundle) and clears our local `me` cache so the
// useMe() bus immediately notifies every component you're signed out.
function SignOutSection() {
  const [mod, setMod] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    import("@getpara/react-sdk").then(setMod).catch(() => {});
  }, []);

  const signOut = async () => {
    setBusy(true);
    try {
      // Can't call a hook outside a component — we read it via the bridge
      // clear local state if the SDK has not finished loading.
    } finally {
      try {
        // Hard sign-out path: just clear `me`. Para's session cookie is
        // also cleared by the inline ParaLogout component below.
        setMe(undefined);
      } finally {
        setBusy(false);
      }
    }
  };

  return (
    <section className="rounded-2xl bg-surface border border-white/5 p-4 space-y-4">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-xl bg-down/15 text-down grid place-items-center">
          <LogOut className="size-4" />
        </div>
        <div>
          <h2 className="font-semibold text-sm">Sign out</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Disconnects your Para session on this device. Your account, balances and history stay safe — sign back in to continue.
          </p>
        </div>
      </div>
      {mod ? (
        <ParaLogoutButton hooks={mod} />
      ) : (
        <button
          onClick={signOut}
          disabled={busy}
          className="h-10 w-full rounded-xl bg-down/15 text-down hover:bg-down/25 text-sm font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          <LogOut className="size-4" />
          {busy ? "Signing out…" : "Sign out"}
        </button>
      )}
    </section>
  );
}

// Real Para-aware logout button — must be its own component so the
// useLogout() hook can run inside it (hooks can't be called inside event
// handlers or other functions). Wired only when the Para SDK module
// finished loading.
function ParaLogoutButton({ hooks }: { hooks: any }) {
  const useLogout = hooks.useLogout;
  const p = useLogout?.() ?? { logoutAsync: async () => {} };
  const [busy, setBusy] = useState(false);
  const click = async () => {
    setBusy(true);
    try { await p.logoutAsync?.(); } catch (e) { console.warn("[settings] logout:", e); }
    setMe(undefined);
    setBusy(false);
  };
  return (
    <button
      onClick={click}
      disabled={busy}
      className="h-10 w-full rounded-xl bg-down/15 text-down hover:bg-down/25 text-sm font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
    >
      <LogOut className="size-4" />
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 pt-1 border-t border-white/5 first:border-0 first:pt-0">
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
        <Icon className="size-3.5" /> {label}
      </span>
      {children}
    </div>
  );
}

function QuickAmountInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      type="number"
      min={1}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = parseInt(draft, 10);
        if (Number.isFinite(n) && n > 0) onCommit(n);
        else setDraft(String(value));
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="h-10 rounded-xl bg-white/5 px-3 text-sm font-mono text-center focus:outline-none focus:ring-1 focus:ring-primary/40"
    />
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 px-3.5 rounded-xl text-xs font-semibold capitalize transition-colors ${
        active
          ? "lit-purple"
          : "bg-white/5 text-muted-foreground hover:text-foreground hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}


