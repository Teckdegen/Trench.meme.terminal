import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageTitle } from "@/components/SimpleLayout";
import {
  Plus, Bell, TrendingUp, Zap, ArrowUpRight, ArrowDownLeft, Wallet, Activity, Coins,
  Target, ChevronRight, X, Trash2, Pause, Play, Search, Smartphone, Check,
} from "lucide-react";
import { useNotifications, markNotificationRead, SUPABASE_ENABLED } from "@/lib/supabase-hooks";
import { useIdentities, labelFor } from "@/lib/identity";
import { useAnnouncements } from "@/lib/announcements";
import { Megaphone } from "lucide-react";
import { useMe } from "@/lib/useMe";
import { supabase } from "@/lib/supabase";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { listAlerts, createAlert, toggleAlert, deleteAlert } from "@/lib/alerts-server";

export const Route = createFileRoute("/alerts")({ component: Alerts });

// -------- types ----------------------------------------------------------
type AlertKind = "price" | "progress" | "launch" | "wallet" | "volume" | "holder";
type Comparator = ">" | "<" | ">=" | "<=" | "==" | "any";

type AlertRow = {
  id: string;
  owner_address: string;
  kind: AlertKind;
  token_address: string | null;
  wallet_address: string | null;
  comparator: Comparator;
  threshold: number | null;
  enabled: boolean;
  push_inapp: boolean;
  push_telegram: boolean;
  push_email: boolean;
  note: string | null;
  last_fired_at: string | null;
};

// -------- templates ------------------------------------------------------
const templates: {
  kind: AlertKind;
  label: string;
  desc: string;
  icon: any;
  tone: string;
  defaults: Partial<AlertRow>;
}[] = [
  { kind: "price",    label: "Price moves",       desc: "Get pinged when a token crosses a price",          icon: TrendingUp,     tone: "bg-up/15 text-up",     defaults: { comparator: ">", threshold: 0 } },
  { kind: "progress", label: "Bonding progress",  desc: "Notify me when a token is close to migrating",     icon: Target,         tone: "bg-primary/15 text-primary", defaults: { comparator: ">=", threshold: 80 } },
  { kind: "launch",   label: "New launch",        desc: "Anytime a fresh token is created",                 icon: Zap,            tone: "bg-primary/15 text-primary", defaults: { comparator: "any" } },
  { kind: "wallet",   label: "Wallet activity",   desc: "Watch a specific wallet's buys / sells",           icon: Wallet,         tone: "bg-cyan-500/15 text-cyan-400", defaults: { comparator: "any" } },
  { kind: "volume",   label: "Volume spike",      desc: "Trigger on single-trade USD volume",               icon: Activity,       tone: "bg-amber-500/15 text-amber-400", defaults: { comparator: ">", threshold: 10000 } },
  { kind: "holder",   label: "Holder milestone",  desc: "Fire when a token crosses a holder count",         icon: Coins,          tone: "bg-pink-500/15 text-pink-400", defaults: { comparator: ">", threshold: 500 } },
];

const tabs = ["Inbox", "Rules"] as const;
type Tab = typeof tabs[number];

