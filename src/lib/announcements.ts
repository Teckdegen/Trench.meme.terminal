// Official announcements from the `trenchmem` handle.
//
// Architecture: instead of fan-out writes to every user's notifications
// table (which would be a write-amplification nightmare at scale), we
// store announcements as normal `posts` rows from the trenchmem account
// and ALL the read surfaces — alerts page, feed pin, social timeline —
// query that same row. One row, every user sees it. Zero write fanout.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { SUPABASE_ENABLED } from "@/lib/supabase-hooks";
import { ANNOUNCEMENT_HANDLE } from "@/lib/brand";

export type Announcement = {
  id: string;
  author_address: string;
  body: string;
  quoted_token: string | null;
  created_at: string;
};

// Cached announcer address — resolves the trenchmem handle to its wallet
// address once, then re-uses it for all subsequent queries.
let _announcerAddrPromise: Promise<string | null> | null = null;
async function announcerAddress(): Promise<string | null> {
  if (!SUPABASE_ENABLED) return null;
  if (_announcerAddrPromise) return _announcerAddrPromise;
  _announcerAddrPromise = (async () => {
    const { data } = await supabase()
      .from("accounts")
      .select("address")
      .ilike("handle", ANNOUNCEMENT_HANDLE)
      .maybeSingle();
    return (data as any)?.address ?? null;
  })();
  return _announcerAddrPromise;
}

// Latest announcement — used to pin a card at the top of the social feed.
// Realtime-subscribed so a new announcement appears for everyone instantly.
export function useLatestAnnouncement(): Announcement | null {
  const [post, setPost] = useState<Announcement | null>(null);

  useEffect(() => {
    if (!SUPABASE_ENABLED) return;
    let cancel = false;
    const sb = supabase();
    let ch: ReturnType<typeof sb.channel> | null = null;

    (async () => {
      const addr = await announcerAddress();
      if (!addr || cancel) return;

      const fetchLatest = async () => {
        const { data } = await sb
          .from("posts")
          .select("id, author_address, body, quoted_token, created_at")
          .eq("author_address", addr)
          .is("parent_id", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!cancel) setPost((data as Announcement) ?? null);
      };
      fetchLatest();

      // Realtime — new announcement INSERTs replace the pin
      ch = sb
        .channel(`announcements:latest:${Math.random().toString(36).slice(2, 10)}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "posts", filter: `author_address=eq.${addr}` },
          (p) => {
            const row = p.new as Announcement;
            if (row && !cancel) setPost(row);
          },
        )
        .subscribe();
    })();

    return () => {
      cancel = true;
      if (ch) supabase().removeChannel(ch);
    };
  }, []);

  return post;
}

// Recent announcements — surfaced as "alerts" in the notifications page.
// Defaults to the last 20 since `since`. Realtime-subscribed.
export function useAnnouncements(opts: { since?: Date; limit?: number } = {}): Announcement[] {
  const [list, setList] = useState<Announcement[]>([]);
  const sinceIso = opts.since?.toISOString() ?? new Date(Date.now() - 14 * 86_400_000).toISOString();
  const limit = opts.limit ?? 20;

  useEffect(() => {
    if (!SUPABASE_ENABLED) return;
    let cancel = false;
    const sb = supabase();
    let ch: ReturnType<typeof sb.channel> | null = null;

    (async () => {
      const addr = await announcerAddress();
      if (!addr || cancel) return;

      const { data } = await sb
        .from("posts")
        .select("id, author_address, body, quoted_token, created_at")
        .eq("author_address", addr)
        .is("parent_id", null)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (!cancel) setList((data as Announcement[]) ?? []);

      ch = sb
        .channel(`announcements:list:${Math.random().toString(36).slice(2, 10)}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "posts", filter: `author_address=eq.${addr}` },
          (p) => {
            const row = p.new as Announcement;
            if (row && !cancel) setList((s) => [row, ...s].slice(0, limit));
          },
        )
        .subscribe();
    })();

    return () => {
      cancel = true;
      if (ch) supabase().removeChannel(ch);
    };
  }, [sinceIso, limit]);

  return list;
}

// Sync check used by post composer + RichText — is this address the
// official announcer?
export function isAnnouncer(handle: string | null | undefined): boolean {
  return !!handle && handle.toLowerCase() === ANNOUNCEMENT_HANDLE.toLowerCase();
}
