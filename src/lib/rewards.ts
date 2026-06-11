// Rewards: 5% cashback on every trade + 10% kickback to your referrer.
// Points denomination: 1 point = $0.01 USD value.

import { createServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase, supabaseAdmin } from "@/lib/supabase";
import { SUPABASE_ENABLED } from "@/lib/supabase-hooks";

// 1 point = $0.10
export const POINT_USD = 0.10;
export const CASHBACK_PCT = 5;        // base, tier multiplier applied at credit time
export const REFERRAL_PCT = 10;       // base, tier multiplier applied at credit time
export const MIN_REDEEM_POINTS = 10;  // = $1 minimum

// ──────────── Tier system ──────────────────────────────────────────
// Tier is computed from cumulative POINTS EARNED (excludes redemptions).
// Higher tier = bigger multiplier on both cashback and referral rates.
export type TierKey = "bronze" | "silver" | "gold" | "platinum";

// Multipliers are capped so the top-tier referral rate = 20% (REFERRAL_PCT × 2).
// Cashback at the top tier = 10%. MUST mirror tier_multiplier() in supabase/schema.sql.
export const TIERS: Record<TierKey, {
  label: string; minPoints: number; multiplier: number; color: string; emoji: string;
}> = {
  // All-purple tier palette — no gold, no bronze metallic, no glyphs.
  // The label names stay so existing badge logic still reads, but
  // visually they're shades of trench purple from cool-grey through to
  // deep violet. emoji field kept on the type for compatibility, value
  // is empty — no medal, no diamond, just the label text where needed.
  bronze:   { label: "Bronze",   minPoints: 0,       multiplier: 1.0, color: "#6b7280", emoji: "" },
  silver:   { label: "Silver",   minPoints: 5_000,   multiplier: 1.4, color: "#a78bfa", emoji: "" },
  gold:     { label: "Gold",     minPoints: 25_000,  multiplier: 1.7, color: "#a855f7", emoji: "" },
  platinum: { label: "Platinum", minPoints: 100_000, multiplier: 2.0, color: "#7e22ce", emoji: "" },
};

export function tierFor(pointsEarned: number): { key: TierKey; tier: typeof TIERS[TierKey]; next: { key: TierKey; tier: typeof TIERS[TierKey] } | null; pointsToNext: number; progressPct: number } {
  const keys: TierKey[] = ["bronze", "silver", "gold", "platinum"];
  let currentKey: TierKey = "bronze";
  for (const k of keys) {
    if (pointsEarned >= TIERS[k].minPoints) currentKey = k;
  }
  const idx = keys.indexOf(currentKey);
  const nextKey = idx < keys.length - 1 ? keys[idx + 1] : null;
  const currMin = TIERS[currentKey].minPoints;
  const nextMin = nextKey ? TIERS[nextKey].minPoints : currMin;
  const pointsToNext = nextKey ? nextMin - pointsEarned : 0;
  const progressPct = nextKey ? ((pointsEarned - currMin) / (nextMin - currMin)) * 100 : 100;
  return {
    key: currentKey,
    tier: TIERS[currentKey],
    next: nextKey ? { key: nextKey, tier: TIERS[nextKey] } : null,
    pointsToNext: Math.max(0, pointsToNext),
    progressPct: Math.max(0, Math.min(100, progressPct)),
  };
}

function admin() {
  return supabaseAdmin();
}

// Server fn — called from the browser AFTER a successful market swap.
// Workers (executor.ts) call the same Postgres RPC directly.
export const recordTradeFee = createServerFn({ method: "POST" })
  .inputValidator((d: {
    trader: string;
    feeUsd: number;
    txHash?: string;
    source?: "market" | "limit" | "copy";
  }) => d)
  .handler(async ({ data }) => {
    await admin().rpc("record_trade_fee", {
      p_trader: data.trader.toLowerCase(),
      p_fee_usd: data.feeUsd,
      p_source_tx: data.txHash ?? null,
      p_source: data.source ?? "market",
    });
    return { ok: true };
  });