function Alerts() {
  useDocumentTitle("Alerts");
  const me = useMe();
  const [tab, setTab] = useState<Tab>("Inbox");
  const [creating, setCreating] = useState<AlertKind | null>(null);
  const [rules, setRules] = useState<AlertRow[]>([]);
  const notifs = useNotifications(me);

  // Pull alert rules via server fn (admin client bypasses RLS — anon
  // client couldn't read because we don't issue Supabase JWTs).
  const refresh = async () => {
    if (!SUPABASE_ENABLED || !me) { setRules([]); return; }
    try {
      const rows = await listAlerts({ data: { me } });
      setRules(rows as AlertRow[]);
    } catch (e) {
      console.error("[alerts] list failed", e);
    }
  };
  useEffect(() => { refresh(); }, [me]);

  const unread = (notifs ?? []).filter((n) => !n.read).length;

  return (
    <div className="space-y-4">
      <PageTitle
        title="Alerts"
        subtitle="Set triggers and get pinged in your in-app Alerts inbox."
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCreating("price")}
              className="h-9 px-4 rounded-full lit-purple text-sm font-semibold inline-flex items-center gap-1.5"
            >
              <Plus className="size-4" /> New alert
            </button>
          </div>
        }
      />

      {/* Top tabs */}
      <div className="flex gap-1 p-1 rounded-full bg-white/5 w-fit">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`h-8 px-4 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 ${
              tab === t ? "lit-purple" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
            {t === "Inbox" && unread > 0 && (
              <span className="ml-1 size-5 rounded-full bg-down text-[10px] font-bold grid place-items-center text-white">
                {unread}
              </span>
            )}
            {t === "Rules" && rules.length > 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground">({rules.length})</span>
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
        {/* Main column */}
        <div className="rounded-2xl bg-surface border border-white/5 overflow-hidden">
          {tab === "Inbox" ? <InboxView notifs={notifs} /> : <RulesView rules={rules} onChange={refresh} />}
        </div>

        {/* Templates rail */}
        <aside className="rounded-2xl bg-surface border border-white/5 p-4 space-y-3 h-fit xl:sticky xl:top-4">
          <h3 className="font-semibold text-sm inline-flex items-center gap-2">
            <Bell className="size-4" /> Templates
          </h3>
          <p className="text-xs text-muted-foreground">Pick a starting point. You can refine it next.</p>
          <ul className="space-y-1.5">
            {templates.map((t) => {
              const Icon = t.icon;
              return (
                <li key={t.kind}>
                  <button
                    onClick={() => setCreating(t.kind)}
                    className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5"
                  >
                    <div className={`size-9 rounded-xl grid place-items-center ${t.tone}`}>
                      <Icon className="size-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">{t.label}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{t.desc}</p>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>

      {creating && (
        <CreateAlertModal
          kind={creating}
          me={me}
          onClose={() => setCreating(null)}
          onCreated={() => { setCreating(null); setTab("Rules"); refresh(); }}
        />
      )}
    </div>
  );
}

// -------- inbox view -----------------------------------------------------
function InboxView({ notifs }: { notifs: ReturnType<typeof useNotifications> }) {
  const me = useMe();
  // Announcements from @trenchmem appear in EVERY user's alerts inbox,
  // at the top, until newer alerts arrive.
  const announcements = useAnnouncements({ limit: 10 });

  if (!notifs) return <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>;
  if (notifs.length === 0 && announcements.length === 0) {
    return (
      <div className="py-16 text-center px-6">
        <div className="size-12 rounded-full bg-white/5 grid place-items-center mx-auto">
          <Bell className="size-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-semibold mt-3">No alerts yet</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
          Create a rule from the templates on the right. We'll ping you as soon as it triggers.
        </p>
      </div>
    );
  }
  return (
    <ul>
      {announcements.map((a) => (
        <li key={`ann:${a.id}`}>
          <Link
            to="/feed"
            className="flex items-start gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/[0.03]"
            style={{ background: "linear-gradient(90deg, rgba(251,191,36,0.04), transparent)" }}
          >
            <span className="mt-1.5 size-1.5 rounded-full bg-[#fbbf24] shrink-0" />
            <div
              className="size-10 rounded-xl grid place-items-center shrink-0"
              style={{ background: "rgba(251,191,36,0.15)" }}
            >
              <Megaphone className="size-4 text-[#fbbf24]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold truncate">Announcement from trench.meme</p>
                <span className="text-[9px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: "rgba(251,191,36,0.18)", color: "#fbbf24" }}>
                  Official
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground line-clamp-2 mt-0.5">{a.body}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {new Date(a.created_at).toLocaleString()}
              </p>
            </div>
          </Link>
        </li>
      ))}
      {notifs.map((n) => {
        const k = n.kind.replace("alert.", "");
        const Icon =
          k === "wallet" ? Wallet :
          k === "launch" ? Zap :
          k === "volume" ? Activity :
          k === "holder" ? Coins :
          k === "progress" ? Target :
          TrendingUp;
        return (
          <li key={n.id}>
            <Link
              to={n.link as any ?? "/alerts"}
              onClick={() => markNotificationRead(n.id, me)}
              className={`flex items-start gap-3 px-4 py-3 hover:bg-white/[0.03] border-b border-white/5 ${n.read ? "opacity-70" : ""}`}
            >
              {!n.read && <span className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />}
              <div className="size-10 rounded-xl grid place-items-center bg-white/5 shrink-0">
                <Icon className="size-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{n.title}</p>
                {n.body && <p className="text-[12px] text-muted-foreground line-clamp-2">{n.body}</p>}
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {new Date(n.created_at).toLocaleString()}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// -------- rules view -----------------------------------------------------
function RulesView({ rules, onChange }: { rules: AlertRow[]; onChange: () => void }) {
  const me = useMe();
  const walletAddrs = rules.map((r) => r.wallet_address).filter(Boolean) as string[];
  const idMap = useIdentities(walletAddrs);

  const toggle = async (id: string, enabled: boolean) => {
    if (!me) return;
    try {
      await toggleAlert({ data: { me, id, enabled: !enabled } });
      onChange();
    } catch (e) { console.error("[alerts] toggle failed", e); }
  };
  const remove = async (id: string) => {
    if (!me) return;
    try {
      await deleteAlert({ data: { me, id } });
      onChange();
    } catch (e) { console.error("[alerts] delete failed", e); }
  };

  if (rules.length === 0) {
    return (
      <div className="py-16 text-center px-6">
        <div className="size-12 rounded-full bg-white/5 grid place-items-center mx-auto">
          <Target className="size-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-semibold mt-3">No rules yet</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
          Use the templates on the right to set up your first alert.
        </p>
      </div>
    );
  }

  return (
    <ul>
      {rules.map((r) => {
        const tpl = templates.find((t) => t.kind === r.kind);
        const Icon = tpl?.icon ?? Bell;
        const subject =
          r.token_address ? `Token ${shortAddr(r.token_address)}`
          : r.wallet_address ? labelFor(idMap[r.wallet_address.toLowerCase()], { at: true })
          : "Any";
        const condition = r.comparator === "any"
          ? "any event"
          : `${r.comparator} ${r.threshold ?? ""}`;
        return (
          <li key={r.id} className="border-b border-white/5">
            <div className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.03]">
              <div className={`size-10 rounded-xl grid place-items-center ${tpl?.tone ?? "bg-white/5"}`}>
                <Icon className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold">{tpl?.label ?? r.kind}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">{subject}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">{condition}</span>
                  {r.last_fired_at && (
                    <span className="text-[11px] text-muted-foreground">
                      · last fired {timeAgo(new Date(r.last_fired_at).getTime() / 1000)} ago
                    </span>
                  )}
                </div>
                {r.note && <p className="text-[12px] text-muted-foreground mt-0.5 truncate">{r.note}</p>}
                {r.push_inapp && (
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
                    <Channel on label="In-app" icon={Bell} />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => toggle(r.id, r.enabled)}
                  className="h-8 w-8 grid place-items-center rounded-full bg-white/5 hover:bg-white/10"
                  title={r.enabled ? "Pause" : "Resume"}
                >
                  {r.enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                </button>
                <button
                  onClick={() => remove(r.id)}
                  className="h-8 w-8 grid place-items-center rounded-full bg-white/5 hover:text-down"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Channel({ on, label, icon: Icon }: { on: boolean; label: string; icon: any }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${on ? "bg-primary/15 text-primary" : "bg-white/5 text-muted-foreground"}`}>
      <Icon className="size-2.5" /> {label}
    </span>
  );
}

