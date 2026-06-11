import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Copy, Crown, Pause, Play, Plus, Search, Trash2, TrendingUp, Users } from "lucide-react";
import { Sparkline } from "@/components/Charts";
import { MobileTabs, PageTitle } from "@/components/SimpleLayout";
import { fmtPct, fmtUsd } from "@/lib/fmt";
import { labelFor, profileRoute, useIdentities } from "@/lib/identity";
import { supabase } from "@/lib/supabase";
import { SUPABASE_ENABLED, useSuggestedTraders } from "@/lib/supabase-hooks";
import { useMe } from "@/lib/useMe";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export const Route = createFileRoute("/copy-trading")({ component: CopyTrading });

const filters = ["Top", "New", "Win Rate", "Volume"];
const AVATAR_GRADIENT = "linear-gradient(135deg, #050008 0%, #2e075f 48%, #7c3aed 100%)";
const PANEL = "border border-primary/15 bg-black/65 shadow-[0_24px_80px_rgba(0,0,0,0.5)]";
const SOFT = "border border-primary/10 bg-black/45";

type TraderPick = {
  address: string;
  tag: string;
  short: string;
  pnl: number;
  roi: number;
  winrate: number;
};

type Running = {
  id: string;
  walletAddr: string;
  walletTag: string;
  buyPct: string;
  maxPerTrade: string;
  status: "active" | "paused";
  mirrorBuys: boolean;
  mirrorSells: boolean;
  copied: number;
  pnl: number;
};