// Server fn — user requests a redemption. Inserts a `pending` row; the
// redemption worker drains it and sends MON from the fee wallet.
export const requestRedemption = createServerFn({ method: "POST" })
  .inputValidator((d: { owner: string; points: number }) => d)
  .handler(async ({ data }) => {
    if (data.points < MIN_REDEEM_POINTS) {
      throw new Error(`Minimum redemption is ${MIN_REDEEM_POINTS} points`);
    }
    const sb = admin();
    // Snapshot MON price right now so the worker can't be unfair later.
    const monPriceUsd = await fetchMonPriceUsd();
    if (!monPriceUsd) throw new Error("MON price unavailable");
    const usdValue = data.points * POINT_USD;
    const monAmount = BigInt(Math.floor((usdValue / monPriceUsd) * 1e18));

    // Check balance + spend in one go (debit ledger row)
    const { data: acct } = await sb.from("accounts")
      .select("points_balance").eq("address", data.owner.toLowerCase()).maybeSingle();
    if (!acct || (acct as any).points_balance < data.points) {
      throw new Error("Not enough points");
    }
    // Debit (negative points entry)
    await sb.from("points_ledger").insert({
      owner_address: data.owner.toLowerCase(),
      points: -data.points,
      reason: "redemption",
      amount_usd: usdValue,
    });
    // Create the redemption job
    const { data: red, error } = await sb.from("redemptions").insert({
      owner_address: data.owner.toLowerCase(),
      points_spent: data.points,
      mon_amount: monAmount.toString(),
      mon_price_usd: monPriceUsd,
      status: "pending",
    }).select().single();
    if (error) throw error;
    return red;
  });

async function fetchMonPriceUsd(): Promise<number | null> {
  try {
    // Hit GeckoTerminal native price endpoint — free + cached on their side
    const r = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/${process.env.GECKOTERMINAL_NETWORK ?? "monad"}/tokens/${process.env.WMON_ADDRESS ?? "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A"}`,
      { headers: { accept: "application/json;version=20230302" } },
    );
    if (!r.ok) return null;
    const j: any = await r.json();
    const p = Number(j?.data?.attributes?.price_usd);
    return isFinite(p) && p > 0 ? p : null;
  } catch { return null; }
}

// ─────────────────── Hooks ─────────────────────────────────────────

export function usePointsBalance(me: string | undefined) {
  const [balance, setBalance] = useState<number>(0);
  useEffect(() => {
    if (!SUPABASE_ENABLED || !me) return;
    const sb = supabase();
    let cancel = false;
    const refresh = async () => {
      const { data } = await sb.from("accounts")
        .select("points_balance").eq("address", me.toLowerCase()).maybeSingle();
      if (!cancel) setBalance(Number((data as any)?.points_balance ?? 0));
    };
    refresh();
    const ch = sb.channel(`points:${me}:${Date.now()}:${Math.random().toString(36).slice(2,8)}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "points_ledger", filter: `owner_address=eq.${me.toLowerCase()}` },
        () => refresh())
      .subscribe();
    return () => { cancel = true; sb.removeChannel(ch); };
  }, [me]);
  return balance;
}

export function usePointsLedger(me: string | undefined, limit = 50) {
  return useQuery({
    queryKey: ["points-ledger", me, limit],
    queryFn: async () => {
      const { data } = await supabase().from("points_ledger")
        .select("id, points, reason, source_user, source_tx_hash, amount_usd, created_at")
        .eq("owner_address", me!.toLowerCase())
        .order("created_at", { ascending: false })
        .limit(limit);
      return data ?? [];
    },
    enabled: !!me && SUPABASE_ENABLED,
    refetchInterval: 15_000,
  });
}

// Server fn: bypasses RLS via admin client. The `referrals` table is
// gated by `self read ref` policy which checks auth_addr() — we don't
// issue Supabase JWTs (Para is the auth source), so the anon-client
// query was silently returning 0 rows. Route through the admin client
// and trust the `me` arg the same way other server fns in this file do.
export const fetchReferralStats = createServerFn({ method: "GET" })
  .inputValidator((d: { me: string }) => d)
  .handler(async ({ data }) => {
    const sb = admin();
    const lc = data.me.toLowerCase();
    const [{ data: code }, { count: referredCount }, { data: earnings }] = await Promise.all([
      sb.from("referral_codes").select("code").eq("owner_address", lc).maybeSingle(),
      sb.from("referrals").select("*", { count: "exact", head: true }).eq("referrer_address", lc),
      sb.from("points_ledger").select("points, amount_usd")
        .eq("owner_address", lc).eq("reason", "referral"),
    ]);
    const earnedPoints = (earnings ?? []).reduce((a, r: any) => a + Number(r.points), 0);
    const earnedUsd = (earnings ?? []).reduce((a, r: any) => a + Number(r.amount_usd ?? 0) * 0.10, 0);
    return {
      code: (code as { code: string } | null)?.code ?? null,
      referredCount: referredCount ?? 0,
      earnedPoints,
      earnedUsd,
    };
  });