// -------- create alert modal --------------------------------------------
function CreateAlertModal({
  kind, me, onClose, onCreated,
}: { kind: AlertKind; me: string | undefined; onClose: () => void; onCreated: () => void }) {
  const tpl = templates.find((t) => t.kind === kind)!;
  const [comparator, setComparator] = useState<Comparator>((tpl.defaults.comparator as Comparator) ?? "any");
  const [threshold, setThreshold] = useState<string>(tpl.defaults.threshold != null ? String(tpl.defaults.threshold) : "");
  const [target, setTarget] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const needsTarget = kind !== "launch";
  const needsThreshold = comparator !== "any";

  const save = async () => {
    if (!me) return;
    setSaving(true);
    try {
      const isWallet = kind === "wallet";
      await createAlert({
        data: {
          me,
          kind,
          token_address: !isWallet && target ? target.toLowerCase() : null,
          wallet_address: isWallet && target ? target.toLowerCase() : null,
          comparator,
          threshold: threshold ? Number(threshold) : null,
          note: note || null,
        },
      });
      onCreated();
    } catch (e) {
      console.error("[alerts] create failed", e);
      alert(e instanceof Error ? e.message : "Could not save alert");
    } finally {
      setSaving(false);
    }
  };

  const Icon = tpl.icon;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-3">
      <button className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-lg rounded-3xl bg-background overflow-hidden border border-white/10"
           style={{ boxShadow: "0 30px 80px rgba(0,0,0,0.8)" }}>
        <div className="px-4 py-4 flex items-center gap-3 border-b border-white/10">
          <button onClick={onClose} className="size-8 grid place-items-center rounded-full bg-white/5">
            <X className="size-4" />
          </button>
          <div className={`size-9 rounded-xl grid place-items-center ${tpl.tone}`}>
            <Icon className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold truncate">{tpl.label}</h2>
            <p className="text-[11px] text-muted-foreground truncate">{tpl.desc}</p>
          </div>
          <button
            onClick={save}
            disabled={saving || !me || (needsTarget && !target) || (needsThreshold && !threshold)}
            className="h-8 px-4 rounded-full lit-purple text-sm font-semibold disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save alert"}
          </button>
        </div>

        {!me && (
          <div className="mx-4 mt-4 px-3 py-2 rounded-xl bg-down/10 text-xs text-down">
            Connect a wallet to save alerts (your alerts are scoped per address).
          </div>
        )}

        <div className="px-4 py-4 space-y-4">
          {/* Kind switcher */}
          <div className="flex gap-1 overflow-x-auto scrollbar-hide">
            {templates.map((t) => {
              const TI = t.icon;
              const on = t.kind === kind;
              return (
                <button
                  key={t.kind}
                  onClick={() => {
                    /* swap kind by reopening — simpler than rewiring state */
                    onClose();
                    setTimeout(() => {
                      const ev = new CustomEvent("alerts:create", { detail: t.kind });
                      window.dispatchEvent(ev);
                    }, 0);
                  }}
                  className={`h-8 px-3 rounded-full text-[11px] font-semibold whitespace-nowrap inline-flex items-center gap-1 ${
                    on ? "lit-purple" : "bg-white/5 text-muted-foreground"
                  }`}
                >
                  <TI className="size-3" /> {t.label}
                </button>
              );
            })}
          </div>

          {/* Target */}
          {needsTarget && (
            <Field label={kind === "wallet" ? "@handle" : "Token address"}>
              <div className="flex items-center gap-2 h-10 px-3 rounded-xl bg-white/5 focus-within:ring-1 focus-within:ring-primary/40">
                <Search className="size-4 text-muted-foreground" />
                <input
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder={kind === "wallet" ? "@trader" : "0x…"}
                  className="flex-1 bg-transparent text-sm focus:outline-none font-mono"
                />
              </div>
            </Field>
          )}

          {/* Condition */}
          {(kind === "price" || kind === "progress" || kind === "volume" || kind === "holder") && (
            <Field label="Condition">
              <div className="grid grid-cols-[120px_1fr] gap-2">
                <select
                  value={comparator}
                  onChange={(e) => setComparator(e.target.value as Comparator)}
                  className="h-10 rounded-xl bg-white/5 px-3 text-sm focus:outline-none"
                >
                  <option value=">">crosses above</option>
                  <option value="<">drops below</option>
                  <option value=">=">≥</option>
                  <option value="<=">≤</option>
                  <option value="==">equals</option>
                </select>
                <input
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder={
                    kind === "price"    ? "USD price"
                  : kind === "progress" ? "0–100 %"
                  : kind === "volume"   ? "USD"
                  : kind === "holder"   ? "# holders"
                  : ""}
                  className="h-10 rounded-xl bg-white/5 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </div>
            </Field>
          )}

          {/* Note */}
          <Field label="Note (optional)">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. dev wallet — watch for offloads"
              className="h-10 w-full rounded-xl bg-white/5 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </Field>

          <p className="text-[11px] text-muted-foreground">Alerts are delivered in-app to your Alerts inbox.</p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ChannelPick({ on, setOn, label, icon: Icon }: { on: boolean; setOn: (v: boolean) => void; label: string; icon: any }) {
  return (
    <button
      onClick={() => setOn(!on)}
      className={`h-12 rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold ${
        on ? "bg-primary text-primary-foreground" : "bg-white/5 text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="size-3.5" />
      {label}
      {on && <Check className="size-3" />}
    </button>
  );
}

function shortAddr(a: string) { return `${a.slice(0, 5)}...${a.slice(-4)}`; }
function timeAgo(ts: number) {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
