import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/layout/AppLayout";
import { fmtPct, fmtUsd } from "@/lib/fmt";
import { useIdentities, useIdentity, labelFor, profileSlug, profileRoute, resolveToAddress } from "@/lib/identity";
import { isOwnAccount } from "@/lib/own-profile";
import { ProfileActionButton } from "@/components/ProfileActionButton";
import { PostMenu } from "@/components/PostMenu";
import {
  SUPABASE_ENABLED,
  usePosts,
  useRankedPosts,
  createPost as sbCreatePost,
  useSuggestedTraders,
  useSmartMoneyAddresses,
} from "@/lib/supabase-hooks";
import { useDiscoveryFeed } from "@/lib/discovery-feed";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { PinnedAnnouncement } from "@/components/PinnedAnnouncement";
import { MentionAutocomplete } from "@/components/MentionAutocomplete";
import { useMe } from "@/lib/useMe";
import {
  TrendingUp, Search,
  Settings, ArrowDownLeft, ArrowUpRight,
} from "lucide-react";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { UserAvatar } from "@/components/Handle";
import { ModalShell } from "@/components/ui/modal-shell";

export const Route = createFileRoute("/social")({ component: Social });

const tabs = ["For you", "Following", "Smart Money", "Launches", "Memes"];

function timeAgo(i: number) {
  if (i === 0) return "just now";
  if (i < 5) return `${i * 3}m`;
  if (i < 10) return `${i}h`;
  return `${i - 9}d`;
}

function Avatar({ seed, color }: { seed: string; color: string }) {
  return (
    <div
      className="size-10 sm:size-11 rounded-full grid place-items-center text-sm font-bold shrink-0"
      style={{ background: "#000", color, border: "1px solid rgba(168, 85, 247, 0.35)" }}
    >
      {seed[0].toUpperCase()}
    </div>
  );
}

const mobileTabs = ["Feed", "Top Gainers", "Who to follow"] as const;
type MobileTab = (typeof mobileTabs)[number];

