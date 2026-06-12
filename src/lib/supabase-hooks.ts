// Thin Supabase data hooks for social feed, profiles, follows, notifications.
// All chat (cabals, DMs, token chat) lives on Gun.js — see src/lib/cabal.ts, gun-dms.ts.
// subscriptions are scoped per-component so they're torn down on unmount.

import { useEffect, useState } from "react";
import { createServerFn } from "@tanstack/react-start";
import { supabase, supabaseAdmin } from "./supabase";
import { fetchIdentities, getCachedIdentity, labelFor, profileSlug, patchIdentity, subscribeIdentityPatches } from "./identity";
import { defaultAccountHandle, defaultDisplayName, isValidCustomHandle, normalizeHandleInput } from "./handles";
import { useMe } from "./useMe";

const enabled = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

export const SUPABASE_ENABLED = enabled;

function normalizeEvmAddress(address: string, label = "address") {
  const value = String(address ?? "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

async function ensureAccountRow(sb: ReturnType<typeof supabaseAdmin>, address: string) {
  const addr = normalizeEvmAddress(address, "wallet address");
  const { error } = await sb.from("accounts").upsert({
    address: addr,
    handle: defaultAccountHandle(addr),
    display_name: defaultDisplayName(addr),
  }, { onConflict: "address", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return addr;
}

async function ensureTokenRow(sb: ReturnType<typeof supabaseAdmin>, address: string) {
  const addr = normalizeEvmAddress(address, "token address");
  const fallback = addr.slice(2, 8).toUpperCase();
  const { error } = await sb.from("tokens").upsert({
    address: addr,
    symbol: fallback,
    name: `Token ${fallback}`,
  }, { onConflict: "address", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return addr;
}

// ---------- POSTS (social feed) -----------------------------------------
export type PostRow = {
  id: string;
  author_address: string;
  body: string;
  quoted_token: string | null;
  trade_tx_hash: string | null;
  likes: number;
  reposts: number;
  views: number;
  created_at: string;
  // Virtual flag for trade-event items merged from the `trades` table on the
  // Following tab. Lets the feed render them with a special "Bought / Sold" badge.
  is_trade?: boolean;
  trade_side?: "BUY" | "SELL";
  trade_value_usd?: number;
  trade_token_symbol?: string;
};

export function usePosts({ following }: { following?: string[] } = {}) {
  const [posts, setPosts] = useState<PostRow[] | null>(null);
  const isFollowingFeed = !!following && following.length > 0;

  useEffect(() => {
    if (!enabled) return;
    const sb = supabase();
    let cancelled = false;

    (async () => {
      // 1. Pull user-authored posts
      let postsQ = sb.from("posts").select("*")
        .order("created_at", { ascending: false }).limit(50);
      if (isFollowingFeed) postsQ = postsQ.in("author_address", following!);
      const { data: postRows } = await postsQ;

      // 2. On the Following feed, merge in trade events from followed wallets
      let tradeItems: PostRow[] = [];
      if (isFollowingFeed) {
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { data: trades } = await sb.from("trades")
          .select("tx_hash, account_address, token_address, side, value_usd, created_at_chain")
          .in("account_address", following!)
          .gte("created_at_chain", since)
          .order("created_at_chain", { ascending: false })
          .limit(50);
        // Look up symbols once
        const tokenAddrs = [...new Set((trades ?? []).map((t: any) => t.token_address))];
        const symBy = new Map<string, string>();
        if (tokenAddrs.length) {
          const { data: toks } = await sb.from("tokens").select("address, symbol").in("address", tokenAddrs);
          for (const t of toks ?? []) symBy.set(t.address, t.symbol);
        }
        tradeItems = (trades ?? []).map((t: any) => ({
          id: `trade:${t.tx_hash}`,
          author_address: t.account_address,
          body: `${t.side === "BUY" ? "Bought" : "Sold"} $${Number(t.value_usd ?? 0).toFixed(0)} of $${symBy.get(t.token_address) ?? t.token_address.slice(0, 6)}`,
          quoted_token: t.token_address,
          trade_tx_hash: t.tx_hash,
          likes: 0, reposts: 0, views: 0,
          created_at: t.created_at_chain,
          is_trade: true,
          trade_side: t.side,
          trade_value_usd: Number(t.value_usd ?? 0),
          trade_token_symbol: symBy.get(t.token_address) ?? "",
        }));
      }

      if (cancelled) return;
      const merged = [...(postRows ?? []), ...tradeItems]
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
        .slice(0, 100);
      setPosts(merged as PostRow[]);
    })();

    // Realtime — new posts AND new trades from followed wallets push live
    const postsCh = sb.channel(`posts:feed:${Math.random().toString(36).slice(2, 10)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, (p) => {
        const row = p.new as PostRow;
        if (isFollowingFeed && !following!.includes(row.author_address)) return;
        setPosts((s) => [row, ...(s ?? [])].slice(0, 100));
      })
      .subscribe();

    let tradesCh: ReturnType<typeof sb.channel> | null = null;
    if (isFollowingFeed) {
      tradesCh = sb.channel(`posts:trades:${Math.random().toString(36).slice(2, 10)}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "trades" }, (p) => {
          const t = p.new as any;
          if (!following!.includes(t.account_address)) return;
          const item: PostRow = {
            id: `trade:${t.tx_hash}`,
            author_address: t.account_address,
            body: `${t.side === "BUY" ? "Bought" : "Sold"} $${Number(t.value_usd ?? 0).toFixed(0)} of ${t.token_address.slice(0, 8)}…`,
            quoted_token: t.token_address,
            trade_tx_hash: t.tx_hash,
            likes: 0, reposts: 0, views: 0,
            created_at: t.created_at_chain,
            is_trade: true,
            trade_side: t.side,
            trade_value_usd: Number(t.value_usd ?? 0),
            trade_token_symbol: "",
          };
          setPosts((s) => [item, ...(s ?? [])].slice(0, 100));
        })
        .subscribe();
    }

    return () => { cancelled = true; sb.removeChannel(postsCh); if (tradesCh) sb.removeChannel(tradesCh); };
  }, [following?.join(",")]);

  return posts;
}

// ─────────────── Ranked "For you" feed ─────────────────────────────
// Reads from the `post_scores` materialized view (refreshed every ~60s by
// the feed-ranker-worker). Order is: recency × 1.0 + velocity × 0.5 +
// author_signal × 0.1, plus a +15 token boost applied client-side when the
// post's quoted_token is in the user's watch list.
//
// We still subscribe to Realtime on `posts` so brand-new posts appear
// immediately (they get a synthetic score of ∞ until the next refresh).
export function useRankedPosts({
  watchedTokens, limit = 50,
}: { watchedTokens?: string[]; limit?: number } = {}) {
  const [posts, setPosts] = useState<PostRow[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const sb = supabase();
    let cancelled = false;

    (async () => {
      // Join post_scores with the full posts row
      const { data: ranked } = await sb
        .from("post_scores")
        .select("id, score, quoted_token")
        .order("score", { ascending: false })
        .limit(limit * 2);                            // over-fetch for boost re-rank
      if (!ranked || ranked.length === 0) {
        // Fresh DB or view hasn't been built yet — fall back to recency
        const { data: raw } = await sb.from("posts").select("*")
          .is("parent_id", null)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (!cancelled) setPosts((raw as PostRow[]) ?? []);
        return;
      }
      const ids = ranked.map((r: any) => r.id);
      const { data: rows } = await sb.from("posts").select("*").in("id", ids);
      const byId = new Map<string, PostRow>();
      for (const r of (rows ?? []) as PostRow[]) byId.set(r.id, r);
      // Apply client-side token boost + final sort
      const boosted = ranked.map((r: any) => {
        const post = byId.get(r.id);
        const boost = post?.quoted_token && watchedTokens?.includes(post.quoted_token) ? 15 : 0;
        return { post, score: Number(r.score) + boost };
      }).filter((x) => x.post)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((x) => x.post!);
      if (!cancelled) setPosts(boosted);
    })();

    const ch = sb.channel(`posts:ranked:${Math.random().toString(36).slice(2, 10)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, (p) => {
        const row = p.new as PostRow;
        if (row.parent_id) return;                    // replies don't appear in feed
        setPosts((s) => [row, ...(s ?? [])].slice(0, 100));
      })
      .subscribe();

    return () => { cancelled = true; sb.removeChannel(ch); };
  }, [watchedTokens?.join(","), limit]);

  return posts;
}

// ─────────────── Reposts ───────────────────────────────────────────
export async function repostPost(postId: string, me: string, body?: string) {
  if (!enabled) return;
  // upsert so re-clicking is idempotent
  await supabase().from("reposts").upsert({
    post_id: postId, reposter_address: me.toLowerCase(), body: body ?? null,
  }, { onConflict: "post_id,reposter_address" });
}

export async function unrepostPost(postId: string, me: string) {
  if (!enabled) return;
  await supabase().from("reposts").delete()
    .eq("post_id", postId).eq("reposter_address", me.toLowerCase());
}

export function useDidIRepost(postId: string, me: string | undefined) {
  const [did, setDid] = useState(false);
  useEffect(() => {
    if (!enabled || !me) return;
    (async () => {
      const { data } = await supabase().from("reposts")
        .select("post_id")
        .eq("post_id", postId).eq("reposter_address", me.toLowerCase())
        .maybeSingle();
      setDid(!!data);
    })();
  }, [postId, me]);
  return { did, toggle: async () => {
    if (!me) return;
    if (did) { await unrepostPost(postId, me); setDid(false); }
    else     { await repostPost(postId, me);   setDid(true);  }
  }};
}

// Post creation goes through a SERVER fn that uses the admin client to
// write through RLS. The browser anon client can't insert into `posts`
// because the `self post` policy requires `auth_addr() = author_address`
// — and we don't issue Supabase auth JWTs (Para handles auth, the
// server fn enforces ownership by just trusting the address the client
// provides, same as every other server-routed write).
export const createPost = createServerFn({ method: "POST" })
  .inputValidator((d: {
    author_address: string;
    body: string;
    quoted_token?: string | null;
    trade_tx_hash?: string | null;
    parent_id?: string | null;
  }) => d)
  .handler(async ({ data: input }): Promise<PostRow | null> => {
    const sb = supabaseAdmin();
    const author = await ensureAccountRow(sb, input.author_address);
    const body = String(input.body ?? "").trim();
    if (!body) throw new Error("Post cannot be empty");
    if (body.length > 200) throw new Error("Post must be 200 characters or less");

    // Auto-resolve the FIRST $CASHTAG in the body so cashtag links jump
    // straight to the right token instead of needing the /t/<sym> redirect.
    let quoted = input.quoted_token ?? null;
    if (!quoted) {
      const m = /\$([A-Za-z][A-Za-z0-9]{0,15})/.exec(body);
      if (m) {
        try {
          const { searchTokens } = await import("@/lib/dirol");
          const hits = await searchTokens({ data: { search: m[1], limit: 5 } });
          const best = hits.find((t) => t.isVerified) ?? hits[0];
          if (best) quoted = best.address.toLowerCase();
        } catch { /* leave quoted=null; RichText falls back to /t/<sym> */ }
      }
    }
    if (quoted) quoted = await ensureTokenRow(sb, quoted);

    const { data, error } = await sb.from("posts")
      .insert({
        author_address: author,
        body,
        quoted_token: quoted,
        trade_tx_hash: input.trade_tx_hash ?? null,
        parent_id: input.parent_id ?? null,
      })
      .select().single();
    if (error) throw new Error(error.message);
    return data as PostRow;
  });

// Edit / delete own posts — server fn bypasses RLS (no Supabase JWT).
export const editPost = createServerFn({ method: "POST" })
  .inputValidator((d: { postId: string; me: string; body: string }) => d)
  .handler(async ({ data }) => {
    const body = data.body.trim();
    if (!body) throw new Error("Post cannot be empty");
    const { error } = await supabaseAdmin().from("posts")
      .update({ body })
      .eq("id", data.postId)
      .eq("author_address", data.me.toLowerCase());
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deletePost = createServerFn({ method: "POST" })
  .inputValidator((d: { postId: string; me: string }) => d)
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin().from("posts")
      .delete()
      .eq("id", data.postId)
      .eq("author_address", data.me.toLowerCase());
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// Toggle a like on a post. Server fn so RLS doesn't block the insert.
// Returns the new state so the UI can update without a refetch round-trip.
export const togglePostLike = createServerFn({ method: "POST" })
  .inputValidator((d: { postId: string; me: string }) => d)
  .handler(async ({ data }): Promise<{ liked: boolean; likes: number }> => {
    const sb = supabaseAdmin();
    const me = data.me.toLowerCase();
    // Try delete first — cheap probe of current state.
    const del = await sb.from("post_likes")
      .delete({ count: "exact" })
      .eq("post_id", data.postId).eq("account_address", me);
    if (del.error) throw new Error(del.error.message);
    if ((del.count ?? 0) > 0) {
      // Direct decrement — read current, write current-1, floor at 0.
      const { data: row } = await sb.from("posts").select("likes").eq("id", data.postId).maybeSingle();
      const next = Math.max(0, ((row as any)?.likes ?? 1) - 1);
      await sb.from("posts").update({ likes: next }).eq("id", data.postId);
      return { liked: false, likes: next };
    }
    // Insert
    const ins = await sb.from("post_likes").insert({ post_id: data.postId, account_address: me });
    if (ins.error) throw new Error(ins.error.message);
    // Bump counter
    const { data: row } = await sb.from("posts").select("likes").eq("id", data.postId).maybeSingle();
    const next = ((row as any)?.likes ?? 0) + 1;
    await sb.from("posts").update({ likes: next }).eq("id", data.postId);
    return { liked: true, likes: next };
  });

// Check if a wallet has liked specific posts (batch). Cheap call so the
// feed can show filled/empty hearts on initial render.
export const checkPostLikes = createServerFn({ method: "POST" })
  .inputValidator((d: { postIds: string[]; me: string }) => d)
  .handler(async ({ data }): Promise<Record<string, boolean>> => {
    if (data.postIds.length === 0) return {};
    const sb = supabaseAdmin();
    const { data: rows } = await sb.from("post_likes")
      .select("post_id")
      .eq("account_address", data.me.toLowerCase())
      .in("post_id", data.postIds);
    const out: Record<string, boolean> = {};
    for (const r of (rows ?? []) as any[]) out[r.post_id] = true;
    return out;
  });

// Record a view. Idempotent per (post, viewer) — first view counts, later
// ones no-op. We update posts.views directly because views aren't worth
// a separate table; the volume is too high.
export const recordPostView = createServerFn({ method: "POST" })
  .inputValidator((d: { postId: string; me?: string }) => d)
  .handler(async ({ data }) => {
    const sb = supabaseAdmin();
    // Simple impl: just increment. Could be deduped via a post_views
    // table if needed — for now we treat views as a vanity counter.
    const { data: row } = await sb.from("posts").select("views").eq("id", data.postId).maybeSingle();
    const next = ((row as any)?.views ?? 0) + 1;
    await sb.from("posts").update({ views: next }).eq("id", data.postId);
    return { views: next };
  });

// Chats / DMs / cabals: Gun.js only — see src/lib/cabal.ts, gun-dms.ts, gun.ts

// ---------- Portfolio (wallet page) ---------------------------------------
export type PnlSnapshot = {
  account_address: string;
  window: string;
  realized_usd: number;
  unrealized_usd: number;
  volume_usd: number;
  trades_count: number;
  win_rate_pct: number | null;
};

export function useWalletPnl(me: string | undefined, timeWindow = "ALL") {
  const [snap, setSnap] = useState<PnlSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled || !me) { setSnap(null); setLoading(false); return; }
    const sb = supabase();
    let cancel = false;
    (async () => {
      const { data } = await sb.from("pnl_snapshots")
        .select("*").eq("account_address", me.toLowerCase()).eq("time_window", timeWindow).maybeSingle();
      if (!cancel) {
        setSnap(data as PnlSnapshot | null);
        setLoading(false);
      }
    })();
    const ch = sb.channel(`pnl:${me}:${timeWindow}:${Date.now()}:${Math.random().toString(36).slice(2,8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pnl_snapshots", filter: `account_address=eq.${me.toLowerCase()}` }, () => {
        sb.from("pnl_snapshots").select("*").eq("account_address", me.toLowerCase()).eq("time_window", timeWindow).maybeSingle()
          .then(({ data }) => { if (!cancel) setSnap(data as PnlSnapshot | null); });
      })
      .subscribe();
    return () => { cancel = true; sb.removeChannel(ch); };
  }, [me, timeWindow]);

  return { snap, loading };
}

export type TradeRow = {
  tx_hash: string;
  token_address: string;
  side: "BUY" | "SELL";
  token_amount: string;
  value_usd: number | null;
  created_at_chain: string;
};

export function useMyTrades(me: string | undefined, limit = 50) {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled || !me) { setTrades([]); setLoading(false); return; }
    const sb = supabase();
    let cancel = false;
    const refresh = () => sb.from("trades")
      .select("tx_hash, token_address, side, token_amount, value_usd, created_at_chain")
      .eq("account_address", me.toLowerCase())
      .order("created_at_chain", { ascending: false })
      .limit(limit)
      .then(({ data }) => {
        if (!cancel) {
          setTrades(((data as TradeRow[]) ?? []).map((t) => ({
            ...t,
            token_address: t.token_address.toLowerCase(),
          })));
          setLoading(false);
        }
      });
    refresh();
    const ch = sb.channel(`trades:${me}:${Date.now()}:${Math.random().toString(36).slice(2,8)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "trades", filter: `account_address=eq.${me.toLowerCase()}` }, () => refresh())
      .subscribe();
    return () => { cancel = true; sb.removeChannel(ch); };
  }, [me, limit]);

  return { trades, loading };
}

export function useMyPosts(me: string | undefined, limit = 30) {
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled || !me) { setPosts([]); setLoading(false); return; }
    const sb = supabase();
    let cancel = false;
    const refresh = () => sb.from("posts")
      .select("*")
      .eq("author_address", me.toLowerCase())
      .is("parent_id", null)
      .order("created_at", { ascending: false })
      .limit(limit)
      .then(({ data }) => {
        if (!cancel) {
          setPosts((data as PostRow[]) ?? []);
          setLoading(false);
        }
      });
    refresh();
    const ch = sb.channel(`posts:mine:${me}:${Date.now()}:${Math.random().toString(36).slice(2,8)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts", filter: `author_address=eq.${me.toLowerCase()}` }, () => refresh())
      .subscribe();
    return () => { cancel = true; sb.removeChannel(ch); };
  }, [me, limit]);

  return { posts, loading };
}

export type SuggestedTrader = {
  address: string;
  handle: string | null;
  display_name: string | null;
  image_uri: string | null;
  is_verified: boolean;
  score: number;
  realized_usd?: number;
};

const SMART_MONEY_LABELS = ["smart_money", "whale"] as const;

/** Wallet addresses with smart-money / whale labels (for feed filtering). */
export function useSmartMoneyAddresses() {
  const [addrs, setAddrs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) {
      setAddrs(new Set());
      setLoading(false);
      return;
    }
    const sb = supabase();
    let cancel = false;
    (async () => {
      const { data } = await sb
        .from("account_labels")
        .select("account_address")
        .in("label", [...SMART_MONEY_LABELS]);
      if (!cancel) {
        setAddrs(new Set((data ?? []).map((r: { account_address: string }) => r.account_address.toLowerCase())));
        setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  return { addrs, loading };
}

export function useSuggestedTraders(limit = 8) {
  const [traders, setTraders] = useState<SuggestedTrader[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const sb = supabase();
    let cancel = false;
    (async () => {
      const { data: labels } = await sb.from("account_labels")
        .select("account_address, score, label")
        .in("label", [...SMART_MONEY_LABELS])
        .order("score", { ascending: false })
        .limit(limit * 2);
      let addrs = (labels ?? []).map((l: any) => l.account_address as string);
      if (addrs.length < limit) {
        const { data: top } = await sb.from("pnl_snapshots")
          .select("account_address, realized_usd")
          .eq("time_window", "7D")
          .order("realized_usd", { ascending: false })
          .limit(limit);
        for (const t of top ?? []) {
          if (!addrs.includes((t as any).account_address)) addrs.push((t as any).account_address);
        }
      }
      addrs = addrs.slice(0, limit);
      if (addrs.length === 0) { if (!cancel) setTraders([]); return; }
      const { data: accts } = await sb.from("accounts")
        .select("address, handle, display_name, image_uri, is_verified")
        .in("address", addrs);
      const scoreBy = new Map((labels ?? []).map((l: any) => [l.account_address, Number(l.score ?? 0)]));
      const pnlBy = new Map<string, number>();
      const { data: pnls } = await sb.from("pnl_snapshots").select("account_address, realized_usd").eq("time_window", "7D").in("account_address", addrs);
      for (const p of pnls ?? []) pnlBy.set((p as any).account_address, Number((p as any).realized_usd ?? 0));
      const list = ((accts ?? []) as any[]).map((a) => ({
        address: a.address,
        handle: a.handle,
        display_name: a.display_name,
        image_uri: a.image_uri,
        is_verified: a.is_verified,
        score: scoreBy.get(a.address) ?? 0,
        realized_usd: pnlBy.get(a.address),
      }));
      list.sort((a, b) => (b.score || b.realized_usd || 0) - (a.score || a.realized_usd || 0));
      if (!cancel) setTraders(list);
    })();
    return () => { cancel = true; };
  }, [limit]);

  return traders;
}

// ---------- NOTIFICATIONS -----------------------------------------------
export type NotificationRow = {
  id: string;
  owner_address: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
};

export function useNotifications(me: string | undefined) {
  const [notifs, setNotifs] = useState<NotificationRow[] | null>(null);

  useEffect(() => {
    if (!enabled || !me) return;
    const sb = supabase();
    let cancelled = false;

    (async () => {
      try {
        // Server fn — admin client bypasses the `owner read notif` RLS
        // policy which requires auth_addr() (we don't issue Supabase JWTs).
        const { listNotifications } = await import("@/lib/alerts-server");
        const rows = await listNotifications({ data: { me } });
        if (cancelled) return;
        setNotifs(rows as NotificationRow[]);
      } catch (e) {
        if (!cancelled) console.error("[notifs] list failed", e);
      }
    })();

    // Unique channel name per mount — without this, React StrictMode /
    // navigations re-mount the hook against the SAME channel name and
    // Supabase throws "cannot add postgres_changes callbacks ... after
    // subscribe()" because the previous instance is still alive.
    const ch = sb
      .channel(`notifs:${me}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `owner_address=eq.${me}` },
        (p) => setNotifs((s) => [p.new as NotificationRow, ...(s ?? [])]),
      )
      .subscribe();

    return () => { cancelled = true; sb.removeChannel(ch); };
  }, [me]);

  return notifs;
}

export async function markNotificationRead(id: string, me?: string) {
  if (!enabled || !me) return;
  // Same RLS bypass — admin server fn so the update actually persists.
  const { markNotifRead } = await import("@/lib/alerts-server");
  await markNotifRead({ data: { me, id } });
}

// ─────────────── Follow graph ────────────────────────────────────────
//
// `follows (follower_address, followee_address)` is RLS-gated:
//   * Anyone can read
//   * follower_address must equal auth_addr() to insert/delete
//
// Writes go through server fns (admin client) — same as createPost /
// updateMyProfile — because we don't issue Supabase JWTs from the browser.
//
// useFollow(targetAddress) returns { isFollowing, followerCount, followingCount,
// toggle() }. Subscribes to follows realtime so counts stay live.

export const toggleFollow = createServerFn({ method: "POST" })
  .inputValidator((d: { me: string; target: string }) => d)
  .handler(async ({ data }): Promise<{ isFollowing: boolean; followerCount: number }> => {
    const sb = supabaseAdmin();
    const me = data.me.toLowerCase();
    const target = data.target.toLowerCase();
    if (me === target) throw new Error("Cannot follow yourself");

    await ensureAccountRow(sb, me);
    await ensureAccountRow(sb, target);

    const del = await sb.from("follows")
      .delete({ count: "exact" })
      .eq("follower_address", me)
      .eq("followee_address", target);
    if (del.error) throw new Error(del.error.message);
    if ((del.count ?? 0) > 0) {
      const { count } = await sb.from("follows")
        .select("*", { count: "exact", head: true })
        .eq("followee_address", target);
      return { isFollowing: false, followerCount: count ?? 0 };
    }

    const ins = await sb.from("follows").insert({ follower_address: me, followee_address: target });
    if (ins.error) throw new Error(ins.error.message);

    const { count } = await sb.from("follows")
      .select("*", { count: "exact", head: true })
      .eq("followee_address", target);

    fetchIdentities([me]).then(() => {
      const slug = profileSlug(getCachedIdentity(me));
      sb.from("notifications").insert({
        owner_address: target,
        kind: "follow.new",
        title: "New follower",
        body: `${labelFor(getCachedIdentity(me))} followed you`,
        link: slug ? `/profile/${slug}` : "/social",
      }).then(() => {});
    });

    return { isFollowing: true, followerCount: count ?? 0 };
  });

export const setFollowNotifyTrades = createServerFn({ method: "POST" })
  .inputValidator((d: { me: string; target: string; notify: boolean }) => d)
  .handler(async ({ data }) => {
    const sb = supabaseAdmin();
    await sb.from("follows")
      .update({ notify_trades: data.notify })
      .eq("follower_address", data.me.toLowerCase())
      .eq("followee_address", data.target.toLowerCase());
  });

export function useFollow(target: string | undefined) {
  const me = useMe()?.toLowerCase();
  const [isFollowing, setIsFollowing] = useState(false);
  const [notifyTrades, setNotifyTradesState] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

  useEffect(() => {
    if (!enabled || !target) return;
    const sb = supabase();
    let cancel = false;
    const lc = target.toLowerCase();

    const refresh = async () => {
      const [{ count: followers }, { count: following }, mineRes] = await Promise.all([
        sb.from("follows").select("*", { count: "exact", head: true }).eq("followee_address", lc),
        sb.from("follows").select("*", { count: "exact", head: true }).eq("follower_address", lc),
        me
          ? sb.from("follows").select("follower_address, notify_trades")
              .eq("follower_address", me).eq("followee_address", lc).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (cancel) return;
      setFollowerCount(followers ?? 0);
      setFollowingCount(following ?? 0);
      setIsFollowing(!!mineRes.data);
      setNotifyTradesState(!!(mineRes.data as any)?.notify_trades);
    };
    refresh();

    const ch = sb
      .channel(`follows:${lc}:${Math.random().toString(36).slice(2, 10)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "follows", filter: `followee_address=eq.${lc}` },
        () => refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "follows", filter: `follower_address=eq.${lc}` },
        () => refresh(),
      )
      .subscribe();

    return () => { cancel = true; sb.removeChannel(ch); };
  }, [target, me]);

  const toggle = async () => {
    if (!enabled || !target || !me) return;
    const lc = target.toLowerCase();
    if (me === lc) return;
    try {
      const res = await toggleFollow({ data: { me, target: lc } });
      setIsFollowing(res.isFollowing);
      setFollowerCount(res.followerCount);
    } catch (e) {
      console.error("[follow] toggle failed", e);
    }
  };

  const setNotifyTrades = async (next: boolean) => {
    if (!enabled || !target || !me) return;
    const lc = target.toLowerCase();
    setNotifyTradesState(next);
    try {
      await setFollowNotifyTrades({ data: { me, target: lc, notify: next } });
    } catch (e) {
      console.error("[follow] notify_trades update failed", e);
      setNotifyTradesState(!next);
    }
  };

  return {
    isFollowing,
    notifyTrades,
    setNotifyTrades,
    followerCount,
    followingCount,
    toggle,
    canFollow: !!me && me !== target?.toLowerCase(),
  };
}

// ─────────────── Account profile (read + edit own) ──────────────────
export type AccountProfile = {
  address: string;
  handle: string | null;
  display_name: string | null;
  bio: string | null;
  image_uri: string | null;
  banner_uri: string | null;
  twitter_url: string | null;
  telegram_url: string | null;
  website_url: string | null;
  is_verified: boolean;
  created_at: string | null;     // when their accounts row was created
};

export function useAccountProfile(address: string | undefined) {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled || !address) { setLoading(false); return; }
    const lc = address.toLowerCase();
    let cancel = false;

    const load = async () => {
      const { data } = await supabase()
        .from("accounts")
        .select("address, handle, display_name, bio, image_uri, banner_uri, twitter_url, telegram_url, website_url, is_verified")
        .eq("address", lc).maybeSingle();
      if (cancel) return;
      const DEFAULT_AVATAR =
        "https://www.image2url.com/r2/default/images/1779999303234-5b9fa706-14c0-4309-af0f-f5f17112bb1c.jpg";
      const row = (data as AccountProfile) ?? {
        address: lc, handle: null, display_name: null, bio: null,
        image_uri: DEFAULT_AVATAR, banner_uri: null,
        twitter_url: null, telegram_url: null, website_url: null,
        is_verified: false,
      };
      if (!row.image_uri) row.image_uri = DEFAULT_AVATAR;
      patchIdentity(lc, {
        handle: row.handle,
        display_name: row.display_name,
        image_uri: row.image_uri,
      });
      setProfile(row);
      setLoading(false);
    };
    void load();

    const unsubPatch = subscribeIdentityPatches((addr, patch) => {
      if (addr !== lc) return;
      setProfile((p) => (p ? { ...p, ...patch } : p));
    });

    // Realtime — any update to this row reloads the hook. Means a Save
    // in the edit modal reflects on the profile page header without a
    // refresh, and on another device viewing the same page.
    const sb = supabase();
    // Unique per-hook channel name. Two components subscribing to the
    // same address (e.g. profile page viewing your own profile uses the
    // hook twice — once for `me`, once for `resolvedAddr`) would
    // otherwise reuse the same Supabase channel object, and the second
    // `.on(...)` would fire on an already-subscribed channel and throw.
    const channelId = `account:${lc}:${Math.random().toString(36).slice(2, 10)}`;
    const ch = sb
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "accounts", filter: `address=eq.${lc}` },
        () => void load(),
      )
      .subscribe();

    return () => { cancel = true; unsubPatch(); sb.removeChannel(ch); };
  }, [address]);

  return { profile, loading, setProfile };
}