function CopyTrading() {
  useDocumentTitle("Copy Trading");
  const me = useMe();
  const useSupabase = SUPABASE_ENABLED && !!me;

  const [filter, setFilter] = useState(filters[0]);
  const [query, setQuery] = useState("");
  const [buyPct, setBuyPct] = useState("100");
  const [maxPer, setMaxPer] = useState("1.0");
  const [mirrorBuys, setMirrorBuys] = useState(true);
  const [mirrorSells, setMirrorSells] = useState(true);
  const [selectedWallet, setSelectedWallet] = useState<TraderPick | null>(null);
  const [running, setRunning] = useState<Running[]>([]);
  const [mTab, setMTab] = useState<"discover" | "configure" | "running">("discover");

  const traders = useSuggestedTraders(20);
  const wallets = useMemo<TraderPick[]>(() => {
    return traders
      .filter((t) => !!t.handle)
      .map((t) => ({
        address: t.address,
        tag: t.display_name || `@${t.handle}`,
        short: `@${t.handle}`,
        pnl: Number(t.realized_usd ?? 0),
        roi: t.score,
        winrate: 55,
      }));
  }, [traders]);

  const runningIds = useIdentities(running.map((r) => r.walletAddr));

  const refresh = async () => {
    if (!useSupabase) return;
    const { data } = await supabase()
      .from("copy_configs")
      .select("*")
      .eq("owner_address", me!)
      .order("created_at", { ascending: false });
    setRunning((data ?? []).map((r: any) => ({
      id: r.id,
      walletAddr: r.target_address,
      walletTag: r.target_address,
      buyPct: String(r.buy_pct),
      maxPerTrade: String(r.max_per_trade),
      status: r.status,
      mirrorBuys: r.mirror_buys,
      mirrorSells: r.mirror_sells,
      copied: r.copied_count ?? 0,
      pnl: Number(r.pnl_usd ?? 0),
    })));
  };

  useEffect(() => { refresh(); }, [me]);

  const startCopying = async () => {
    const w = selectedWallet;
    if (!w) return;
    if (useSupabase) {
      await supabase().from("copy_configs").insert({
        owner_address: me!,
        target_address: w.address.toLowerCase(),
        buy_pct: Number(buyPct),
        max_per_trade: Number(maxPer),
        mirror_buys: mirrorBuys,
        mirror_sells: mirrorSells,
        status: "active",
      });
      setSelectedWallet(null);
      refresh();
      return;
    }
    setRunning((r) => [
      {
        id: `${Date.now()}`,
        walletAddr: w.address,
        walletTag: w.tag,
        buyPct,
        maxPerTrade: maxPer,
        status: "active",
        mirrorBuys,
        mirrorSells,
        copied: 0,
        pnl: 0,
      },
      ...r,
    ]);
    setSelectedWallet(null);
  };

  const toggle = async (id: string) => {
    if (useSupabase) {
      const cur = running.find((x) => x.id === id);
      if (!cur) return;
      const next = cur.status === "active" ? "paused" : "active";
      await supabase().from("copy_configs").update({ status: next }).eq("id", id);
      refresh();
      return;
    }
    setRunning((r) => r.map((x) => (x.id === id ? { ...x, status: x.status === "active" ? "paused" : "active" } : x)));
  };

  const remove = async (id: string) => {
    if (useSupabase) {
      await supabase().from("copy_configs").delete().eq("id", id);
      refresh();
      return;
    }
    setRunning((r) => r.filter((x) => x.id !== id));
  };

  const filtered = useMemo(() => {
    let list = [...wallets];
    if (filter === "Win Rate") list.sort((a, b) => b.winrate - a.winrate);
    else if (filter === "Volume") list.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
    else list.sort((a, b) => b.roi - a.roi);
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (w) => w.tag.toLowerCase().includes(q) || w.short.toLowerCase().includes(q) || w.address.toLowerCase().includes(q),
    );
  }, [wallets, filter, query]);

  const totalPnl = running.reduce((a, r) => a + r.pnl, 0);

  return (
    <div className="space-y-4 sectioned">
      <section className={`rounded-3xl ${PANEL} px-4 py-5 sm:px-5`}>
        <PageTitle title="Copy Trade" subtitle="Mirror high-conviction wallets with capped execution." />
        <div className="mt-4 grid grid-cols-3 gap-2 text-[10px] uppercase tracking-[0.18em] text-primary/80">
          <div className={`rounded-2xl ${SOFT} px-3 py-2`}>Realtime</div>
          <div className={`rounded-2xl ${SOFT} px-3 py-2`}>Capped</div>
          <div className={`rounded-2xl ${SOFT} px-3 py-2`}>Para signed</div>
        </div>
      </section>

      <MobileTabs
        value={mTab}
        onChange={setMTab}
        tabs={[
          { key: "discover", label: "Discover" },
          { key: "configure", label: "Configure" },
          { key: "running", label: "Running" },
        ]}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Active copies" value={`${running.filter((r) => r.status === "active").length}`} icon={Copy} />
        <Stat label="Total mirrored" value={`${running.reduce((a, r) => a + r.copied, 0)}`} icon={Users} />
        <Stat label="PnL (24h)" value={`${totalPnl >= 0 ? "+" : "-"}$${Math.abs(totalPnl).toFixed(2)}`} icon={TrendingUp} />
        <Stat label="Top trader" value={wallets[0]?.tag ?? "-"} icon={Crown} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
        <div className="space-y-4">
          <section className={`rounded-3xl overflow-hidden ${PANEL} ${mTab === "discover" ? "" : "hidden"} md:block`}>
            <div className="p-3 sm:p-4 flex items-center gap-2 flex-wrap border-b border-primary/10">
              <div className={`flex-1 min-w-[180px] flex items-center gap-2 ${SOFT} rounded-2xl h-10 px-3`}>
                <Search className="size-4 text-primary/70" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search trader or address"
                  className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/60"
                />
              </div>
              <div className="flex items-center gap-1.5">
                {filters.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`h-9 px-3 rounded-xl text-xs font-semibold transition-colors ${
                      filter === f
                        ? "bg-primary text-white shadow-[0_0_28px_rgba(124,58,237,0.35)]"
                        : `${SOFT} text-muted-foreground hover:text-foreground hover:border-primary/30`
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground px-4">
                No traders yet. Run the PnL and smart-money workers to populate this list.
              </div>
            ) : (
              <ul>
                {filtered.slice(0, 12).map((w, i) => {
                  const isSelected = selectedWallet?.address === w.address;
                  return (
                    <li
                      key={w.address}
                      className={`flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-primary/[0.07] last:border-b-0 transition-colors ${
                        isSelected ? "bg-primary/[0.12]" : "hover:bg-primary/[0.06]"
                      }`}
                    >
                      <div className="relative shrink-0">
                        <div
                          className="size-12 rounded-2xl grid place-items-center text-base font-bold border border-primary/25 text-white"
                          style={{ background: AVATAR_GRADIENT }}
                        >
                          {w.tag.replace("@", "")[0]?.toUpperCase() ?? "?"}
                        </div>
                        {i < 3 && (
                          <span
                            className="absolute -top-1 -right-1 size-5 rounded-full grid place-items-center text-[10px] font-bold bg-primary text-white"
                            title={`Rank ${i + 1}`}
                          >
                            {i + 1}
                          </span>
                        )}
                      </div>
                      <Link {...profileRoute(w.short.replace(/^@/, ""))} className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold truncate">{w.tag}</span>
                          <span className="text-[10px] text-muted-foreground truncate">{w.short}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] mt-0.5">
                          <span className="text-muted-foreground">PNL <span className="text-primary">{fmtUsd(Math.abs(w.pnl))}</span></span>
                          <span className="text-muted-foreground">ROI <span className="text-primary">{fmtPct(w.roi / 3)}</span></span>
                          <span className="text-muted-foreground">Win <span className="text-foreground">{w.winrate.toFixed(0)}%</span></span>
                        </div>
                      </Link>
                      <Sparkline
                        data={Array.from({ length: 18 }, (_, k) => Math.sin((k + i) / 2.2) * 5 + k * 0.28 + 18)}
                        color="var(--primary)"
                        height={28}
                        width={70}
                      />
                      <button
                        onClick={() => {
                          setSelectedWallet(w);
                          setMTab("configure");
                        }}
                        className={`h-9 px-4 rounded-xl text-xs font-semibold shrink-0 ${
                          isSelected
                            ? `${SOFT} text-foreground`
                            : "bg-primary text-white shadow-[0_0_26px_rgba(124,58,237,0.28)]"
                        }`}
                      >
                        {isSelected ? "Selected" : "Copy"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className={`rounded-3xl overflow-hidden ${PANEL} ${mTab === "running" ? "" : "hidden"} md:block`}>
            <div className="px-4 py-3 flex items-center justify-between border-b border-primary/10">
              <h3 className="font-semibold text-sm inline-flex items-center gap-2">
                <Copy className="size-4 text-primary" /> Running Copies
              </h3>
              <span className="text-xs text-muted-foreground">{running.length} configured</span>
            </div>
            {running.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">No active copies. Pick a trader above.</div>
            ) : (
              <ul>
                {running.map((r, i) => {
                  const tag = labelFor(runningIds[r.walletAddr.toLowerCase()]);
                  return (
                    <li key={r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-primary/[0.06] border-b border-primary/[0.07] last:border-b-0">
                      <span className={`size-2 rounded-full shrink-0 ${r.status === "active" ? "bg-primary animate-pulse" : "bg-muted-foreground/40"}`} />
                      <div
                        className="size-9 rounded-xl grid place-items-center text-xs font-bold shrink-0 border border-primary/25"
                        style={{ background: AVATAR_GRADIENT }}
                      >
                        {tag.replace("@", "")[0]?.toUpperCase() ?? "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{tag}</div>
                        <p className="text-[11px] text-muted-foreground">
                          {r.buyPct}% / max {r.maxPerTrade} MON / {r.mirrorBuys && r.mirrorSells ? "buys+sells" : r.mirrorBuys ? "buys" : "sells"} / copied {r.copied}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-primary shrink-0">
                        {r.pnl >= 0 ? "+" : "-"}${Math.abs(r.pnl).toFixed(2)}
                      </p>
                      <button
                        onClick={() => toggle(r.id)}
                        className={`h-8 w-8 grid place-items-center rounded-xl ${SOFT} hover:border-primary/35 shrink-0`}
                        aria-label={r.status === "active" ? "Pause" : "Resume"}
                      >
                        {r.status === "active" ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                      </button>
                      <button
                        onClick={() => remove(r.id)}
                        className={`h-8 w-8 grid place-items-center rounded-xl ${SOFT} hover:text-primary shrink-0`}
                        aria-label="Delete copy config"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className={`rounded-3xl ${PANEL} p-4 space-y-4 h-fit xl:sticky xl:top-4 ${mTab === "configure" ? "" : "hidden"} md:block`}>
          <div>
            <h3 className="font-semibold text-sm">Configure Copy</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Select a wallet, cap exposure, and choose which side to mirror.
            </p>
          </div>

          {selectedWallet ? (
            <div className={`rounded-2xl ${SOFT} p-3 flex items-center gap-3`}>
              <div
                className="size-10 rounded-xl grid place-items-center text-sm font-bold shrink-0 border border-primary/25"
                style={{ background: AVATAR_GRADIENT }}
              >
                {selectedWallet.tag.replace("@", "")[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{selectedWallet.tag}</p>
                <p className="text-[11px] text-muted-foreground font-mono truncate">{selectedWallet.address}</p>
              </div>
              <button
                onClick={() => setSelectedWallet(null)}
                className="size-7 grid place-items-center rounded-xl hover:bg-primary/10 text-muted-foreground"
                aria-label="Clear selected wallet"
              >
                x
              </button>
            </div>
          ) : (
            <div className={`rounded-2xl ${SOFT} p-4 text-xs text-muted-foreground text-center`}>
              Pick a trader from Discover to arm this panel.
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Field label="Buy %" value={buyPct} setValue={setBuyPct} />
            <Field label="Max / trade (MON)" value={maxPer} setValue={setMaxPer} />
          </div>

          <div className="space-y-2">
            <Toggle label="Mirror buys" value={mirrorBuys} onChange={setMirrorBuys} />
            <Toggle label="Mirror sells" value={mirrorSells} onChange={setMirrorSells} />
          </div>

          <button
            onClick={startCopying}
            disabled={!selectedWallet}
            className="h-11 w-full rounded-2xl bg-primary text-white font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-40 shadow-[0_0_26px_rgba(124,58,237,0.28)]"
          >
            <Plus className="size-4" /> Start Copying
          </button>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className={`rounded-2xl ${PANEL} p-3 flex items-center gap-3`}>
      <div className={`size-10 rounded-xl ${SOFT} grid place-items-center text-primary`}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase text-muted-foreground tracking-[0.14em] truncate">{label}</p>
        <p className="text-base font-bold text-primary truncate">{value}</p>
      </div>
    </div>
  );
}

function Field({ label, value, setValue }: { label: string; value: string; setValue: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={`h-10 w-full rounded-xl ${SOFT} px-3 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-primary/40`}
      />
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`w-full flex items-center justify-between rounded-xl ${SOFT} px-3 py-2.5 text-sm hover:border-primary/30`}
    >
      <span>{label}</span>
      <span className={`relative h-5 w-9 rounded-full transition-colors ${value ? "bg-primary" : "bg-white/10"}`}>
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${value ? "left-4" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}
