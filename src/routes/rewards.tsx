import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Handle } from "@/components/Handle";
import { useMe } from "@/lib/useMe";
import {
  usePointsBalance, usePointsLedger, useReferralStats, useRedemptions,
  useEarnedTotal,
  requestRedemption, mintReferralCode,
  POINT_USD, MIN_REDEEM_POINTS, tierFor,
} from "@/lib/rewards";
// ArrowDownToLine is the ONLY icon allowed on this page — it lives on
// the single Claim button. Everything else renders text-only.
import { Copy, Check, ArrowDownToLine } from "lucide-react";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export const Route = createFileRoute("/rewards")({ component: Rewards });

function Rewards() {
  useDocumentTitle("Rewards");
  const me = useMe();
  const balance = usePointsBalance(me);
  const earnedTotal = useEarnedTotal(me).data ?? 0;
  const ref = useReferralStats(me);
  const redemptions = useRedemptions(me);
  const ledger = usePointsLedger(me, 30);

  const tier = useMemo(() => tierFor(earnedTotal), [earnedTotal]);
  const monEarned = useMemo(
    () => (redemptions.data ?? []).filter((r: any) => r.status === "paid")
      .reduce((a, r: any) => a + Number(r.mon_amount) / 1e18, 0),
    [redemptions.data],
  );

  return (
    <div className="space-y-6">
      <RewardsTab
        me={me}
        balance={balance}
        earnedTotal={earnedTotal}
        tier={tier}
        monEarned={monEarned}
        ref={ref.data}
        ledger={ledger.data ?? []}
        redemptions={redemptions.data ?? []}
      />
    </div>
  );
}