export function useReferralStats(me: string | undefined) {
  return useQuery({
    queryKey: ["referral-stats", me],
    queryFn: () => fetchReferralStats({ data: { me: me! } }),
    enabled: !!me && SUPABASE_ENABLED,
    refetchInterval: 30_000,
  });
}

// Total positive points ever earned (excludes redemptions). Used to compute tier.
export function useEarnedTotal(me: string | undefined) {
  return useQuery({
    queryKey: ["points-earned-total", me],
    queryFn: async () => {
      const { data } = await supabase().from("points_ledger")
        .select("points")
        .eq("owner_address", me!.toLowerCase())
        .gt("points", 0)
        .in("reason", ["cashback", "referral", "bonus"]);
      return ((data ?? []) as any[]).reduce((a, r) => a + Number(r.points), 0);
    },
    enabled: !!me && SUPABASE_ENABLED,
    refetchInterval: 30_000,
  });
}

// Daily MON redeemed series (for the chart). Default 30 days.
export function useDailyRedeemedMon(me: string | undefined, days = 30) {
  return useQuery({
    queryKey: ["mon-redeemed-daily", me, days],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data } = await supabase().from("redemptions")
        .select("mon_amount, status, paid_at, created_at")
        .eq("owner_address", me!.toLowerCase())
        .gte("created_at", since)
        .order("created_at", { ascending: true });
      // Bucket per day
      const buckets = new Map<string, number>();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86_400_000);
        const k = d.toISOString().slice(0, 10);
        buckets.set(k, 0);
      }
      for (const r of (data ?? []) as any[]) {
        if (r.status !== "paid") continue;
        const k = (r.paid_at ?? r.created_at).slice(0, 10);
        if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + Number(r.mon_amount) / 1e18);
      }
      return [...buckets.entries()].map(([day, mon]) => ({ day, mon }));
    },
    enabled: !!me && SUPABASE_ENABLED,
    refetchInterval: 60_000,
  });
}

// User's lifetime trade volume in USD (for next-tier progress hints).
export function useLifetimeVolumeUsd(me: string | undefined) {
  return useQuery({
    queryKey: ["lifetime-vol", me],
    queryFn: async () => {
      const { data } = await supabase().from("trades")
        .select("value_usd")
        .eq("account_address", me!.toLowerCase());
      return ((data ?? []) as any[]).reduce((a, r) => a + Number(r.value_usd ?? 0), 0);
    },
    enabled: !!me && SUPABASE_ENABLED,
    refetchInterval: 60_000,
  });
}

export function useRedemptions(me: string | undefined) {
  return useQuery({
    queryKey: ["redemptions", me],
    queryFn: async () => {
      const { data } = await supabase().from("redemptions")
        .select("*")
        .eq("owner_address", me!.toLowerCase())
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
    enabled: !!me && SUPABASE_ENABLED,
    refetchInterval: 10_000,
  });
}

/** Get the wallet's own referral code (auto-minted by the DB trigger
 *  when the account row was inserted). No re-mint needed — every account
 *  already has one. Returns null only if Supabase is off or the row
 *  isn't there yet (race with the insert).
 */
export async function mintReferralCode(me: string) {
  if (!SUPABASE_ENABLED) return null;
  const { data } = await supabase()
    .from("referral_codes")
    .select("code")
    .eq("owner_address", me.toLowerCase())
    .maybeSingle();
  return (data as { code?: string } | null)?.code ?? null;
}

export const updateMyReferralCode = createServerFn({ method: "POST" })
  .inputValidator((d: { owner: string; code: string }) => d)
  .handler(async ({ data }) => {
    const sb = admin();
    const owner = data.owner.toLowerCase();
    const code = data.code.trim().toLowerCase();
    if (!/^[a-z0-9]{3,20}$/.test(code)) {
      return { ok: false, reason: "invalid" } as const;
    }

    await ensureRefereeAccount(sb, owner);

    const { data: taken } = await sb
      .from("referral_codes")
      .select("owner_address")
      .eq("code", code)
      .maybeSingle();
    if (taken && (taken as { owner_address: string }).owner_address.toLowerCase() !== owner) {
      return { ok: false, reason: "taken" } as const;
    }

    const { data: existing } = await sb
      .from("referral_codes")
      .select("code")
      .eq("owner_address", owner)
      .maybeSingle();

    const query = existing
      ? sb.from("referral_codes").update({ code }).eq("owner_address", owner)
      : sb.from("referral_codes").insert({ owner_address: owner, code });
    const { error } = await query;
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return { ok: false, reason: "taken" } as const;
      }
      throw new Error(error.message);
    }

    return { ok: true, code } as const;
  });