// RichText parses $CASHTAGS and @MENTIONS.
//   * Cashtags link to /token/<quotedToken>?tab=Chat (drop the user straight
//     into the token's chat room). When the post has no quoted_token we link
//     to the search-resolver route /t/<symbol>?tab=Chat which redirects via
//     Dirol's /tokens search.
//   * Mentions link to /profile/<handle> (lower-cased).
function RichText({ text, quotedToken }: { text: string; quotedToken?: string | null }) {
  const parts = text.split(/(\$[A-Za-z][A-Za-z0-9]*|@[A-Za-z0-9_.]+)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("$") && p.length > 1) {
          const sym = p.slice(1);
          // Prefer the post's quoted_token (set by the bot or by createPost
          // resolving the first cashtag). Otherwise punt to the /t/<sym>
          // resolver route.
          if (quotedToken && /^0x[a-fA-F0-9]{40}$/.test(quotedToken)) {
            return (
              <Link
                key={i}
                to="/token/$id"
                params={{ id: quotedToken }}
                search={{ tab: "Chat" }}
                className="text-primary font-semibold hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {p}
              </Link>
            );
          }
          return (
            <a
              key={i}
              href={`/t/${sym}?tab=Chat`}
              className="text-primary font-semibold hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {p}
            </a>
          );
        }
        if (p.startsWith("@") && p.length > 1) {
          const username = p.slice(1).toLowerCase();
          return (
            <Link
              key={i}
              to="/profile/$username"
              params={{ username }}
              className="text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {p}
            </Link>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

const FOLLOW_KEY = "social.followed";
const ONLY_FOLLOWED_KEY = "social.onlyFollowed";

function Social() {
  useDocumentTitle("Social");
  const [mTab, setMTab] = useState<MobileTab>("Feed");
  const [feedTab, setFeedTab] = useState<string>(tabs[0]);
  const [followed, setFollowed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set<string>();
    try {
      const raw = localStorage.getItem(FOLLOW_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const [onlyFollowed, setOnlyFollowed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(ONLY_FOLLOWED_KEY) === "1";
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deletedPostIds, setDeletedPostIds] = useState<Set<string>>(new Set());
  const [editedBodies, setEditedBodies] = useState<Record<string, string>>({});
  const me = useMe();
  const myIdentity = useIdentity(me);
  const myHandle = myIdentity?.handle;
  // "For you" uses the ranker (recency × velocity × author signal).
  // "Following" stays in chronological merge mode (posts + trades).
  const [followingAddrs, setFollowingAddrs] = useState<string[]>([]);
  useEffect(() => {
    if (feedTab !== "Following" || followed.size === 0) {
      setFollowingAddrs([]);
      return;
    }
    let cancel = false;
    Promise.all([...followed].map((h) => resolveToAddress(h))).then((addrs) => {
      if (!cancel) setFollowingAddrs(addrs.filter(Boolean) as string[]);
    });
    return () => { cancel = true; };
  }, [feedTab, followed]);

  const { addrs: smartMoneyAddrs, loading: smartMoneyLoading } = useSmartMoneyAddresses();
  const rankedPosts = useRankedPosts({ limit: 50 });
  const followingPosts = usePosts({ following: feedTab === "Following" ? followingAddrs : undefined });
  const sbPosts = feedTab === "Following" ? followingPosts : (rankedPosts ?? followingPosts);

  useEffect(() => {
    try { localStorage.setItem(FOLLOW_KEY, JSON.stringify([...followed])); } catch {}
  }, [followed]);
  useEffect(() => {
    try { localStorage.setItem(ONLY_FOLLOWED_KEY, onlyFollowed ? "1" : "0"); } catch {}
  }, [onlyFollowed]);

  const toggleFollow = (handle: string) =>
    setFollowed((s) => {
      const n = new Set(s);
      if (n.has(handle)) n.delete(handle); else n.add(handle);
      return n;
    });

  const authorAddrs = (sbPosts ?? []).map((p) => p.author_address);
  const idMap = useIdentities(authorAddrs);

  const isFollowingOnly = feedTab === "Following" || onlyFollowed;
  const visible = (sbPosts ?? []).filter((p) => !deletedPostIds.has(p.id)).map((p, i) => {
    const authorId = idMap[p.author_address.toLowerCase()];
    const handleSlug = profileSlug(authorId) ?? "";
    const display = labelFor(authorId, { at: false });
    return {
      i,
      authorAddress: p.author_address,
      authorId,
      display,
      handleSlug,
      buy: p.is_trade ? p.trade_side === "BUY" : true,
      usd: p.trade_value_usd ?? 0,
      likes: p.likes,
      replies: 0,
      reposts: p.reposts,
      views: p.views,
      showQuote: !!p.quoted_token,
      bodyOverride: (editedBodies[p.id] ?? p.body) as string | undefined,
      postId: p.id as string,
      quotedToken: p.quoted_token as string | null,
      isTrade: !!p.is_trade,
      tradeSymbol: p.trade_token_symbol ?? "",
    };
  }).filter((p) => {
    if (isFollowingOnly) return !!(p.handleSlug && followed.has(p.handleSlug));
    if (feedTab === "Smart Money") {
      return smartMoneyAddrs.has(p.authorAddress.toLowerCase());
    }
    return true;
  });

  return (
    <>
      <PageHeader
        title="Feed"
        subtitle="Live timeline of trades, wallets and token chatter."
        actions={
          <button
            onClick={() => setSettingsOpen(true)}
            className="h-9 px-3 rounded-full bg-white/5 inline-flex items-center gap-1.5 text-xs font-semibold"
          >
            <Settings className="size-4" /> Notifications
          </button>
        }
      />

      {/* Mobile section switcher */}
      <div className="lg:hidden mb-3 flex gap-1 p-1 rounded-full bg-white/5 overflow-x-auto scrollbar-hide">
        {mobileTabs.map((t) => (
          <button
            key={t}
            onClick={() => setMTab(t)}
            className={`flex-1 min-w-fit px-4 h-8 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              mTab === t ? "lit-purple" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 lg:gap-6">
        {/* Main column */}
        <div className={`rounded-2xl bg-black/70 overflow-hidden ${mTab === "Feed" ? "" : "hidden"} lg:block`}>
          {/* Tabs */}
          <div className="border-b border-white/10 bg-background/80">
            <div className="flex overflow-x-auto scrollbar-hide">
              {tabs.map((t) => {
                const active = feedTab === t;
                return (
                  <button
                    key={t}
                    onClick={() => setFeedTab(t)}
                    className={`relative flex-1 min-w-[90px] px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                      active ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    }`}
                  >
                    {t}
                    {active && (
                      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full bg-primary" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {onlyFollowed && feedTab !== "Following" && (
            <div className="px-4 py-2 text-[11px] text-muted-foreground border-b border-white/10 inline-flex items-center gap-1.5">
              <Settings className="size-3" />
              Showing posts from people you follow only · <button onClick={() => setOnlyFollowed(false)} className="text-primary font-semibold hover:underline">turn off</button>
            </div>
          )}


          {/* Composer */}
          <Composer me={me} supabaseLive={SUPABASE_ENABLED} />

          {/* Pinned announcement (latest post from @trenchmem) */}
          <div className="px-4 pt-3">
            <PinnedAnnouncement />
          </div>

          {/* Feed */}
          <div>
            {visible.length === 0 && (
              <div className="px-4 py-16 text-center text-sm text-muted-foreground">
                {!SUPABASE_ENABLED
                  ? "Connect Supabase to load the live feed."
                  : feedTab === "Smart Money"
                    ? smartMoneyLoading
                      ? "Loading smart money feed…"
                      : smartMoneyAddrs.size === 0
                        ? "No labeled wallets yet — run the smart-money worker."
                        : "No posts from smart money wallets yet."
                    : isFollowingOnly
                      ? "No posts yet — follow traders to see their activity."
                      : "No posts yet — be the first to post."}
              </div>
            )}
            {visible.map((post) => {
              const { i, authorAddress, display, handleSlug, buy, showQuote, bodyOverride, quotedToken, isTrade, postId } = post;
              const isFollowed = handleSlug ? followed.has(handleSlug) : false;
              const isOwnPost = !!me && authorAddress.toLowerCase() === me.toLowerCase();
              return (
                <article
                  key={post.postId ?? `${authorAddress}-${i}`}
                  className="flex gap-3 px-4 py-3.5 border-b border-white/5 hover:bg-white/[0.02] transition-colors cursor-pointer"
                >
                  <UserAvatar address={authorAddress} size={44} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 text-sm min-w-0">
                      {handleSlug ? (
                        <Link
                          to="/profile/$username"
                          params={{ username: handleSlug }}
                          onClick={(e) => e.stopPropagation()}
                          className="font-semibold truncate hover:underline inline-flex items-baseline min-w-0"
                        >
                          <span className="truncate">{display}</span>
                          <VerifiedBadge address={authorAddress} />
                        </Link>
                      ) : (
                        <span className="font-semibold truncate inline-flex items-baseline min-w-0">
                          <span className="truncate">{display}</span>
                          <VerifiedBadge address={authorAddress} />
                        </span>
                      )}
                      {handleSlug && (
                        <Link
                          to="/profile/$username"
                          params={{ username: handleSlug }}
                          onClick={(e) => e.stopPropagation()}
                          className="text-muted-foreground truncate hover:underline"
                        >
                          @{handleSlug}
                        </Link>
                      )}
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{timeAgo(i)}</span>
                      {handleSlug && (
                        isOwnAccount(me, authorAddress, handleSlug, myHandle) ? (
                          <Link
                            {...profileRoute(handleSlug)}
                            search={{ edit: true }}
                            onClick={(e) => e.stopPropagation()}
                            className="ml-auto h-7 px-3 rounded-full text-[11px] font-semibold shrink-0 bg-white/5 inline-flex items-center"
                          >
                            Edit profile
                          </Link>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleFollow(handleSlug); }}
                            className={`ml-auto h-7 px-3 rounded-full text-[11px] font-semibold shrink-0 ${
                              isFollowed ? "bg-white/5 text-foreground" : "lit-purple"
                            }`}
                          >
                            {isFollowed ? "Following" : "Follow"}
                          </button>
                        )
                      )}
                      {isOwnPost && postId && me && bodyOverride && (
                        <PostMenu
                          postId={postId}
                          me={me}
                          body={bodyOverride}
                          onEdit={(next) => setEditedBodies((s) => ({ ...s, [postId]: next }))}
                          onDelete={() => setDeletedPostIds((s) => new Set([...s, postId]))}
                        />
                      )}
                    </div>

                    {isTrade && (
                      <div className="inline-flex items-center gap-1 mt-1 text-[10px] uppercase tracking-wide font-bold">
                        {buy ? (
                          <span className="inline-flex items-center gap-1 text-up">
                            <ArrowDownLeft className="size-3" /> Bought
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-down">
                            <ArrowUpRight className="size-3" /> Sold
                          </span>
                        )}
                      </div>
                    )}

                    <div className="text-[15px] leading-snug mt-0.5">
                      {bodyOverride ? (
                        <RichText text={bodyOverride} quotedToken={quotedToken} />
                      ) : (
                        <span className="text-muted-foreground text-sm">No content</span>
                      )}
                    </div>

                    {showQuote && quotedToken && (
                      <Link
                        to="/token/$id"
                        params={{ id: quotedToken }}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-2.5 block rounded-2xl glass-subtle p-3 hover:bg-white/[0.04] transition-colors text-sm font-semibold text-primary"
                      >
                        View ${post.tradeSymbol || "token"} →
                      </Link>
                    )}

                  </div>
                </article>
              );
            })}
          </div>
        </div>

        {/* Right rail */}
        <aside className={`space-y-4 lg:block ${mTab === "Feed" ? "hidden" : ""}`}>
          <div className="rounded-2xl bg-black/70 overflow-hidden hidden lg:block">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                placeholder="Search tokens, wallets"
                className="w-full bg-transparent pl-9 pr-3 h-11 text-sm focus:outline-none"
              />
            </div>
          </div>

          <TopGainersSidebar mobileVisible={mTab === "Top Gainers"} />
          <WhoToFollowSidebar mobileVisible={mTab === "Who to follow"} me={me} myHandle={myHandle} />
        </aside>
      </div>

      {settingsOpen && (
        <NotificationSettings
          onlyFollowed={onlyFollowed}
          setOnlyFollowed={setOnlyFollowed}
          followed={followed}
          onUnfollow={(h) => toggleFollow(h)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}

function Composer({ me, supabaseLive }: { me: string | undefined; supabaseLive: boolean }) {
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  // Remember exact picks from the autocomplete so $USDC → the specific USDC
  // address the user chose (not whichever Dirol re-searches).
  const tokenPicksRef = useRef<Map<string, string>>(new Map());

  const submit = async () => {
    if (!body.trim()) return;
    if (supabaseLive && me) {
      setPosting(true);
      try {
        // Find the first cashtag still in the body that the user actually
        // picked from the dropdown; pass its address as quoted_token.
        const m = /\$([A-Za-z][A-Za-z0-9]{0,15})/.exec(body);
        const explicit = m ? tokenPicksRef.current.get(m[1].toLowerCase()) : undefined;
        await sbCreatePost({
          data: {
            author_address: me,
            body: body.trim(),
            quoted_token: explicit ?? null,
          },
        });
        setBody("");
        tokenPicksRef.current.clear();
      } catch (e) {
        console.error(e);
        alert(e instanceof Error ? e.message : "Could not post right now");
      } finally {
        setPosting(false);
      }
    } else if (!me) {
      alert("Connect wallet to post.");
    } else {
      alert("Supabase is not configured for feed posts.");
    }
  };
  return (
    <div className="flex gap-3 p-4 border-b border-white/10">
      {me ? <UserAvatar address={me} size={44} /> : <Avatar seed="?" color="#22D3EE" />}
      <div className="flex-1">
        <MentionAutocomplete
          value={body}
          onChange={setBody}
          onPickToken={(t) => { tokenPicksRef.current.set(t.symbol.toLowerCase(), t.address); }}
        >
          {(p) => (
            <textarea
              {...p}
              rows={2}
              maxLength={200}
              onKeyDown={(e) => {
                p.onKeyDown(e);
                if (e.key === "Enter" && !e.shiftKey && !e.defaultPrevented) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={me ? "What's happening onchain? Type $ for tokens, @ for traders…" : "Connect wallet to post"}
              disabled={!me || posting}
              className="w-full bg-transparent text-base placeholder:text-muted-foreground/70 focus:outline-none py-2 disabled:opacity-50 resize-none"
            />
          )}
        </MentionAutocomplete>
        <div className="flex items-center justify-end mt-2">
          <button
            onClick={submit}
            disabled={!body.trim() || body.length > 200 || posting || !me}
            className="h-8 px-4 rounded-full lit-purple text-sm font-semibold disabled:opacity-40"
          >
            {posting ? "Posting…" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NotificationSettings({
  onlyFollowed, setOnlyFollowed, followed, onUnfollow, onClose,
}: {
  onlyFollowed: boolean;
  setOnlyFollowed: (v: boolean) => void;
  followed: Set<string>;
  onUnfollow: (handle: string) => void;
  onClose: () => void;
}) {
  return (
    <ModalShell onClose={onClose} className="sm:max-w-md">
        <div className="px-4 py-4 flex items-center gap-3 border-b border-white/10">
          <h2 className="flex-1 font-bold">Timeline notifications</h2>
          <button onClick={onClose} className="h-8 px-3 rounded-full bg-white/5 text-xs font-semibold">Done</button>
        </div>
        <div className="px-4 py-4 space-y-4">
          <button
            onClick={() => setOnlyFollowed(!onlyFollowed)}
            className="w-full flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-left"
          >
            <div className="min-w-0 pr-3">
              <p className="text-sm font-semibold">Only people I follow</p>
              <p className="text-[11px] text-muted-foreground">
                When on, your timeline only shows posts and trade events from accounts you follow.
              </p>
            </div>
            <span className={`relative h-6 w-10 rounded-full shrink-0 transition-colors ${onlyFollowed ? "bg-primary" : "bg-white/15"}`}>
              <span className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${onlyFollowed ? "left-[18px]" : "left-0.5"}`} />
            </span>
          </button>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              You follow ({followed.size})
            </p>
            {followed.size === 0 ? (
              <p className="text-xs text-muted-foreground py-3">Not following anyone yet.</p>
            ) : (
              <ul className="space-y-1 max-h-60 overflow-y-auto scrollbar-hide">
                {[...followed].map((h) => (
                  <li key={h} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5">
                    <span className="text-sm flex-1 truncate">@{h}</span>
                    <button
                      onClick={() => onUnfollow(h)}
                      className="h-7 px-3 rounded-full bg-white/5 text-[11px] font-semibold hover:bg-white/10"
                    >
                      Unfollow
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
    </ModalShell>
  );
}

function TopGainerSkeleton() {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 animate-pulse">
      <div className="size-9 rounded-full bg-white/[0.08] shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-2.5 w-16 rounded bg-white/[0.06]" />
        <div className="h-3.5 w-24 rounded bg-white/[0.08]" />
        <div className="h-2 w-32 rounded bg-white/[0.05]" />
      </div>
      <div className="h-4 w-10 rounded-full bg-white/[0.08] shrink-0" />
    </li>
  );
}

function TopGainersSidebar({ mobileVisible }: { mobileVisible: boolean }) {
  const { topGainers, loading } = useDiscoveryFeed();
  return (
    <div className={`rounded-2xl bg-black/70 overflow-hidden lg:block ${mobileVisible ? "" : "hidden"}`}>
      <div className="px-4 py-3 border-b border-white/10">
        <h3 className="font-semibold">Top gainers</h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">24h price change · live API</p>
      </div>
      <ul>
        {loading && Array.from({ length: 5 }).map((_, i) => <TopGainerSkeleton key={`g-sk-${i}`} />)}
        {!loading && topGainers.length === 0 && (
          <li className="px-4 py-6 text-xs text-muted-foreground text-center">No gainers in the last 24h.</li>
        )}
        {topGainers.map((t, i) => (
          <li key={t.address}>
            <Link
              to="/token/$id"
              params={{ id: t.address }}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04]"
            >
              {t.imageUri ? (
                <img src={t.imageUri} alt="" className="size-9 rounded-full object-cover shrink-0" />
              ) : (
                <div className="size-9 rounded-full bg-primary/20 grid place-items-center text-[10px] font-bold shrink-0">
                  {t.symbol.slice(0, 3)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-muted-foreground">#{i + 1} · 24h</div>
                <div className="font-semibold text-sm">${t.symbol}</div>
                <div className="text-[11px] text-muted-foreground truncate">{t.name}</div>
              </div>
              <span className="text-xs font-bold text-up shrink-0 inline-flex items-center gap-0.5">
                <TrendingUp className="size-3" />
                {fmtPct(t.priceChange24h ?? 0)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WhoToFollowSidebar({
  mobileVisible, me, myHandle,
}: { mobileVisible: boolean; me: string | undefined; myHandle?: string | null }) {
  const traders = useSuggestedTraders(6);
  return (
    <div className={`rounded-2xl bg-black/70 overflow-hidden lg:block ${mobileVisible ? "" : "hidden"}`}>
      <div className="px-4 py-3 border-b border-white/10">
        <h3 className="font-semibold">Who to follow</h3>
      </div>
      <ul>
        {traders.length === 0 && (
          <li className="px-4 py-6 text-xs text-muted-foreground text-center">Run smart-money worker.</li>
        )}
        {traders.map((t) => (
          <WhoToFollowRow key={t.address} trader={t} me={me} myHandle={myHandle} />
        ))}
      </ul>
    </div>
  );
}

function WhoToFollowRow({
  trader, me, myHandle,
}: {
  trader: ReturnType<typeof useSuggestedTraders>[number];
  me: string | undefined;
  myHandle?: string | null;
}) {
  const id = useIdentity(trader.address);
  const label = labelFor(id, { at: false });
  const slug = id?.handle ?? trader.handle;
  if (!slug) return null;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <UserAvatar address={trader.address} size={40} />
      <Link {...profileRoute(slug)} className="flex-1 min-w-0">
        <div className="text-sm font-semibold inline-flex items-baseline min-w-0 truncate hover:underline">
          <span className="truncate">{label}</span>
          <VerifiedBadge address={trader.address} />
        </div>
        <div className="text-[11px] text-muted-foreground truncate">@{slug}</div>
      </Link>
      <ProfileActionButton
        targetAddress={trader.address}
        targetHandle={slug}
        me={me}
        myHandle={myHandle}
        variant="compact"
        className="!h-8 !px-4 !text-xs"
      />
    </li>
  );
}