// ──────────────────────────── REWARDS TAB ────────────────────────────
// New layout (mobile-first, scales to PC):
//   1. Centered points balance with sparkle icon
//   2. 3 action tiles: Invite friends · Leaderboard · Claim
//   3. Big purple "share your invite" card with the referral code
//   4. 4-card "Rewards Breakdown" grid (Points · Earned · Referral · MON)
//   5. Recent activity feed below
// Black + purple only. No gold, no green.
function RewardsTab(p: {
  me: string | undefined;
  balance: number;
  earnedTotal: number;
  tier: ReturnType<typeof tierFor>;
  monEarned: number;
  ref: { code: string | null; referredCount: number; earnedPoints: number; earnedUsd: number } | undefined;
  ledger: any[];
  redemptions: any[];
}) {
  const { me, balance, tier, monEarned, ref, ledger } = p;
  const [code, setCode] = useState<string | null>(null);
  const refCode = code ?? ref?.code ?? null;
  const refLink = refCode
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/?ref=${refCode}`
    : "";
  const [claimOpen, setClaimOpen] = useState(false);

  if (!me) {
    return (
      <div className="rounded-2xl bg-surface border border-white/5 p-10 text-center">
        <p className="text-sm">Connect your wallet to view your rewards.</p>
      </div>
    );
  }

  // Whole-number + decimals split for the X.Y display in the hero
  const [whole, decimals] = (() => {
    const v = balance.toFixed(1);
    const [w, d] = v.split(".");
    return [Number(w).toLocaleString(), d ?? "0"];
  })();

  return (
    <>
      {/* ── Hero: balance ─────────────────────────────────────────────── */}
      <section className="relative pt-4 pb-6 sm:pt-8 sm:pb-10 text-center">
        {/* Soft purple glow behind the icon */}
        <div
          className="absolute pointer-events-none opacity-50"
          style={{
            width: 320, height: 320, top: -80, left: "50%",
            transform: "translateX(-50%)",
            background: "radial-gradient(circle, rgba(168,85,247,0.35), transparent 60%)",
            filter: "blur(40px)",
          }}
        />
        <p className="text-sm text-primary/90 font-semibold relative">Points balance</p>
        <p className="mt-3 text-6xl sm:text-7xl font-black tracking-tight tabular-nums relative">
          {whole}
          <span className="text-3xl sm:text-4xl text-muted-foreground/60">.{decimals}</span>
        </p>
        <p className="text-[11px] text-muted-foreground mt-2 relative">
          ≈ ${(balance * POINT_USD).toFixed(2)} · {tier.tier.label} tier ({tier.tier.multiplier}× rate)
        </p>
      </section>

      {/* ── Single Claim action — the only icon on the page ─────────── */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => setClaimOpen(true)}
          className="h-12 px-8 rounded-full lit-purple text-sm font-bold inline-flex items-center gap-2"
        >
          <ArrowDownToLine className="size-4" /> Claim
        </button>
      </div>

      {/* ── Share invite card ────────────────────────────────────────── */}
      <section
        id="invite-card"
        className="relative rounded-2xl overflow-hidden mt-4"
        style={{
          background: "linear-gradient(135deg, #1a0826 0%, #2d0e44 50%, #5b1f9a 100%)",
        }}
      >
        <div className="relative px-5 sm:px-7 py-5 sm:py-6 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-primary/90 font-bold">
              Share your invite
            </p>
            <p className="text-2xl sm:text-3xl font-black tracking-wider mt-1 truncate">
              {refCode ?? "—"}
            </p>
            {refCode ? (
              <div className="mt-3 inline-flex items-center gap-2">
                <CopyButton text={refLink} label="Copy link" />
                <span className="text-[11px] text-white/60">
                  {ref?.referredCount ?? 0} friends joined
                </span>
              </div>
            ) : (
              <button
                onClick={async () => { if (me) setCode(await mintReferralCode(me)); }}
                className="mt-3 h-9 px-4 rounded-full bg-white text-background text-xs font-bold"
              >
                Mint my code
              </button>
            )}
          </div>
          <SinceSeal />
        </div>
      </section>

      {/* ── Rewards breakdown — only Earn + Referral, no icons ──────── */}
      <div>
        <h2 className="text-base font-bold mb-3 mt-2">Rewards Breakdown</h2>
        <div className="grid grid-cols-2 gap-3">
          <BreakdownTile
            label="Earn"
            value={p.earnedTotal.toLocaleString()}
          />
          <BreakdownTile
            label="Referral"
            value={(ref?.referredCount ?? 0).toLocaleString()}
            sub={`${(ref?.earnedPoints ?? 0).toLocaleString()} pts earned`}
          />
        </div>
      </div>

      {/* ── My referrals — live list, realtime via Supabase ─────────── */}
      <ReferralsLive me={me} />

      {/* Activity — no icons, no green pills */}
      {ledger.length > 0 && (
        <section className="rounded-2xl bg-surface border border-white/5">
          <div className="px-4 py-3 border-b border-white/5">
            <h3 className="font-semibold text-sm">Recent activity</h3>
          </div>
          <ul className="divide-y divide-white/5">
            {ledger.map((r: any) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md ${
                  r.reason === "cashback" || r.reason === "referral" ? "bg-primary/15 text-primary"
                  : "bg-white/5 text-muted-foreground"
                }`}>
                  {r.reason}
                </span>
                <span className="flex-1 text-xs text-muted-foreground truncate">
                  {r.reason === "referral" && r.source_user
                    ? <>from <Handle address={r.source_user} /></>
                    : r.reason === "redemption" ? "withdrew to MON"
                    : `$${Number(r.amount_usd ?? 0).toFixed(4)} fee`}
                </span>
                <span className={`text-sm font-bold ${r.points >= 0 ? "text-foreground" : "text-down"}`}>
                  {r.points >= 0 ? "+" : ""}{Number(r.points).toLocaleString()} pts
                </span>
                <span className="text-[11px] text-muted-foreground w-24 text-right">
                  {new Date(r.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Claim modal — opens from the action tile */}
      {claimOpen && (
        <ClaimModal me={me} balance={balance} onClose={() => setClaimOpen(false)} />
      )}
    </>
  );
}

// ─────────── New visual components ────────────────────────────────────