// ──────────────── Onboarding: bond a referrer ──────────────────────────
// Called once at first-time login. The user either types in a code (e.g.
// `trench042`) or skips, in which case we silently fall back to the
// platform default (DEFAULT_REFERRAL_CODE env). Either way, the new user
// ends up bonded to *someone* — there are no orphan referees.
//
// Idempotent: if this wallet is already bonded, we no-op. Self-referral
// (code belongs to the calling wallet) is blocked.
async function ensureRefereeAccount(sb: ReturnType<typeof supabaseAdmin>, address: string) {
  const { data } = await sb.from("accounts").select("address").eq("address", address).maybeSingle();
  if (data) return;
  const { defaultAccountHandle, defaultDisplayName } = await import("@/lib/handles");
  const { error } = await sb.from("accounts").insert({
    address,
    handle: defaultAccountHandle(address),
    display_name: defaultDisplayName(address),
  });
  if (error && (error as { code?: string }).code !== "23505") {
    throw new Error(error.message);
  }
}

// Lightweight check: does this address already have a referrer bond?
// Used by ReferralOnboarding to decide whether to pop the modal — has
// to be a server fn because the `referrals` table's RLS denies reads
// from the anon client (we don't issue Supabase JWTs).
export const isReferralBonded = createServerFn({ method: "GET" })
  .inputValidator((d: { me: string }) => d)
  .handler(async ({ data }) => {
    const sb = admin();
    const { data: row } = await sb
      .from("referrals")
      .select("referee_address")
      .eq("referee_address", data.me.toLowerCase())
      .maybeSingle();
    return { bonded: !!row };
  });

export const bondReferralForNewUser = createServerFn({ method: "POST" })
  .inputValidator((d: { owner: string; code?: string | null }) => d)
  .handler(async ({ data }) => {
    const sb = admin();
    const lc = data.owner.toLowerCase();

    const { data: existing } = await sb
      .from("referrals")
      .select("referee_address, referrer_address, code")
      .eq("referee_address", lc)
      .maybeSingle();
    if (existing) {
      return {
        bonded: false,
        reason: "already_bonded",
        referrer: (existing as { referrer_address: string }).referrer_address,
        code: (existing as { code: string }).code,
      } as const;
    }

    const fallback = (process.env.DEFAULT_REFERRAL_CODE ?? "").trim().toLowerCase();
    const supplied = (data.code ?? "").trim().toLowerCase();
    // When the user typed a code in onboarding, use ONLY that code — never
    // silently fall back to the platform default (that was stealing referrals).
    const tryCodes = supplied ? [supplied] : (fallback ? [fallback] : []);

    if (tryCodes.length === 0) {
      return { bonded: false, reason: "no_valid_code" } as const;
    }

    await ensureRefereeAccount(sb, lc);

    for (const code of tryCodes) {
      const { data: row } = await sb
        .from("referral_codes")
        .select("code, owner_address")
        .ilike("code", code)
        .maybeSingle();
      const r = row as { code: string; owner_address: string } | null;
      if (!r) continue;
      if (r.owner_address.toLowerCase() === lc) {
        return { bonded: false, reason: "self_referral" } as const;
      }
      const { error } = await sb.from("referrals").insert({
        referee_address: lc,
        referrer_address: r.owner_address.toLowerCase(),
        code: r.code,
      });
      if (error) {
        if ((error as { code?: string }).code === "23505") {
          return { bonded: false, reason: "already_bonded" } as const;
        }
        throw new Error(error.message);
      }
      return {
        bonded: true,
        referrer: r.owner_address.toLowerCase(),
        code: r.code,
        usedDefault: !supplied && code === fallback,
      } as const;
    }

    return { bonded: false, reason: "no_valid_code" } as const;
  });