// Profile saves run through a SERVER fn so they bypass RLS via the
// admin client. The `self insert/update account` RLS policies require
// `auth_addr() = address`, and we don't issue Supabase JWTs (Para
// handles auth, server fn enforces ownership by trusting the address
// the client provides — same pattern as createPost / sendTokenChatMessage).
//
// Old code (browser anon client) used to silently fail because RLS
// blocked every insert/update. That's why "edit profile" appeared not
// to do anything.
export const updateMyProfile = createServerFn({ method: "POST" })
  .inputValidator((d: { me: string; patch: Partial<AccountProfile> }) => d)
  .handler(async ({ data }) => {
    const sb = supabaseAdmin();
    const addr = data.me.toLowerCase();
    const clean: Partial<AccountProfile> = { ...data.patch };
    if (clean.handle != null) {
      const h = normalizeHandleInput(String(clean.handle));
      if (h && !isValidCustomHandle(h) && h !== defaultAccountHandle(addr)) {
        throw new Error("Username must be 2–20 letters, digits, _ or .");
      }
      clean.handle = h || null;
    }
    const { data: existing } = await sb.from("accounts")
      .select("address").eq("address", addr).maybeSingle();
    if (!existing) {
      const { error } = await sb.from("accounts").insert({
        address: addr,
        handle: clean.handle ?? defaultAccountHandle(addr),
        display_name: clean.display_name ?? defaultDisplayName(addr),
        ...clean,
      });
      if (error) {
        if ((error as any).code === "23505" || /duplicate|unique/i.test(error.message)) {
          throw new Error("Username already taken");
        }
        throw new Error(error.message);
      }
      return { created: true };
    }
    const { error } = await sb.from("accounts").update(clean).eq("address", addr);
    if (error) {
      if ((error as any).code === "23505" || /duplicate|unique/i.test(error.message)) {
        throw new Error("Username already taken");
      }
      throw new Error(error.message);
    }
    return { created: false };
  });

// Check if a handle is available BEFORE the user clicks Save. Returns true
// when no other account has it (case-insensitive). Empty / current-user's
// own handle both count as available.
export async function isHandleAvailable(handle: string, me: string): Promise<boolean> {
  if (!enabled) return true;
  const h = handle.replace(/^@/, "").trim().toLowerCase();
  if (!h) return true;
  const { data } = await supabase().from("accounts")
    .select("address").ilike("handle", h).maybeSingle();
  if (!data) return true;
  return (data as any).address === me.toLowerCase();
}

