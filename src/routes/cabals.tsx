// Cabals — inbox-style 2-column layout.
//
//   [Cabals list (320px)] | [Active cabal pane (flex-1)]
//
// Matches the visual language of /inbox: rounded-3xl panels, white/5
// borders, lit-purple accents, no Discord-style server rail. Each cabal
// row in the left column shows avatar + name + topic + active marker.
// The right pane shows the cabal header (with an Edit Group button when
// you're the owner), a row of room tabs (general / watchlist / voice
// rooms / +), and the chat/voice body underneath.
//
// All hooks (useMyCabals, useCabalChat, useCabalRooms, etc.) and inner
// renderers (DiscordChat, VoicePane, WatchlistPane, MembersRail) are
// reused unchanged — only the shell got rebuilt.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  GUN_ENABLED,
  useMyCabals,
  createCabal,
  joinCabalByCode,
  joinCabal,
  leaveCabal,
  deleteCabal,
  updateCabalMeta,
  useCabalMembers,
  useCabalChat,
  sendCabalChat,
  deleteCabalMessage,
  editCabalMessage,
  useCabalWatchlist,
  addWatchlist,
  removeWatchlist,
  toggleCabalReaction,
  useCabalReactions,
  setCabalTyping,
  useCabalTyping,
  usePendingInvites,
  retryPendingInvites,
  inviteAddressToCabal,
  kickMemberFromCabal,
  rotateCabalKey,
  distributeCabalKey,
  type CabalMeta,
} from "@/lib/cabal";
import { resolveToAddress } from "@/lib/identity";
import { HandleLink, UserAvatar } from "@/components/Handle";
import { useMe } from "@/lib/useMe";
import { RoomVoice } from "@/components/RoomVoice";
import {
  Plus, Lock, Globe, Hash, Volume2, X, UserPlus, KeyRound, Check, Crown,
  Search, MessageSquare, Camera, MoreHorizontal, Phone, ChevronDown,
  Eye, RefreshCw, UserMinus, ShieldCheck, ShieldAlert, SmilePlus, Reply,
  CornerUpLeft, Clock as ClockIcon, Users, Pencil, Trash2, ArrowLeft,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { ModalShell } from "@/components/ui/modal-shell";
import { txUrl } from "@/lib/explorer";

export const Route = createFileRoute("/cabals")({ component: CabalsPage });

// ============================================================================
// ROOT
// ============================================================================
function CabalsPage() {
  const me = useMe();
  const _isMobile = useIsMobile();
  // Title updates when the active cabal changes so the browser tab shows
  // which group you're in — same pattern as Inbox.
  // (Computed below once we know `active`.)
  void _isMobile; // kept for parity with old API — list/pane handle mobile via CSS now
  const cabals = useMyCabals(me);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [showMembers, setShowMembers] = useState(false);

  // Auto-pick first cabal on desktop; mobile users land on the list first.
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches) return;
    if (!activeId && cabals.length > 0) setActiveId(cabals[0].id);
  }, [cabals, activeId]);

  useEffect(() => {
    setShowMembers(false);
  }, [activeId]);

  const active = useMemo(
    () => cabals.find((c) => c.id === activeId) ?? null,
    [cabals, activeId],
  );
  useDocumentTitle(active ? active.name : "Cabals");

  const onCreate = async (
    name: string, topic: string, image: string, invited: string[],
  ) => {
    if (!GUN_ENABLED || !me) { setJoinError("Gun relay not configured"); return; }
    try {
      const resolved: string[] = [];
      for (const h of invited) {
        const a = await resolveToAddress(h);
        if (a) resolved.push(a);
      }
      const row = await createCabal({ name, topic, image_uri: image, host_address: me, privacy: "invite", invitees: resolved });
      if (row) { setActiveId(row.id); setCreating(false); }
      else setJoinError("Could not create cabal. Check the Gun relay connection.");
    } catch (e) { console.error(e); setJoinError("Could not create cabal"); }
  };

  const onJoinByCode = async (code: string) => {
    if (!GUN_ENABLED || !me) { setJoinError("Sign in first"); return; }
    try {
      const row = await joinCabalByCode(code, me);
      if (row) { setActiveId(row.id); setJoining(false); setJoinError(null); }
      else setJoinError("Invite code not found");
    } catch (e) {
      console.error(e);
      setJoinError(e instanceof Error ? e.message : "Could not join");
    }
  };

  const onLeave = async () => {
    if (!me || !active) return;
    const isOwner = me.toLowerCase() === active.host_address.toLowerCase();
    if (isOwner) {
      const disband = confirm(
        `Delete "${active.name}" for everyone?\n\nOK = delete cabal · Cancel = leave only`,
      );
      if (disband) {
        try { await deleteCabal(active.id, me, active); }
        catch (e: any) {
          console.error(e);
          alert(`Couldn't delete cabal: ${e?.message ?? e}`);
          return;
        }
      } else {
        await leaveCabal(active.id, me).catch(() => {});
      }
    } else {
      if (!confirm(`Leave "${active.name}"?`)) return;
      await leaveCabal(active.id, me).catch(() => {});
    }
    setActiveId(null);
  };

  return (
    <>
      {!GUN_ENABLED && (
        <p className="text-sm text-amber-400/90 mb-3 px-1">
          Set <code className="text-xs">VITE_GUN_PEERS</code> to your bot relay URL to enable cabals.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-3 h-[calc(100vh-220px)] min-h-[460px]">
        {/* ── Cabals list (left) — inbox-style shell ─────────────────── */}
        <aside
          className={`rounded-3xl bg-surface border border-white/5 overflow-hidden flex flex-col ${active ? "hidden md:flex" : "flex"}`}
        >
          <CabalsListHeader
            onNew={() => setCreating(true)}
            onJoin={() => { setJoinError(null); setJoining(true); }}
            disabled={!me || !GUN_ENABLED}
          />
          <CabalsList
            cabals={cabals}
            activeId={activeId}
            onSelect={(id) => setActiveId(id)}
            me={me}
          />
        </aside>

        {/* ── Active cabal pane (right) ─────────────────────────────── */}
        <section
          className={`relative rounded-3xl bg-surface border border-white/5 overflow-hidden flex flex-col ${active ? "flex" : "hidden md:flex"}`}
        >
          {!active ? (
            <EmptyCabalPane onNew={() => setCreating(true)} onJoin={() => setJoining(true)} />
          ) : (
            <CabalPane
              me={me}
              cabal={active}
              onBack={() => setActiveId(null)}
              onEdit={() => setEditing(true)}
              onLeave={onLeave}
              toggleMembers={() => setShowMembers((v) => !v)}
            />
          )}
        </section>
      </div>

      {/* Members drawer — slides in from the right on any screen */}
      {active && showMembers && (
        <>
          <button
            type="button"
            aria-label="Close members"
            className="fixed inset-0 z-40 bg-black/60"
            onClick={() => setShowMembers(false)}
          />
          <div className="fixed top-0 bottom-0 right-0 z-50 w-[min(90vw,18rem)] shadow-2xl animate-in slide-in-from-right duration-200">
            <MembersRail cabal={active} me={me} onClose={() => setShowMembers(false)} mobile />
          </div>
        </>
      )}

      {creating && <CreateCabalModal onClose={() => setCreating(false)} onCreate={onCreate} />}
      {joining && <JoinCodeModal error={joinError} onClose={() => setJoining(false)} onJoin={onJoinByCode} />}
      {editing && active && me && (
        <EditCabalModal
          cabal={active}
          me={me}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

// ============================================================================
// CABALS LIST (left column) — inbox-style row list with search
// ============================================================================
function CabalsListHeader({
  onNew, onJoin, disabled,
}: { onNew: () => void; onJoin: () => void; disabled?: boolean }) {
  return (
    <div className="px-3 py-3 border-b border-white/5 flex items-center justify-between gap-2 shrink-0">
      <h2 className="text-sm font-bold tracking-tight px-1">Cabals</h2>
      <div className="inline-flex items-center gap-1">
        <button
          onClick={onJoin}
          disabled={disabled}
          className="h-8 px-3 rounded-full bg-white/5 hover:bg-white/10 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-40"
          title="Join with code"
        >
          <KeyRound className="size-3.5" /> Join
        </button>
        <button
          onClick={onNew}
          disabled={disabled}
          className="h-8 px-3 rounded-full lit-purple text-xs font-bold inline-flex items-center gap-1 disabled:opacity-40"
        >
          <Plus className="size-3.5" /> New
        </button>
      </div>
    </div>
  );
}

function CabalsList({
  cabals, activeId, onSelect, me,
}: {
  cabals: CabalMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  me: string | undefined;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cabals;
    return cabals.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      (c.topic ?? "").toLowerCase().includes(q),
    );
  }, [cabals, query]);

  return (
    <>
      <div className="px-3 py-2.5 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2 h-10 px-3 rounded-full bg-white/5 focus-within:ring-1 focus-within:ring-primary/40">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cabals"
            className="flex-1 bg-transparent text-sm focus:outline-none"
          />
        </div>
      </div>
      <ul className="flex-1 overflow-y-auto scrollbar-hide">
        {filtered.length === 0 && (
          <li className="px-4 py-16 text-center">
            <div className="size-12 rounded-full bg-white/5 grid place-items-center mx-auto">
              <MessageSquare className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold mt-3">
              {cabals.length === 0 ? "No cabals yet" : "No matches"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {cabals.length === 0 ? "Tap New to start one." : "Try a different search."}
            </p>
          </li>
        )}
        {filtered.map((c) => (
          <CabalListRow
            key={c.id}
            cabal={c}
            active={c.id === activeId}
            isOwner={!!me && me.toLowerCase() === c.host_address.toLowerCase()}
            onClick={() => onSelect(c.id)}
          />
        ))}
      </ul>
    </>
  );
}

function CabalListRow({
  cabal, active, isOwner, onClick,
}: { cabal: CabalMeta; active: boolean; isOwner: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`relative w-full text-left flex items-center gap-3 px-3 py-3 transition-colors ${
          active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
        }`}
      >
        {active && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" />}
        <CabalAvatar cabal={cabal} size={40} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {cabal.privacy === "invite"
              ? <Lock className="size-3 text-muted-foreground shrink-0" />
              : <Globe className="size-3 text-muted-foreground shrink-0" />}
            <span className="text-sm font-semibold truncate">{cabal.name}</span>
            {isOwner && <Crown className="size-3 text-primary shrink-0" />}
          </div>
          <span className="text-[12px] text-muted-foreground truncate block">
            {cabal.topic || "No topic"}
          </span>
        </div>
      </button>
    </li>
  );
}

function CabalAvatar({ cabal, size }: { cabal: CabalMeta; size: number }) {
  const px = `${size}px`;
  if (cabal.image_uri) {
    return (
      <img
        src={cabal.image_uri}
        alt={cabal.name}
        style={{ width: px, height: px }}
        className="rounded-2xl object-cover shrink-0"
      />
    );
  }
  return (
    <div
      style={{ width: px, height: px, fontSize: Math.round(size * 0.34) }}
      className="rounded-2xl bg-primary/20 text-primary grid place-items-center font-bold shrink-0"
    >
      {initials(cabal.name)}
    </div>
  );
}

function EmptyCabalPane({ onNew, onJoin }: { onNew: () => void; onJoin: () => void }) {
  return (
    <div className="flex-1 grid place-items-center text-center px-6">
      <div>
        <div className="size-16 rounded-full bg-white/5 grid place-items-center mx-auto">
          <MessageSquare className="size-7 text-muted-foreground" />
        </div>
        <p className="text-base font-semibold mt-4">Your cabals</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-[260px] mx-auto">
          Pick a cabal from the left, or start a new one — invite friends, share trades, hop in voice.
        </p>
        <div className="inline-flex items-center gap-2 mt-5">
          <button
            onClick={onJoin}
            className="h-9 px-4 rounded-full bg-white/5 hover:bg-white/10 text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <KeyRound className="size-4" /> Join with code
          </button>
          <button
            onClick={onNew}
            className="h-9 px-4 rounded-full lit-purple text-sm font-bold inline-flex items-center gap-1.5"
          >
            <Plus className="size-4" /> New cabal
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// CABAL PANE (right column) — header + room tabs + body
// ============================================================================
function CabalPane({
  me, cabal, onBack, onEdit, onLeave, toggleMembers,
}: {
  me: string | undefined;
  cabal: CabalMeta;
  onBack: () => void;
  onEdit: () => void;
  onLeave: () => void;
  toggleMembers: () => void;
}) {
  const members = useCabalMembers(cabal.id);
  const isOwner = !!me && me.toLowerCase() === cabal.host_address.toLowerCase();
  const [moreOpen, setMoreOpen] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [showWatch, setShowWatch] = useState(false);

  return (
    <>
      {/* Header — inbox style: back + avatar + name + members + more */}
      <div className="px-3 py-3 border-b border-white/5 flex items-center gap-3 shrink-0">
        <button
          onClick={onBack}
          className="md:hidden size-8 grid place-items-center rounded-full hover:bg-white/10"
          aria-label="Back"
        >
          <ArrowLeft className="size-4" />
        </button>
        {/* Avatar + name — tap opens group info (Telegram-style) */}
        <button onClick={toggleMembers} className="flex items-center gap-3 min-w-0 flex-1 text-left group" title="Group info">
          <CabalAvatar cabal={cabal} size={36} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate inline-flex items-center gap-1.5">
              {cabal.privacy === "invite"
                ? <Lock className="size-3 text-muted-foreground" />
                : <Globe className="size-3 text-muted-foreground" />}
              <span className="truncate group-hover:underline">{cabal.name}</span>
              {isOwner && <Crown className="size-3 text-primary" />}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              {cabal.topic || `${members.length} ${members.length === 1 ? "member" : "members"}`}
            </div>
          </div>
        </button>

        {/* Call — one voice call per cabal (no rooms) */}
        <button
          onClick={() => setInCall(true)}
          className="size-9 grid place-items-center rounded-full bg-up/15 text-up hover:bg-up/25"
          title="Start / join call"
        >
          <Phone className="size-4" />
        </button>

        {/* Watchlist */}
        <button
          onClick={() => setShowWatch(true)}
          className="size-9 grid place-items-center rounded-full hover:bg-white/10 text-muted-foreground hover:text-foreground"
          title="Watchlist"
        >
          <Eye className="size-4" />
        </button>

        {/* More */}
        <div className="relative">
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className="size-9 grid place-items-center rounded-full hover:bg-white/10 text-muted-foreground hover:text-foreground"
            title="More"
          >
            <MoreHorizontal className="size-4" />
          </button>
          {moreOpen && (
            <>
              <button type="button" className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} aria-label="Close menu" />
              <div className="absolute top-10 right-0 z-50 w-48 rounded-xl bg-background border border-white/10 shadow-xl py-1 text-sm">
                <button onClick={() => { setMoreOpen(false); toggleMembers(); }} className="w-full px-3 py-2 text-left hover:bg-white/5 inline-flex items-center gap-2">
                  <Users className="size-3.5" /> Group info
                </button>
                {isOwner && (
                  <button onClick={() => { setMoreOpen(false); onEdit(); }} className="w-full px-3 py-2 text-left hover:bg-white/5 inline-flex items-center gap-2">
                    <Pencil className="size-3.5" /> Edit group info
                  </button>
                )}
                <button onClick={() => { navigator.clipboard?.writeText(cabal.invite_code); setMoreOpen(false); }} className="w-full px-3 py-2 text-left hover:bg-white/5 inline-flex items-center gap-2">
                  <KeyRound className="size-3.5" /> Copy invite code
                </button>
                <button onClick={() => { setMoreOpen(false); onLeave(); }} className="w-full px-3 py-2 text-left hover:bg-down/15 text-down inline-flex items-center gap-2">
                  <Trash2 className="size-3.5" /> {isOwner ? "Delete cabal" : "Leave cabal"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Body — plain group chat (no rooms, no channel tabs) */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <DiscordChat cabal={cabal} me={me} />
      </div>

      {/* Voice call overlay — single call per cabal, TG-style screen */}
      {inCall && (
        <div className="absolute inset-0 z-30 flex flex-col" style={{ background: "#0a0612" }}>
          <div className="px-3 py-3 border-b border-white/5 flex items-center gap-3 shrink-0">
            <button onClick={() => setInCall(false)} className="size-8 grid place-items-center rounded-full hover:bg-white/10" aria-label="Back to chat">
              <ChevronDown className="size-4" />
            </button>
            <CabalAvatar cabal={cabal} size={28} />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{cabal.name}</p>
              <p className="text-[11px] text-muted-foreground">Voice call</p>
            </div>
          </div>
          <VoicePane roomId={cabal.id} me={me} onClose={() => setInCall(false)} />
        </div>
      )}

      {/* Watchlist overlay */}
      {showWatch && (
        <div className="absolute inset-0 z-30 flex flex-col bg-surface">
          <div className="px-3 py-3 border-b border-white/5 flex items-center gap-3 shrink-0">
            <button onClick={() => setShowWatch(false)} className="size-8 grid place-items-center rounded-full hover:bg-white/10" aria-label="Back">
              <ArrowLeft className="size-4" />
            </button>
            <p className="text-sm font-semibold">Watchlist</p>
          </div>
          <div className="flex-1 overflow-hidden flex flex-col">
            <WatchlistPane cabalId={cabal.id} me={me} hostAddress={cabal.host_address} />
          </div>
        </div>
      )}
    </>
  );
}

// ─────────── Edit cabal modal — owner-only group info edit ───────────
function EditCabalModal({
  cabal, me, onClose,
}: { cabal: CabalMeta; me: string; onClose: () => void }) {
  const [name, setName] = useState(cabal.name);
  const [topic, setTopic] = useState(cabal.topic ?? "");
  const [image, setImage] = useState(cabal.image_uri ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickFile = (f: File | null) => {
    if (!f) return;
    if (!/^image\//.test(f.type)) return;
    if (f.size > 800_000) {
      setErr("Image too large — under 800KB please.");
      return;
    }
    const r = new FileReader();
    r.onload = () => setImage(String(r.result ?? ""));
    r.readAsDataURL(f);
  };

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await updateCabalMeta(cabal.id, me, {
        name: name.trim() || cabal.name,
        topic: topic.trim() || null,
        image_uri: image.trim() || null,
      });
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} className="sm:max-w-md">
        <div className="px-4 py-3 flex items-center gap-3 border-b border-white/5">
          <button
            onClick={onClose}
            className="size-8 grid place-items-center rounded-full hover:bg-white/10 text-muted-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
          <h2 className="flex-1 font-bold text-[15px]">Edit group info</h2>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="h-8 px-4 rounded-full lit-purple text-sm font-semibold disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <div className="flex flex-col items-center">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative size-24 rounded-2xl grid place-items-center overflow-hidden border border-white/10 hover:border-white/30 transition-colors group"
              style={{
                background: image
                  ? `url(${image}) center/cover`
                  : "linear-gradient(135deg, #a855f7 0%, #6d28d9 100%)",
              }}
              aria-label="Upload group image"
            >
              {!image && (
                <span className="text-2xl font-bold text-white drop-shadow">
                  {initials(name || "??")}
                </span>
              )}
              <span className="absolute inset-0 grid place-items-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="size-6 text-white" />
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {image ? "Change photo" : "Add a photo"}
            </button>
          </div>

          <label className="block">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name"
              maxLength={48}
              className="w-full h-12 rounded-xl bg-white/[0.04] border border-white/5 px-4 text-[15px] font-semibold focus:outline-none focus:border-primary/40 focus:bg-white/[0.06] transition-colors"
            />
            <div className="flex justify-end mt-1">
              <span className="text-[10px] text-muted-foreground">{name.length}/48</span>
            </div>
          </label>

          <label className="block">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="What's this group about? (optional)"
              maxLength={100}
              className="w-full h-11 rounded-xl bg-white/[0.04] border border-white/5 px-4 text-sm focus:outline-none focus:border-primary/40 focus:bg-white/[0.06] transition-colors"
            />
          </label>

          {err && <p className="text-xs text-down">{err}</p>}

          <p className="text-[10px] text-muted-foreground text-center">
            Invite code <span className="font-mono text-foreground">{cabal.invite_code}</span> · invite only
          </p>
        </div>
    </ModalShell>
  );
}

// ============================================================================
// CHAT — Discord-style: rows, not bubbles. Avatar+name+timestamp on first
// message of an author group; subsequent messages just indented under it.
// ============================================================================
const QUICK_REACTIONS = ["👍", "❤️", "🔥", "😂", "😭"];

function renderMarkdownLite(s: string): React.ReactNode {
  const esc = s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, '<code class="px-1 rounded bg-black/40 font-mono text-[12px]">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return <span dangerouslySetInnerHTML={{ __html: esc }} />;
}

function fmtTime(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return `Today at ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function DiscordChat({ cabal, me }: { cabal: CabalMeta; me: string | undefined }) {
  const messages = useCabalChat(cabal.id, me);
  const reactions = useCabalReactions(cabal.id);
  const typers = useCabalTyping(cabal.id, me);
  const isOwner = me?.toLowerCase() === cabal.host_address.toLowerCase();
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; sender: string; body: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const lastTypingSentRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    if (!draft.trim() || !me) return;
    if (!GUN_ENABLED) {
      alert("Chat relay isn't configured. Set VITE_GUN_PEERS to your bot's /gun URL.");
      return;
    }
    if (editing) {
      const msg = messages.find((m) => m.id === editing.id);
      if (msg) {
        try {
          await editCabalMessage(cabal.id, me, msg, draft.trim());
        } catch (e) {
          console.error("[cabal-edit]", e);
          alert(`Couldn't edit message: ${(e as any)?.message ?? e}`);
          return;
        }
      }
      setEditing(null);
      setDraft("");
      return;
    }
    // Snapshot the draft + reply before clearing so we can restore on failure.
    const body = draft.trim();
    const reply = replyTo;
    setDraft("");
    setReplyTo(null);
    try {
      await sendCabalChat(cabal.id, me, body, {
        reply_to: reply?.id ?? null,
        reply_preview: reply ? reply.body.slice(0, 80) : null,
      });
    } catch (e) {
      console.error("[cabal-send]", e);
      // Restore the draft so the user doesn't lose their message on a
      // network blip / encryption error. Surface the error visibly.
      setDraft(body);
      setReplyTo(reply);
      alert(`Couldn't send message: ${(e as any)?.message ?? e}`);
    }
  };

  const startEdit = (m: { id: string; body: string }) => {
    setEditing({ id: m.id, body: m.body });
    setDraft(m.body);
    setReplyTo(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft("");
  };

  const removeMsg = async (m: any) => {
    if (!me) return;
    const mine = m.sender_address?.toLowerCase() === me.toLowerCase();
    if (!mine && !isOwner) return;
    if (!confirm("Delete this message?")) return;
    await deleteCabalMessage(cabal.id, me, m, { isOwner }).catch(console.error);
  };

  const onType = (val: string) => {
    setDraft(val);
    if (!me) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current > 2000) {
      lastTypingSentRef.current = now;
      void setCabalTyping(cabal.id, me);
    }
  };

  const react = async (msgId: string, emoji: string) => {
    if (!me) return;
    const mineAlready = (reactions[msgId]?.[emoji] ?? []).includes(me.toLowerCase());
    await toggleCabalReaction(cabal.id, msgId, emoji, me, !mineAlready);
    setPickerFor(null);
  };

  // Group consecutive messages by author (within 5 minutes)
  const grouped = useMemo(() => {
    const groups: any[][] = [];
    let prev: any = null;
    for (const m of messages.slice(-100)) {
      const sameAuthor = prev &&
        prev.sender_address === m.sender_address &&
        prev.kind === m.kind &&
        Math.abs(m.ts - prev.ts) < 5 * 60 * 1000;
      if (sameAuthor) groups[groups.length - 1].push(m);
      else groups.push([m]);
      prev = m;
    }
    return groups;
  }, [messages]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 scrollbar-thin">
        {grouped.length === 0 && (
          <div className="px-6 py-12 text-center">
            <div className="size-16 rounded-full bg-primary/20 grid place-items-center mx-auto">
              <Hash className="size-8 text-primary" />
            </div>
            <h3 className="text-2xl font-bold mt-4">Welcome to #{cabal.name}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              This is the start of your cabal's chat. Trade events from watchlisted tokens auto-post here.
            </p>
          </div>
        )}

        {grouped.map((group, gi) => {
          const first = group[0];
          if (first.kind === "trade") {
            const buy = first.meta?.side === "BUY";
            return group.map((m: any) => (
              <div key={m.id} className="mx-4 my-0.5 px-3 py-1.5 rounded flex items-center gap-2 text-[13px]"
                   style={{
                     background: buy ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.06)",
                     borderLeft: `3px solid ${buy ? "rgb(34,197,94)" : "rgb(239,68,68)"}`,
                   }}>
                <span className={buy ? "text-up" : "text-down"}>●</span>
                <HandleLink address={m.sender_address} className="text-xs text-muted-foreground hover:underline" at />
                <span className="flex-1 font-medium">{m.body}</span>
                {m.meta?.tx_hash && (
                  <a href={txUrl(m.meta.tx_hash)} target="_blank" rel="noreferrer"
                     className="text-[11px] text-primary hover:underline">tx ↗</a>
                )}
              </div>
            ));
          }
          return (
            <MessageGroup
              key={gi}
              group={group}
              me={me}
              isOwner={isOwner}
              reactions={reactions}
              pickerFor={pickerFor}
              setPickerFor={setPickerFor}
              onReact={react}
              onReply={(m) => setReplyTo({ id: m.id, sender: m.sender_address, body: m.body })}
              onEdit={startEdit}
              onDelete={removeMsg}
            />
          );
        })}
      </div>

      {/* Typing indicator */}
      <div className="h-6 px-4 text-[12px] text-muted-foreground italic">
        {typers.length > 0 && (
          <span>
            <span className="inline-block size-1.5 rounded-full bg-muted-foreground mr-1 animate-pulse" />
            {typers.length === 1 ? `${shortAddrLocal(typers[0])} is typing…` : `${typers.length} people typing…`}
          </span>
        )}
      </div>

      {/* Edit banner */}
      {editing && (
        <div className="mx-4 mb-1 px-3 py-1.5 rounded-t-lg bg-surface flex items-center gap-2 text-[12px]">
          <Pencil className="size-3.5 text-primary" />
          <span className="text-muted-foreground">Editing message</span>
          <button onClick={cancelEdit} className="ml-auto size-5 grid place-items-center rounded-full hover:bg-white/10">
            <X className="size-3" />
          </button>
        </div>
      )}

      {/* Reply banner */}
      {replyTo && !editing && (
        <div className="mx-4 mb-1 px-3 py-1.5 rounded-t-lg bg-surface flex items-center gap-2 text-[12px]">
          <Reply className="size-3.5 text-primary" />
          <span className="text-muted-foreground">Replying to</span>
          <HandleLink address={replyTo.sender} className="font-semibold hover:underline" at />
          <span className="flex-1 truncate italic opacity-70">{replyTo.body.slice(0, 60)}</span>
          <button onClick={() => setReplyTo(null)} className="size-5 grid place-items-center rounded-full hover:bg-white/10">
            <X className="size-3" />
          </button>
        </div>
      )}

      {/* Composer */}
      <div className="px-3 sm:px-4 pb-3 sm:pb-5 shrink-0">
        <div className="bg-white/5 rounded-lg flex items-center px-4">
          <input
            value={draft}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
            placeholder={me ? `Message #${cabal.name}` : "Sign in to chat"}
            disabled={!me}
            className="flex-1 h-11 bg-transparent text-[15px] focus:outline-none disabled:opacity-50"
          />
          <button onClick={send} disabled={!draft.trim() || !me}
                  className="size-7 grid place-items-center text-muted-foreground hover:text-primary disabled:opacity-40">
            <Reply className="size-4 rotate-180" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageGroup({
  group, me, isOwner, reactions, pickerFor, setPickerFor, onReact, onReply, onEdit, onDelete,
}: {
  group: any[];
  me: string | undefined;
  isOwner: boolean;
  reactions: Record<string, Record<string, string[]>>;
  pickerFor: string | null;
  setPickerFor: (id: string | null) => void;
  onReact: (msgId: string, emoji: string) => void;
  onReply: (m: any) => void;
  onEdit: (m: any) => void;
  onDelete: (m: any) => void;
}) {
  const head = group[0];
  return (
    <div className="px-4 mt-4 first:mt-0 hover:bg-white/[0.015] group/group">
      {/* Header row */}
      <div className="flex items-start gap-3">
        <UserAvatar address={head.sender_address} size={40} className="mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 leading-tight">
            <HandleLink address={head.sender_address} className="text-[15px] font-semibold hover:underline" />
            {(head as any).verified ? (
              <ShieldCheck className="size-3 text-primary" />
            ) : (head as any).sig === null ? null : (
              <ShieldAlert className="size-3 text-down" />
            )}
            <span className="text-[11px] text-muted-foreground">{fmtTime(head.ts)}</span>
          </div>
          <MessageBody m={head} me={me} isOwner={isOwner} reactions={reactions}
                       pickerFor={pickerFor} setPickerFor={setPickerFor}
                       onReact={onReact} onReply={onReply} onEdit={onEdit} onDelete={onDelete} indent={false} />
        </div>
      </div>

      {/* Subsequent rows in this group — indented, no avatar/name */}
      {group.slice(1).map((m) => (
        <div key={m.id} className="flex items-start gap-3 mt-0.5 group/msg">
          <div className="size-10 shrink-0 grid place-items-end pb-1">
            <span className="text-[10px] text-muted-foreground opacity-0 group-hover/msg:opacity-100">
              {new Date(m.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <MessageBody m={m} me={me} isOwner={isOwner} reactions={reactions}
                         pickerFor={pickerFor} setPickerFor={setPickerFor}
                         onReact={onReact} onReply={onReply} onEdit={onEdit} onDelete={onDelete} indent />
          </div>
        </div>
      ))}
    </div>
  );
}

function MessageBody({
  m, me, isOwner, reactions, pickerFor, setPickerFor, onReact, onReply, onEdit, onDelete, indent,
}: any) {
  const msgReactions = reactions[m.id] ?? {};
  const mine = me && m.sender_address?.toLowerCase() === me.toLowerCase();
  const canDelete = mine || isOwner;
  const canEdit = mine && m.kind === "text" && !m.deleted;
  const body = typeof m.body === "string" && /^enc?:/.test(m.body)
    ? "(message couldn't be decrypted)"
    : m.body;
  return (
    <div className={`relative ${indent ? "" : ""}`}>
      {(m as any).reply_to && (m as any).reply_preview && !m.deleted && (
        <div className="text-[12px] text-muted-foreground inline-flex items-center gap-1 mb-0.5">
          <CornerUpLeft className="size-3 shrink-0" />
          <span className="truncate italic">
            {String((m as any).reply_preview).startsWith("data:image") ? "📷 Image" : (m as any).reply_preview}
          </span>
        </div>
      )}
      {m.deleted ? (
        <p className="text-[14px] italic text-muted-foreground">Message deleted</p>
      ) : typeof body === "string" && body.startsWith("data:image") ? (
        <img
          src={body}
          alt="Shared image"
          className="max-w-full max-h-72 rounded-lg object-contain"
        />
      ) : (
        <p className="text-[15px] leading-snug text-foreground/90 break-words whitespace-pre-wrap">
          {renderMarkdownLite(body)}
          {m.edited_at && (
            <span className="text-[10px] text-muted-foreground ml-1.5">(edited)</span>
          )}
        </p>
      )}
      {Object.keys(msgReactions).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {Object.entries(msgReactions).map(([emoji, senders]: any) => {
            const mineHere = me && senders.includes(me.toLowerCase());
            return (
              <button key={emoji} onClick={() => onReact(m.id, emoji)}
                      className={`inline-flex items-center gap-1 h-6 px-1.5 rounded-md text-[11px] ${
                        mineHere ? "bg-primary/20 ring-1 ring-primary/50" : "bg-white/5 hover:bg-white/10"
                      }`}>
                <span>{emoji}</span>
                <span className="font-semibold">{senders.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Hover actions (Discord-style floating toolbar) */}
      {!m.deleted && m.kind === "text" && (
        <div className="absolute -top-4 right-0 hidden group-hover/group:flex group-hover/msg:flex bg-surface border border-white/5 rounded-md shadow-lg">
          <button onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}
                  className="size-7 grid place-items-center hover:bg-white/10 text-muted-foreground hover:text-foreground"
                  title="Add reaction">
            <SmilePlus className="size-4" />
          </button>
          <button onClick={() => onReply(m)}
                  className="size-7 grid place-items-center hover:bg-white/10 text-muted-foreground hover:text-foreground"
                  title="Reply">
            <Reply className="size-4" />
          </button>
          {canEdit && (
            <button onClick={() => onEdit(m)}
                    className="size-7 grid place-items-center hover:bg-white/10 text-muted-foreground hover:text-foreground"
                    title="Edit">
              <Pencil className="size-3.5" />
            </button>
          )}
          {canDelete && (
            <button onClick={() => onDelete(m)}
                    className="size-7 grid place-items-center hover:bg-down/20 text-muted-foreground hover:text-down"
                    title={isOwner && !mine ? "Delete (admin)" : "Delete"}>
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      )}

      {pickerFor === m.id && (
        <div className="absolute top-0 right-8 flex gap-0.5 bg-surface border border-white/5 rounded-md px-1 py-1 shadow-xl z-10">
          {QUICK_REACTIONS.map((e) => (
            <button key={e} onClick={() => onReact(m.id, e)}
                    className="size-7 grid place-items-center rounded hover:bg-white/10 text-sm">
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// VOICE PANE
// ============================================================================
function VoicePane({ roomId, me, onClose }: {
  roomId: string; me: string | undefined; onClose: () => void;
}) {
  if (!me || !import.meta.env.VITE_AGORA_APP_ID) {
    return (
      <div className="flex-1 grid place-items-center text-center px-6">
        <div>
          <Volume2 className="size-12 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground mt-3">
            Voice not configured. Set VITE_AGORA_APP_ID to enable.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <RoomVoice roomId={roomId} identity={me} onLeave={onClose} />
    </div>
  );
}

// ============================================================================
// WATCHLIST PANE
// ============================================================================
function WatchlistPane({ cabalId, me, hostAddress }: {
  cabalId: string; me: string | undefined; hostAddress: string;
}) {
  const list = useCabalWatchlist(cabalId);
  const isOwner = me?.toLowerCase() === hostAddress.toLowerCase();
  const [adding, setAdding] = useState(false);
  const [tokenAddr, setTokenAddr] = useState("");

  const add = async () => {
    if (!me || !/^0x[a-fA-F0-9]{40}$/.test(tokenAddr.trim())) return;
    await addWatchlist(cabalId, me, tokenAddr.trim());
    setTokenAddr(""); setAdding(false);
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {isOwner ? "Pin tokens — buys/sells auto-post in #general." : "Tokens watched by this cabal."}
        </p>
        {isOwner && (
          <button onClick={() => setAdding(true)}
                  className="h-8 px-3 rounded lit-purple text-xs font-semibold inline-flex items-center gap-1">
            <Plus className="size-3.5" /> Add token
          </button>
        )}
      </div>
      {isOwner && adding && (
        <div className="mb-3 flex items-center gap-2">
          <input value={tokenAddr} onChange={(e) => setTokenAddr(e.target.value)}
                 onKeyDown={(e) => e.key === "Enter" && add()}
                 placeholder="0x… (token contract)" autoFocus
                 className="flex-1 h-9 rounded bg-background px-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/40" />
          <button onClick={add} disabled={!/^0x[a-fA-F0-9]{40}$/.test(tokenAddr.trim())}
                  className="h-9 px-3 rounded lit-purple text-xs font-semibold disabled:opacity-40">Add</button>
          <button onClick={() => setAdding(false)} className="size-9 grid place-items-center rounded bg-white/5">
            <X className="size-4" />
          </button>
        </div>
      )}
      {list.length === 0 && !adding ? (
        <div className="text-sm text-muted-foreground text-center py-12">No tokens watched.</div>
      ) : (
        <ul className="space-y-1.5">
          {list.map((w: any) => (
            <li key={w.token_address} className="flex items-center gap-3 px-3 py-2 rounded bg-surface hover:bg-white/[0.04]">
              <div className="size-9 rounded-full bg-primary/15 grid place-items-center text-[10px] font-bold text-primary uppercase">
                {w.token_address.slice(2, 4)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono truncate">{w.token_address}</p>
                <p className="text-[10px] text-muted-foreground">
                  Min ${w.min_value_usd} · {w.alert_on_buy ? "Buys " : ""}{w.alert_on_sell ? "Sells" : ""}
                </p>
              </div>
              {isOwner && (
                <button onClick={() => removeWatchlist(cabalId, w.token_address)}
                        className="size-7 grid place-items-center rounded-full hover:bg-down/15 text-muted-foreground hover:text-down">
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================================================================
// MEMBERS RAIL (right 240px) — online/offline groups + admin actions
// ============================================================================
// Section header + body grouping — used inside MembersRail. Used to live
// in the old Discord-style ChannelSidebar; that's gone but MembersRail
// still leans on this layout. Tiny helper, lives next to its only caller.
function Section({
  label, action, children,
}: { label: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="px-3 mb-0.5 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
        {action}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function MembersRail({
  cabal, me, onClose, mobile,
}: {
  cabal: CabalMeta;
  me: string | undefined;
  onClose?: () => void;
  mobile?: boolean;
}) {
  const members = useCabalMembers(cabal.id);
  const pending = usePendingInvites(cabal.id, me);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteTarget, setInviteTarget] = useState("");
  const isOwner = me?.toLowerCase() === cabal.host_address.toLowerCase();
  const myRole = members.find((m: any) => m.account_address?.toLowerCase() === me?.toLowerCase())?.role;
  const canKick = isOwner || myRole === "mod" || myRole === "owner";

  const memberAddrs = members
    .map((m: any) => m.account_address)
    .filter((a: any): a is string => typeof a === "string");

  const kick = async (target: string) => {
    if (!me || !canKick) return;
    if (!confirm(`Kick ${shortAddrLocal(target)}? Cabal key will rotate.`)) return;
    setBusy(target);
    try {
      await kickMemberFromCabal(cabal.id, me, target, memberAddrs);
    } finally { setBusy(null); }
  };

  const rotate = async () => {
    if (!me || !isOwner) return;
    if (!confirm("Rotate cabal key? All members re-derive on next message.")) return;
    setBusy("rotate");
    try {
      const res = await rotateCabalKey(cabal.id, me, memberAddrs);
      alert(
        `Encryption key rotated for ${res.granted} member${res.granted === 1 ? "" : "s"}.` +
        (res.pending ? ` ${res.pending} still need to open the app first.` : ""),
      );
    } catch (e: any) {
      console.error(e);
      alert(`Couldn't rotate encryption key: ${e?.message ?? e}`);
    } finally { setBusy(null); }
  };

  // Owner auto-distributes the current key to any member missing a grant (e.g.
  // freshly-added members who have since published their pubkey) on open, so
  // adding someone "just works" without a manual rotate.
  useEffect(() => {
    if (!me || !isOwner || memberAddrs.length === 0) return;
    let cancel = false;
    (async () => {
      try {
        if (!cancel) await distributeCabalKey(cabal.id, me, memberAddrs);
      } catch (e) { console.warn("[cabal] auto key distribute failed", e); }
    })();
    return () => { cancel = true; };
  }, [cabal.id, me, isOwner, memberAddrs.join(",")]);

  const retry = async () => {
    if (!me) return;
    setBusy("retry");
    try {
      const res = await retryPendingInvites(cabal.id, me);
      alert(`Granted ${res.granted} member${res.granted === 1 ? "" : "s"}. ${res.stillPending} still pending.`);
    } catch (e: any) {
      console.error(e);
      alert(`Couldn't retry invites: ${e?.message ?? e}`);
    } finally { setBusy(null); }
  };

  const invite = async () => {
    if (!me || !isOwner || !inviteTarget.trim()) return;
    setBusy("invite");
    try {
      const addr = await resolveToAddress(inviteTarget);
      if (!addr) {
        alert("User not found. Try their @handle or wallet address.");
        return;
      }
      await inviteAddressToCabal(cabal, me, addr);
      setInviteTarget("");
    } catch (e: any) {
      console.error(e);
      alert(`Couldn't invite member: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`${mobile ? "w-full h-full" : "w-60 shrink-0 border-l border-white/5"} bg-surface flex flex-col`}>
      {mobile && (
        <div className="h-12 px-3 border-b border-white/5 flex items-center gap-2 shrink-0">
          <button
            onClick={onClose}
            className="size-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5"
            title="Close"
          >
            <X className="size-4" />
          </button>
          <span className="font-bold text-[15px]">Members</span>
        </div>
      )}
      <div className="flex-1 overflow-y-auto py-4 scrollbar-thin">
        {/* Members section */}
        <Section label={`Members — ${members.length}`}>
          {members.map((m: any) => {
            const owner = m.account_address?.toLowerCase() === cabal.host_address.toLowerCase();
            const self = m.account_address?.toLowerCase() === me?.toLowerCase();
            return (
              <div key={m.account_address}
                   className="mx-2 my-px h-11 px-2 rounded flex items-center gap-2 group hover:bg-white/5">
                <div className="relative shrink-0">
                  <UserAvatar address={m.account_address} size={32} />
                  <span className="absolute -bottom-px -right-px size-3 rounded-full bg-white/50 ring-2 ring-surface" />
                </div>
                <div className="flex-1 min-w-0">
                  <HandleLink address={m.account_address}
                              className={`text-[14px] font-medium truncate hover:underline inline-flex items-center gap-1 ${
                                owner ? "text-primary" : "text-foreground"
                              }`} />
                  {owner && <p className="text-[10px] text-primary inline-flex items-center gap-0.5"><Crown className="size-2.5" /> Owner</p>}
                </div>
                {canKick && !owner && !self && (
                  <button onClick={() => kick(m.account_address)} disabled={busy === m.account_address}
                          title="Kick + rotate key"
                          className="size-7 grid place-items-center rounded-full opacity-0 group-hover:opacity-100 hover:bg-down/20 text-muted-foreground hover:text-down disabled:opacity-40">
                    <UserMinus className="size-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </Section>

        {/* Pending invites */}
        {isOwner && pending.length > 0 && (
          <Section
            label={`Pending — ${pending.length}`}
            action={
              <button onClick={retry} disabled={busy === "retry"}
                      className="h-5 px-1.5 rounded text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5">
                <RefreshCw className={`size-2.5 ${busy === "retry" ? "animate-spin" : ""}`} /> Retry
              </button>
            }
          >
            {pending.map((p) => (
              <div key={p.invitee}
                   className="mx-2 my-px h-10 px-2 rounded bg-yellow-500/5 border border-yellow-500/15 flex items-center gap-2">
                <ClockIcon className="size-3 text-yellow-500/80" />
                <HandleLink address={p.invitee} className="flex-1 text-[13px] hover:underline truncate" at />
              </div>
            ))}
          </Section>
        )}

        {/* Owner tools */}
        {isOwner && (
          <Section label="Owner tools">
            <div className="mx-2 mb-2 rounded-lg border border-white/5 bg-white/[0.03] p-2">
              <div className="flex items-center gap-1.5">
                <input
                  value={inviteTarget}
                  onChange={(e) => setInviteTarget(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void invite();
                    }
                  }}
                  placeholder="@handle or 0x..."
                  className="min-w-0 flex-1 h-8 bg-transparent text-[13px] focus:outline-none"
                />
                <button
                  onClick={() => void invite()}
                  disabled={busy === "invite" || !inviteTarget.trim()}
                  className="size-8 grid place-items-center rounded-md lit-purple disabled:opacity-40"
                  title="Invite member"
                >
                  <UserPlus className="size-4" />
                </button>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Sends them a DM with the cabal name and invite code.
              </p>
            </div>
            <button onClick={rotate} disabled={busy === "rotate"}
                    className="mx-2 my-px h-9 px-2 rounded flex items-center gap-2 text-muted-foreground hover:bg-white/5 hover:text-foreground disabled:opacity-40">
              <RefreshCw className={`size-4 ${busy === "rotate" ? "animate-spin" : ""}`} />
              <span className="text-[13px]">Rotate encryption key</span>
            </button>
          </Section>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// LANDING (no cabal selected)
// ============================================================================
function Landing({ onNew, onJoin }: { onNew: () => void; onJoin: () => void }) {
  return (
    <div className="flex-1 grid place-items-center px-6 text-center">
      <div className="max-w-md">
        <div className="size-20 rounded-3xl bg-primary/15 text-primary grid place-items-center mx-auto">
          <MessageSquare className="size-10" />
        </div>
        <h1 className="text-2xl font-bold mt-5">Welcome to Cabals</h1>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          Encrypted group chats with voice rooms and a live trade feed from members. Pin tokens to get
          buy/sell alerts in chat.
        </p>
        <div className="flex justify-center gap-2 mt-6">
          <button onClick={onNew} className="h-11 px-5 rounded-md lit-purple text-sm font-bold inline-flex items-center gap-1.5">
            <Plus className="size-4" /> Create cabal
          </button>
          <button onClick={onJoin} className="h-11 px-5 rounded-md bg-white/5 text-sm font-semibold inline-flex items-center gap-1.5">
            <KeyRound className="size-4" /> Join with code
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MODALS
// ============================================================================
function CreateCabalModal({
  onClose, onCreate,
}: { onClose: () => void; onCreate: (name: string, topic: string, image: string, invited: string[]) => void }) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [image, setImage] = useState("");
  const [invite, setInvite] = useState("");
  const [list, setList] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const v = invite.replace(/^@/, "").trim();
    if (v && !list.includes(v)) setList([...list, v]);
    setInvite("");
  };

  // File upload — read as data URL so we can preview + persist on Gun.
  // (For large images you'd want to push to IPFS/R2 first; data URLs are
  // fine for the small avatars cabals usually use.)
  const onPickFile = (f: File | null) => {
    if (!f) return;
    if (!/^image\//.test(f.type)) return;
    if (f.size > 800_000) {                       // 800kb soft cap
      alert("Image too large — please pick something under 800KB or paste a URL.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result ?? ""));
    reader.readAsDataURL(f);
  };

  const canSubmit = name.trim().length > 0;
  const initialsPreview = (name.trim() || "??").slice(0, 2).toUpperCase();

  return (
    <ModalShell onClose={onClose} className="sm:max-w-md">
        {/* Header — Telegram-style: close left, title centered, action right */}
        <div className="px-4 py-3 flex items-center gap-3 border-b border-white/5">
          <button
            onClick={onClose}
            className="size-8 grid place-items-center rounded-full hover:bg-white/10 text-muted-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
          <h2 className="flex-1 font-bold text-[15px]">New cabal</h2>
          <button
            onClick={() => onCreate(name.trim(), topic.trim(), image.trim(), list)}
            disabled={!canSubmit}
            className="h-8 px-4 rounded-full lit-purple text-sm font-semibold disabled:opacity-40"
          >
            Create
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* Big circular avatar with overlaid camera icon — click anywhere to upload */}
          <div className="flex flex-col items-center">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative size-24 rounded-full grid place-items-center overflow-hidden border border-white/10 hover:border-white/30 transition-colors group"
              style={{
                background: image
                  ? `url(${image}) center/cover`
                  : "linear-gradient(135deg, #a855f7 0%, #6d28d9 100%)",
              }}
              aria-label="Upload cabal image"
            >
              {!image && (
                <span className="text-2xl font-bold text-white drop-shadow">
                  {initialsPreview}
                </span>
              )}
              {/* Hover veil + camera */}
              <span className="absolute inset-0 grid place-items-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="size-6 text-white" />
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {image ? "Change photo" : "Add a photo · optional"}
            </button>
          </div>

          {/* Name — big like Telegram's group name field */}
          <label className="block">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cabal name"
              maxLength={48}
              className="w-full h-12 rounded-xl bg-white/[0.04] border border-white/5 px-4 text-[15px] font-semibold focus:outline-none focus:border-primary/40 focus:bg-white/[0.06] transition-colors placeholder:text-muted-foreground/70 placeholder:font-normal"
            />
            <div className="flex justify-end mt-1">
              <span className="text-[10px] text-muted-foreground">{name.length}/48</span>
            </div>
          </label>

          {/* Topic — secondary, smaller */}
          <label className="block">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="What's this cabal about? (optional)"
              maxLength={100}
              className="w-full h-11 rounded-xl bg-white/[0.04] border border-white/5 px-4 text-sm focus:outline-none focus:border-primary/40 focus:bg-white/[0.06] transition-colors"
            />
          </label>

          <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
            <Lock className="size-3.5 text-primary" /> Private — members need an invite code
          </p>

          {/* Invites — chip input */}
          <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
                Invite members · optional
              </p>
              <div className="flex flex-wrap items-center gap-1.5 min-h-11 px-2 py-1.5 rounded-xl bg-white/[0.04] border border-white/5 focus-within:border-primary/40 focus-within:bg-white/[0.06] transition-colors">
                {list.map((h) => (
                  <span
                    key={h}
                    className="inline-flex items-center gap-1 pl-2 pr-1 h-7 rounded-full bg-primary/15 text-primary text-xs font-medium"
                  >
                    @{h}
                    <button
                      onClick={() => setList((l) => l.filter((x) => x !== h))}
                      className="size-4 grid place-items-center rounded-full hover:bg-primary/25"
                      aria-label={`Remove ${h}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <input
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
                    if (e.key === "Backspace" && !invite && list.length > 0) {
                      setList((l) => l.slice(0, -1));
                    }
                  }}
                  placeholder={list.length === 0 ? "@handle or 0x…  (press Enter)" : ""}
                  className="flex-1 min-w-[120px] h-7 bg-transparent text-sm focus:outline-none"
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Members you add get an automatic DM with the join code.
              </p>
          </div>
        </div>
    </ModalShell>
  );
}

function JoinCodeModal({ error, onClose, onJoin }: {
  error: string | null; onClose: () => void; onJoin: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const cleanCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-8);
  return (
    <ModalShell onClose={onClose} className="sm:max-w-sm">
        <div className="px-4 py-3 flex items-center gap-3 border-b border-white/5">
          <button
            onClick={onClose}
            className="size-8 grid place-items-center rounded-full hover:bg-white/10 text-muted-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
          <h2 className="flex-1 font-bold text-[15px]">Join a cabal</h2>
          <button
            onClick={() => onJoin(code)}
            disabled={!code.trim()}
            className="h-8 px-4 rounded-full lit-purple text-sm font-semibold disabled:opacity-40"
          >
            Join
          </button>
        </div>
        <div className="px-5 py-5">
          <div className="size-12 rounded-2xl bg-primary/15 grid place-items-center mx-auto mb-3">
            <KeyRound className="size-5 text-primary" />
          </div>
          <p className="text-sm font-semibold text-center">Got an invite code?</p>
          <p className="text-xs text-muted-foreground text-center mt-1 mb-4">
            Paste the 8-character code your friend shared.
          </p>
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(cleanCode(e.target.value))}
            onKeyDown={(e) => e.key === "Enter" && code.trim() && onJoin(code)}
            placeholder="XXXXXXXX"
            className="w-full h-12 rounded-xl bg-white/[0.04] border border-white/5 px-4 text-center font-mono tracking-[0.4em] text-base focus:outline-none focus:border-primary/40 focus:bg-white/[0.06] transition-colors"
          />
          {error && <p className="text-xs text-down mt-2 text-center">{error}</p>}
        </div>
    </ModalShell>
  );
}

// ============================================================================
// helpers
// ============================================================================
function initials(s: string): string {
  const w = s.trim().split(/\s+/);
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + (w[1][0] ?? "")).toUpperCase();
}
function shortAddrLocal(a: string) {
  if (!a) return "?";
  return a.length > 8 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}
