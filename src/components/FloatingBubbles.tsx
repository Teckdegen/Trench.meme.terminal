// Floating chat + notification bubbles — Messenger-style.
// Mounted globally in __root.tsx so they appear on every screen except the
// dedicated full pages (Inbox, Rooms, Alerts) which already show this data.
//
// Three bubbles stack vertically in the bottom-right:
//   1. DMs        — unread count, opens thread picker → mini chat
//   2. Cabals     — unread count, opens cabal picker → mini chat
//   3. Alerts     — unread notification count, opens list
//
// All panels are "small" (320×440), positioned above the bubble cluster.
// Bubbles auto-hide on the routes that already render this content full-page.

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  MessageSquare, Users, Bell, X, ArrowLeft, Send, ExternalLink,
} from "lucide-react";
import { useMe } from "@/lib/useMe";
import {
  useDMThreads, useDMMessages, sendDM, GUN_ENABLED as DM_GUN,
} from "@/lib/gun-dms";
import {
  useMyCabals, useCabalChat, sendCabalChat, GUN_ENABLED as CABAL_GUN,
} from "@/lib/cabal";
import { useNotifications, markNotificationRead } from "@/lib/supabase-hooks";
import { HandleLink } from "@/components/Handle";

type Pane = null | "dm" | "cabal" | "notif";
type DmOpen = { partner: string } | null;
type CabalOpen = { id: string; name: string } | null;

const HIDE_ON = ["/inbox", "/cabals", "/alerts"];

export function FloatingBubbles() {
  const me = useMe();
  const [pane, setPane] = useState<Pane>(null);
  const [dmOpen, setDmOpen] = useState<DmOpen>(null);
  const [cabalOpen, setCabalOpen] = useState<CabalOpen>(null);
  const [pathname, setPathname] = useState(() =>
    typeof window === "undefined" ? "/" : window.location.pathname,
  );

  // Track route so we can hide on the full-page versions
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", update);
    const id = setInterval(update, 600); // light fallback for client nav
    return () => { window.removeEventListener("popstate", update); clearInterval(id); };
  }, []);

  // Data sources (only run when signed in)
  const threads = useDMThreads(me);
  const cabals = useMyCabals(me);
  const notifs = useNotifications(me);

  // Unread counts (very simple: rely on per-source unread fields)
  const dmUnread = useMemo(
    () => threads.reduce((n, t) => n + (t.unread ?? 0), 0),
    [threads],
  );
  // For cabals we don't track per-cabal unread yet — use last activity in the
  // last 60s as a "live activity" indicator so the bubble pulses
  const cabalActive = useMemo(
    () => cabals.some((c) => Date.now() - (c.created_at ?? 0) < 60_000),
    [cabals],
  );
  const notifUnread = useMemo(
    () => (notifs ?? []).filter((n) => !n.read).length,
    [notifs],
  );

  // Don't render at all when logged out OR on the dedicated routes
  if (!me) return null;
  if (HIDE_ON.some((p) => pathname.startsWith(p))) return null;

  const close = () => { setPane(null); setDmOpen(null); setCabalOpen(null); };

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {/* Open panel */}
      {pane && (
        <div
          className="w-[320px] sm:w-[360px] h-[440px] rounded-2xl bg-background border border-white/10 overflow-hidden flex flex-col"
          style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.7)" }}
        >
          {pane === "dm" && (
            dmOpen ? (
              <DmThreadPanel
                me={me}
                partner={dmOpen.partner}
                onBack={() => setDmOpen(null)}
                onClose={close}
              />
            ) : (
              <DmListPanel
                threads={threads}
                onOpen={(p) => setDmOpen({ partner: p })}
                onClose={close}
              />
            )
          )}
          {pane === "cabal" && (
            cabalOpen ? (
              <CabalThreadPanel
                me={me}
                cabalId={cabalOpen.id}
                cabalName={cabalOpen.name}
                onBack={() => setCabalOpen(null)}
                onClose={close}
              />
            ) : (
              <CabalListPanel
                cabals={cabals}
                onOpen={(id, name) => setCabalOpen({ id, name })}
                onClose={close}
              />
            )
          )}
          {pane === "notif" && (
            <NotifPanel notifs={notifs ?? []} onClose={close} me={me} />
          )}
        </div>
      )}

      {/* Bubble cluster. Clicking a bubble ALWAYS lands on the list view
          (resets dmOpen/cabalOpen) so the user can always pick which
          thread/cabal to open — never auto-jumps to the last one. */}
      <div className="flex flex-col gap-2">
        <Bubble
          icon={<MessageSquare className="size-5" />}
          label="DMs"
          active={pane === "dm"}
          badge={dmUnread > 0 ? dmUnread : null}
          disabled={!DM_GUN}
          onClick={() => {
            setDmOpen(null);
            setPane(pane === "dm" ? null : "dm");
          }}
        />
        <Bubble
          icon={<Users className="size-5" />}
          label="Cabals"
          active={pane === "cabal"}
          badge={null}
          pulse={cabalActive}
          disabled={!CABAL_GUN}
          onClick={() => {
            setCabalOpen(null);
            setPane(pane === "cabal" ? null : "cabal");
          }}
        />
        <Bubble
          icon={<Bell className="size-5" />}
          label="Notifications"
          active={pane === "notif"}
          badge={notifUnread > 0 ? notifUnread : null}
          onClick={() => setPane(pane === "notif" ? null : "notif")}
        />
      </div>
    </div>
  );
}