// Icon-less breakdown tile — just label + big number + optional sub-line.
// No top-right arrow chip, no leading icon — per the spec, the only icon
// allowed on this page is the Claim button.
function BreakdownTile({
  label, value, sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/8 p-4 bg-white/[0.02] h-full">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
        {label}
      </p>
      <p className="text-2xl sm:text-3xl font-black mt-1 tabular-nums">{value}</p>
      {sub && (
        <p className="text-[11px] text-muted-foreground mt-1 truncate">{sub}</p>
      )}
    </div>
  );
}

// Live referrals list — subscribes to `referrals` inserts for this wallet
// so a new row appears the moment a friend bonds, no page refresh.
function ReferralsLive({ me }: { me: string }) {
  type Row = { addr: string; bonded_at: string; pts: number };
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancel = false;

    const load = async () => {
      const { supabase } = await import("@/lib/supabase");
      const sb = supabase();
      const lc = me.toLowerCase();
      const { data: refs } = await sb.from("referrals")
        .select("referee_address, bonded_at")
        .eq("referrer_address", lc)
        .order("bonded_at", { ascending: false })
        .limit(50);
      const addrs = (refs ?? []).map((r: any) => r.referee_address);
      const { data: earn } = addrs.length
        ? await sb.from("points_ledger")
            .select("source_user, points")
            .eq("owner_address", lc)
            .eq("reason", "referral")
            .in("source_user", addrs)
        : { data: [] as any[] };
      const ptsBy = new Map<string, number>();
      for (const e of (earn ?? []) as any[]) {
        ptsBy.set(e.source_user, (ptsBy.get(e.source_user) ?? 0) + Number(e.points));
      }
      if (cancel) return;
      setRows((refs ?? []).map((r: any) => ({
        addr: r.referee_address,
        bonded_at: r.bonded_at,
        pts: ptsBy.get(r.referee_address) ?? 0,
      })));
    };

    load();

    // Realtime — fire a reload on every new bonded referral for this wallet.
    let channel: any;
    (async () => {
      const { supabase } = await import("@/lib/supabase");
      const sb = supabase();
      channel = sb
        .channel(`referrals:${me}:${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "referrals",
            filter: `referrer_address=eq.${me.toLowerCase()}`,
          },
          () => { if (!cancel) load(); },
        )
        .subscribe();
    })();

    return () => {
      cancel = true;
      if (channel) {
        import("@/lib/supabase").then(({ supabase }) => {
          try { supabase().removeChannel(channel); } catch {}
        });
      }
    };
  }, [me]);

  return (
    <section className="rounded-2xl bg-surface border border-white/5">
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
        <h3 className="font-semibold text-sm">My referrals</h3>
        <span className="text-[11px] text-muted-foreground">
          {rows === null ? "…" : `${rows.length} live`}
        </span>
      </div>
      {rows === null ? (
        <p className="px-4 py-8 text-xs text-muted-foreground text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-8 text-xs text-muted-foreground text-center">
          No referrals yet. Share your code above to start earning.
        </p>
      ) : (
        <ul className="divide-y divide-white/5">
          {rows.map((r) => (
            <li key={r.addr} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Handle address={r.addr} />
              <span className="flex-1 text-[11px] text-muted-foreground">
                joined {new Date(r.bonded_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
              <span className="text-sm font-bold tabular-nums">
                +{r.pts.toLocaleString()} pts
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// "Since [year]" decorative seal — replaces the gold disc from the X-style
// referral cards. Pure SVG with text-on-path, so it scales crisply.
function SinceSeal() {
  const year = new Date().getFullYear();
  return (
    <div className="relative size-24 sm:size-28 shrink-0 hidden xs:block">
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
        <defs>
          <path id="seal-arc" d="M 50,50 m -40,0 a 40,40 0 1,1 80,0 a 40,40 0 1,1 -80,0" />
        </defs>
        <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
        <circle cx="50" cy="50" r="32" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        <text fill="rgba(255,255,255,0.55)" fontSize="9" fontWeight="700" letterSpacing="2">
          <textPath href="#seal-arc" startOffset="2%">
            · SINCE {year} · trench.meme · TUYO ·
          </textPath>
        </text>
      </svg>
    </div>
  );
}

// ─────────── Sub-components ──────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="h-8 px-3 rounded-full bg-white text-background text-xs font-bold inline-flex items-center gap-1.5"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

// ─────────── Claim modal — invoked from the action tile ───────────────
// Lives behind the "Claim" tile instead of being a permanent card. Mirrors
// the bottom-sheet styling we use elsewhere. Same redemption flow as before
// — minimum points, MON quote, write to redemption queue — just without the
// green/gold accents and the "coming soon" label the user called out.
function ClaimModal({
  me, balance, onClose,
}: {
  me: string;
  balance: number;
  onClose: () => void;
}) {
  const [redeemAmt, setRedeemAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const pts = Math.floor(Number(redeemAmt) || 0);
  const usd = pts * POINT_USD;

  const redeem = async () => {
    if (pts < MIN_REDEEM_POINTS) { setErr(`Min ${MIN_REDEEM_POINTS} points`); return; }
    if (pts > balance) { setErr("Not enough points"); return; }
    setBusy(true); setErr(null);
    try {
      await requestRedemption({ data: { owner: me, points: pts } });
      setDone(true);
      setRedeemAmt("");
    } catch (e: any) { setErr(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-3">
      <button
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={onClose}
        aria-label="Close"
      />
      <div
        className="relative w-full max-w-sm rounded-3xl bg-background border border-white/10 overflow-hidden"
        style={{ boxShadow: "0 30px 80px rgba(0,0,0,0.8)" }}
      >
        <div className="px-5 pt-5 pb-2 flex items-center justify-between">
          <h2 className="font-bold text-base">Claim points</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm">
            Close
          </button>
        </div>
        <div className="px-5 pb-5">
          <div className="text-center my-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
              Available
            </p>
            <p className="text-3xl font-black mt-1 tabular-nums">
              {balance.toLocaleString()}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              ≈ ${(balance * POINT_USD).toFixed(2)} · paid out as MON
            </p>
          </div>

          <div className="flex gap-1.5 mb-2">
            <input
              value={redeemAmt}
              onChange={(e) => setRedeemAmt(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder={`min ${MIN_REDEEM_POINTS} pts`}
              className="flex-1 h-11 rounded-xl bg-white/[0.04] border border-white/10 px-3 text-sm focus:outline-none focus:border-primary/40"
            />
            <button
              onClick={() => setRedeemAmt(String(balance))}
              className="h-11 px-4 rounded-xl bg-white/5 text-xs font-bold"
            >
              Max
            </button>
          </div>
          <button
            onClick={redeem}
            disabled={busy || pts < MIN_REDEEM_POINTS || pts > balance}
            className={`w-full h-12 rounded-xl text-sm font-bold inline-flex items-center justify-center gap-1.5 transition-colors ${
              pts >= MIN_REDEEM_POINTS && pts <= balance && !busy
                ? "lit-purple"
                : "bg-white/5 text-muted-foreground cursor-not-allowed"
            }`}
          >
            <ArrowDownToLine className="size-4" />
            {busy ? "Claiming…"
              : balance === 0 ? "Nothing to claim"
              : pts === 0 ? "Enter an amount"
              : `Claim $${usd.toFixed(2)}`}
          </button>
          {err && <p className="text-[11px] text-down mt-2 text-center">{err}</p>}
          {done && <p className="text-[11px] text-primary mt-2 text-center">Queued — MON arrives shortly.</p>}

          <p className="text-[10px] text-muted-foreground text-center mt-3 leading-relaxed">
            Redemptions are settled by the bot worker once your tx is signed and broadcast.
          </p>
        </div>
      </div>
    </div>
  );
}

// We no longer surface TierBadge / MonRewardsCard / QuestsCard / Pill /
// ReferralsTable / LeaderboardTab / BenefitsTab — the new layout folds all
// of that data into the breakdown grid + the action tiles. The tier label
// and multiplier still appear in the hero subtitle.