function Bubble({
  icon, label, active, badge, pulse, disabled, onClick,
}: {
  icon: React.ReactNode; label: string;
  active?: boolean; badge?: number | null; pulse?: boolean;
  disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`relative size-12 rounded-full grid place-items-center transition-colors disabled:opacity-40 ${
        active ? "bg-primary text-primary-foreground"
              : "bg-background border border-white/15 hover:bg-white/5"
      }`}
      style={{ boxShadow: active ? "0 10px 30px rgba(168,85,247,0.4)" : "0 8px 24px rgba(0,0,0,0.4)" }}
    >
      {icon}
      {badge != null && (
        <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-down text-white text-[10px] font-bold grid place-items-center">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {pulse && badge == null && (
        <span className="absolute -top-1 -right-1 size-3 rounded-full bg-up animate-pulse" />
      )}
    </button>
  );
}

// ─────────────── DM list ─────────────────────────────────────────────
function DmListPanel({
  threads, onOpen, onClose,
}: { threads: ReturnType<typeof useDMThreads>; onOpen: (partner: string) => void; onClose: () => void }) {
  return (
    <>
      <PanelHeader title="Messages" onClose={onClose} link="/inbox" linkLabel="Open inbox" />
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <EmptyState label="No conversations yet." />
        ) : (
          <ul className="divide-y divide-white/5">
            {threads.map((t) => (
              <li key={t.channelId}>
                <button
                  onClick={() => onOpen(t.partner)}
                  className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/5 text-left"
                >
                  <Avatar addr={t.partner} />
                  <div className="flex-1 min-w-0">
                    <HandleLink address={t.partner} className="text-xs font-semibold hover:underline" at />
                    <p className="text-[11px] text-muted-foreground truncate">{t.lastBody || "—"}</p>
                  </div>
                  {t.unread > 0 && (
                    <span className="size-5 rounded-full bg-down text-white text-[10px] font-bold grid place-items-center">
                      {t.unread}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function DmThreadPanel({
  me, partner, onBack, onClose,
}: { me: string; partner: string; onBack: () => void; onClose: () => void }) {
  const messages = useDMMessages(me, partner);
  const [draft, setDraft] = useState("");
  const send = async () => {
    if (!draft.trim()) return;
    await sendDM(me, partner, draft.trim());
    setDraft("");
  };
  return (
    <>
      <PanelHeader
        title={shortAddr(partner)}
        onClose={onClose}
        onBack={onBack}
        link={`/inbox?t=${partner.toLowerCase()}`}
        linkLabel="Open"
      />
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 scrollbar-hide">
        {messages.length === 0 ? (
          <EmptyState label="Say gm." />
        ) : (
          messages.slice(-50).map((m) => {
            const mine = m.sender.toLowerCase() === me.toLowerCase();
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] px-2.5 py-1.5 rounded-xl text-sm ${
                  mine ? "lit-purple rounded-br-md" : "bg-white/5 rounded-bl-md"
                }`}>
                  {m.body}
                </div>
              </div>
            );
          })
        )}
      </div>
      <Composer draft={draft} setDraft={setDraft} send={send} />
    </>
  );
}

// ─────────────── Cabal list ──────────────────────────────────────────
function CabalListPanel({
  cabals, onOpen, onClose,
}: { cabals: ReturnType<typeof useMyCabals>; onOpen: (id: string, name: string) => void; onClose: () => void }) {
  return (
    <>
      <PanelHeader title="Cabals" onClose={onClose} link="/cabals" linkLabel="Open cabals" />
      <div className="flex-1 overflow-y-auto">
        {cabals.length === 0 ? (
          <EmptyState label="No cabals yet." />
        ) : (
          <ul className="divide-y divide-white/5">
            {cabals.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => onOpen(c.id, c.name)}
                  className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/5 text-left"
                >
                  <div className="size-9 rounded-full bg-primary/15 text-primary grid place-items-center text-[10px] font-bold uppercase">
                    {c.name.slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{c.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{c.topic ?? "—"}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function CabalThreadPanel({
  me, cabalId, cabalName, onBack, onClose,
}: {
  me: string; cabalId: string; cabalName: string;
  onBack: () => void; onClose: () => void;
}) {
  const messages = useCabalChat(cabalId, me);
  const [draft, setDraft] = useState("");
  const send = async () => {
    if (!draft.trim()) return;
    await sendCabalChat(cabalId, me, draft.trim());
    setDraft("");
  };
  return (
    <>
      <PanelHeader
        title={cabalName}
        onClose={onClose}
        onBack={onBack}
        link="/cabals"
        linkLabel="Open"
      />
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 scrollbar-hide">
        {messages.length === 0 ? (
          <EmptyState label="No messages yet." />
        ) : (
          messages.slice(-50).map((m: any) => {
            const mine = m.sender_address?.toLowerCase() === me.toLowerCase();
            if (m.kind === "trade") {
              return (
                <div key={m.id} className="text-[11px] px-2 py-1 rounded bg-up/5 border border-up/20 text-up">
                  {m.body}
                </div>
              );
            }
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : ""}`}>
                <div className={`max-w-[80%] px-2.5 py-1.5 rounded-xl text-sm ${
                  mine ? "lit-purple rounded-br-md" : "bg-white/5 rounded-bl-md"
                }`}>
                  {!mine && (
                    <p className="text-[9px] text-muted-foreground mb-0.5">
                      {shortAddr(m.sender_address)}
                    </p>
                  )}
                  {m.body}
                </div>
              </div>
            );
          })
        )}
      </div>
      <Composer draft={draft} setDraft={setDraft} send={send} />
    </>
  );
}

// ─────────────── Notifications ───────────────────────────────────────
function NotifPanel({
  notifs, onClose, me,
}: { notifs: any[]; onClose: () => void; me?: string }) {
  return (
    <>
      <PanelHeader title="Notifications" onClose={onClose} link="/alerts" linkLabel="Open all" />
      <div className="flex-1 overflow-y-auto">
        {notifs.length === 0 ? (
          <EmptyState label="No notifications." />
        ) : (
          <ul className="divide-y divide-white/5">
            {notifs.slice(0, 30).map((n) => {
              const body = (
                <div className={`px-3 py-2.5 flex items-start gap-2 hover:bg-white/5 ${
                  !n.read ? "bg-primary/[0.03]" : ""
                }`}>
                  {!n.read && <span className="size-1.5 rounded-full bg-primary mt-1.5 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{n.title}</p>
                    {n.body && <p className="text-[11px] text-muted-foreground line-clamp-2">{n.body}</p>}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {timeAgo(n.created_at)}
                    </p>
                  </div>
                </div>
              );
              return (
                <li key={n.id} onClick={() => !n.read && markNotificationRead(n.id, me)}>
                  {n.link ? (
                    <Link to={n.link as any} className="block">{body}</Link>
                  ) : body}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

// ─────────────── Shared bits ─────────────────────────────────────────
function PanelHeader({
  title, onClose, onBack, link, linkLabel,
}: { title: string; onClose: () => void; onBack?: () => void; link?: string; linkLabel?: string }) {
  return (
    <div className="px-3 py-2.5 border-b border-white/10 flex items-center gap-2 shrink-0">
      {onBack && (
        <button onClick={onBack} className="size-7 grid place-items-center rounded-full bg-white/5">
          <ArrowLeft className="size-3.5" />
        </button>
      )}
      <h3 className="font-bold text-sm flex-1 truncate">{title}</h3>
      {link && (
        <Link
          to={link as any}
          onClick={onClose}
          className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
        >
          {linkLabel} <ExternalLink className="size-3" />
        </Link>
      )}
      <button onClick={onClose} className="size-7 grid place-items-center rounded-full bg-white/5">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function Composer({
  draft, setDraft, send,
}: { draft: string; setDraft: (s: string) => void; send: () => void }) {
  return (
    <div className="px-2 py-2 border-t border-white/10 flex items-center gap-1.5 shrink-0">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
        placeholder="Type a message…"
        className="flex-1 h-9 rounded-full bg-white/5 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
      />
      <button
        onClick={send}
        disabled={!draft.trim()}
        className="size-9 grid place-items-center rounded-full lit-purple disabled:opacity-40"
      >
        <Send className="size-4" />
      </button>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="h-full grid place-items-center px-6 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Avatar({ addr }: { addr: string }) {
  return (
    <div className="size-9 rounded-full bg-primary/15 text-primary grid place-items-center text-[10px] font-bold uppercase shrink-0">
      {addr.slice(2, 4)}
    </div>
  );
}

function shortAddr(a: string) {
  if (!a) return "?";
  return a.length > 8 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

function timeAgo(iso: string) {
  const s = Math.max(1, Math.floor((Date.now() - +new Date(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
