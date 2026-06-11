import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/layout/AppLayout";
import {
  GUN_ENABLED,
  useDMThreads,
  useDMMessages,
  sendDM,
  startDMThread,
  markThreadRead,
  deleteDMMessage,
  editDMMessage,
  deleteDMThread,
  type DMMessage,
} from "@/lib/gun-dms";
import { resolveToAddress, useIdentities, labelFor } from "@/lib/identity";
import { useMe } from "@/lib/useMe";
import { Search, Send, ArrowLeft, Pencil, X, UserPlus, Image as ImageIcon, MoreHorizontal, Inbox as InboxIcon, Trash2 } from "lucide-react";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { UserAvatar } from "@/components/Handle";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { renderMentions } from "@/lib/renderMentions";

export const Route = createFileRoute("/inbox")({
  component: Inbox,
  validateSearch: (s: Record<string, unknown>) => ({ t: typeof s.t === "string" ? s.t : undefined }),
});

const gradients = [
  "linear-gradient(135deg, #a855f7, #ec4899)",
  "linear-gradient(135deg, #06b6d4, #6366f1)",
  "linear-gradient(135deg, #f59e0b, #ef4444)",
  "linear-gradient(135deg, #10b981, #06b6d4)",
  "linear-gradient(135deg, #f472b6, #a855f7)",
  "linear-gradient(135deg, #facc15, #f59e0b)",
];

function gradFor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return gradients[Math.abs(h) % gradients.length];
}

// Inbox avatar — prefers the real Supabase profile picture (via UserAvatar)
// and falls back to a name-hash gradient monogram. The address prop is
// the canonical key here; `name` is only used for the fallback initial
// and the gradient seed.
function Avatar({
  address, name, size = 40, online,
}: { address?: string; name: string; size?: number; online?: boolean }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {address ? (
        <UserAvatar address={address} size={size} />
      ) : (
        <div
          className="size-full rounded-full grid place-items-center text-sm font-bold text-white"
          style={{ background: gradFor(name) }}
        >
          {name[0]?.toUpperCase()}
        </div>
      )}
      {online && (
        <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-white/50 ring-2 ring-background" />
      )}
    </div>
  );
}

function Inbox() {
  const me = useMe();
  const gunThreads = useDMThreads(me);
  const search = Route.useSearch();
  const normPartner = (addr: string | null | undefined) => addr?.toLowerCase() ?? null;
  const [activePartner, setActivePartner] = useState<string | null>(normPartner(search.t));
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<DMMessage | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (search.t) setActivePartner(normPartner(search.t));
  }, [search.t]);

  const messages = useDMMessages(me, activePartner ?? undefined);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [activePartner, messages.length]);

  useEffect(() => {
    if (me && activePartner) markThreadRead(me, activePartner);
  }, [me, activePartner, messages.length]);

  const send = () => {
    if (!draft.trim() || !activePartner || !me) return;
    const body = draft.trim();
    if (editing) {
      editDMMessage(me, activePartner, editing, body).catch(console.error);
      setEditing(null);
      setDraft("");
      return;
    }
    setDraft("");
    sendDM(me, activePartner, body).catch(console.error);
  };

  const removeMessage = async (m: DMMessage) => {
    if (!me || !activePartner) return;
    if (!confirm("Delete this message?")) return;
    await deleteDMMessage(me, activePartner, m).catch(console.error);
  };

  const removeThread = async () => {
    if (!me || !activePartner) return;
    if (!confirm("Delete this conversation from your inbox?")) return;
    await deleteDMThread(me, activePartner);
    setActivePartner(null);
    setMenuOpen(false);
  };

  const startNew = async (handle: string) => {
    const clean = handle.replace(/^@/, "").trim().toLowerCase();
    if (!clean || !me) return;
    if (!GUN_ENABLED) return;
    const addr = await resolveToAddress(clean);
    if (!addr) {
      alert("User not found — check the @handle.");
      return;
    }
    if (addr.toLowerCase() === me.toLowerCase()) {
      alert("You can't message yourself.");
      return;
    }
    await startDMThread(me, addr);
    setActivePartner(addr);
    setComposing(false);
  };

  const sendImage = (file: File) => {
    if (!activePartner || !me) return;
    if (activePartner.toLowerCase() === me.toLowerCase()) {
      alert("You can't message yourself.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      alert("Only image files are supported.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      alert("Image must be under 2 MB.");
      return;
    }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      sendDM(me, activePartner, dataUrl, { kind: "image" })
        .catch((e) => alert(e instanceof Error ? e.message : "Failed to send image"))
        .finally(() => setUploading(false));
    };
    reader.onerror = () => {
      setUploading(false);
      alert("Could not read image file.");
    };
    reader.readAsDataURL(file);
  };

  const dmAddrs = useMemo(
    () => [...gunThreads.map((t) => t.partner), activePartner].filter(Boolean) as string[],
    [gunThreads, activePartner],
  );
  const idMap = useIdentities(dmAddrs);
  const nameFor = (addr: string) => labelFor(idMap[addr.toLowerCase()]);

  const filtered = gunThreads.filter((t) => {
    if (me && t.partner.toLowerCase() === me.toLowerCase()) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    const label = nameFor(t.partner).toLowerCase();
    return label.includes(q) || t.lastBody.toLowerCase().includes(q);
  });

  const activeName = activePartner ? nameFor(activePartner) : "";
  // Tab title reflects the open DM partner so the user can find the right
  // tab when they have multiple chats open. Falls back to "Inbox".
  useDocumentTitle(activePartner ? activeName : "Inbox");

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle="End-to-end encrypted"
        actions={
          <button
            onClick={() => setComposing(true)}
            disabled={!me}
            className="h-9 px-4 rounded-full lit-purple text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
          >
            <Pencil className="size-4" /> New
          </button>
        }
      />

      {!GUN_ENABLED && (
        <p className="text-sm text-amber-400/90 mb-3 px-1">
          Set <code className="text-xs">VITE_GUN_PEERS</code> to your bot relay URL (e.g. https://your-bot/gun).
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-3 h-[calc(100vh-220px)] min-h-[460px]">
        <aside className={`rounded-3xl bg-surface border border-white/5 overflow-hidden flex flex-col ${activePartner ? "hidden md:flex" : "flex"}`}>
          <div className="px-3 py-3 border-b border-white/5 space-y-2">
            <div className="flex items-center gap-2 h-10 px-3 rounded-full bg-white/5 focus-within:ring-1 focus-within:ring-primary/40">
              <Search className="size-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search messages"
                className="flex-1 bg-transparent text-sm focus:outline-none"
              />
            </div>
          </div>
          <ul className="flex-1 overflow-y-auto scrollbar-hide">
            {filtered.length === 0 && (
              <li className="px-4 py-16 text-center">
                <div className="size-12 rounded-full bg-white/5 grid place-items-center mx-auto">
                  <InboxIcon className="size-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-semibold mt-3">No conversations</p>
                <p className="text-xs text-muted-foreground mt-1">Tap New to start one.</p>
              </li>
            )}
            {filtered.map((t) => {
              const isActive = normPartner(t.partner) === activePartner;
              return (
                <li key={t.channelId}>
                  <button
                    onClick={() => setActivePartner(normPartner(t.partner))}
                    className={`relative w-full text-left flex items-center gap-3 px-3 py-3 transition-colors ${
                      isActive ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
                    }`}
                  >
                    {isActive && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" />}
                    <Avatar address={t.partner} name={nameFor(t.partner)} online />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate flex-1">{nameFor(t.partner)}</span>
                        {t.lastTs > 0 && (
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {new Date(t.lastTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </div>
                      <span className="text-[12px] text-muted-foreground truncate block">
                        {t.lastBody || "No messages yet"}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className={`rounded-3xl bg-surface border border-white/5 overflow-hidden flex flex-col ${activePartner ? "flex" : "hidden md:flex"}`}>
          {!activePartner ? (
            <div className="flex-1 grid place-items-center text-center px-6">
              <div>
                <div className="size-16 rounded-full bg-white/5 grid place-items-center mx-auto">
                  <InboxIcon className="size-7 text-muted-foreground" />
                </div>
                <p className="text-base font-semibold mt-4">Your messages</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-[260px] mx-auto">
                  Pick a conversation or start a new encrypted DM.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="px-3 py-3 border-b border-white/5 flex items-center gap-3">
                <button
                  onClick={() => setActivePartner(null)}
                  className="md:hidden size-8 grid place-items-center rounded-full hover:bg-white/10"
                >
                  <ArrowLeft className="size-4" />
                </button>
                <Avatar address={activePartner ?? undefined} name={activeName} size={36} online />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate inline-flex items-baseline min-w-0">
                    <span className="truncate">{activeName}</span>
                    <VerifiedBadge address={activePartner} />
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono truncate">
                    {activePartner}
                  </div>
                </div>
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen((v) => !v)}
                    className="size-9 grid place-items-center rounded-full hover:bg-white/10 text-muted-foreground"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                  {menuOpen && (
                    <div className="absolute right-0 top-10 z-20 min-w-[160px] rounded-xl bg-background border border-white/10 shadow-xl py-1">
                      <button
                        onClick={removeThread}
                        className="w-full px-3 py-2 text-left text-sm text-down hover:bg-white/5 inline-flex items-center gap-2"
                      >
                        <Trash2 className="size-3.5" /> Delete chat
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-hide px-3 sm:px-4 py-4 space-y-1">
                <div className="text-center text-[10px] uppercase tracking-wide text-muted-foreground py-2">End-to-end encrypted</div>
                {messages.length === 0 && (
                  <p className="text-center text-xs text-muted-foreground py-8">Say hi 👋</p>
                )}
                {messages.map((m) => {
                  const mine = !!(me && m.sender.toLowerCase() === me.toLowerCase());
                  return (
                    <div key={m.id} className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"} mt-2 group/msg`}>
                      {!mine && activePartner && (
                        <Avatar address={activePartner} name={activeName} size={28} />
                      )}
                      <div
                        className={`relative max-w-[78%] px-3.5 py-2 text-[14px] leading-snug ${
                          mine ? "lit-purple rounded-2xl rounded-br-md" : "bg-white/[0.06] rounded-2xl rounded-bl-md"
                        }`}
                      >
                        {m.kind === "image" || m.body.startsWith("data:image") ? (
                          <img src={m.body} alt="Shared image" className="max-w-full max-h-64 rounded-lg object-contain" />
                        ) : (
                          <p className="whitespace-pre-wrap break-words">
                            {renderMentions(m.body)}
                            {m.edited_at && (
                              <span className={`text-[10px] ml-1 ${mine ? "text-white/50" : "text-muted-foreground"}`}>
                                (edited)
                              </span>
                            )}
                          </p>
                        )}
                        <p className={`text-[10px] mt-1 ${mine ? "text-white/60" : "text-muted-foreground"}`}>
                          {new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                        {mine && !m.deleted && (
                          <div className="absolute -top-3 right-0 hidden group-hover/msg:flex bg-background border border-white/10 rounded-lg shadow-lg">
                            <button
                              onClick={() => { setEditing(m); setDraft(m.body); }}
                              className="size-7 grid place-items-center hover:bg-white/10 text-muted-foreground"
                              title="Edit"
                            >
                              <Pencil className="size-3" />
                            </button>
                            <button
                              onClick={() => removeMessage(m)}
                              className="size-7 grid place-items-center hover:bg-down/20 text-down"
                              title="Delete"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {editing && (
                <div className="px-3 py-2 border-t border-white/5 flex items-center gap-2 text-xs text-muted-foreground">
                  <Pencil className="size-3.5 text-primary" />
                  <span>Editing message</span>
                  <button
                    onClick={() => { setEditing(null); setDraft(""); }}
                    className="ml-auto size-6 grid place-items-center rounded-full hover:bg-white/10"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )}
              <div className="px-3 py-3 border-t border-white/5">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) sendImage(f);
                    e.target.value = "";
                  }}
                />
                <div className="flex items-center gap-1 bg-white/5 rounded-2xl px-2 py-1.5 focus-within:ring-1 focus-within:ring-primary/40">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={!me || uploading || activePartner?.toLowerCase() === me?.toLowerCase()}
                    className="size-8 grid place-items-center rounded-full hover:bg-white/10 text-muted-foreground disabled:opacity-40"
                    title="Send image"
                  >
                    <ImageIcon className="size-4" />
                  </button>
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
                    placeholder={`Message ${activeName}`}
                    disabled={!me || activePartner?.toLowerCase() === me?.toLowerCase()}
                    className="flex-1 bg-transparent text-sm focus:outline-none px-1 disabled:opacity-50"
                  />
                  <button
                    onClick={send}
                    disabled={!draft.trim() || !me || uploading}
                    className="size-9 rounded-full lit-purple grid place-items-center disabled:opacity-30"
                  >
                    <Send className="size-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {composing && <NewMessageModal onClose={() => setComposing(false)} onStart={startNew} />}
    </>
  );
}

function NewMessageModal({ onClose, onStart }: { onClose: () => void; onStart: (handle: string) => void }) {
  const [handle, setHandle] = useState("");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-3">
      <button className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-md rounded-3xl bg-background overflow-hidden" style={{ boxShadow: "0 30px 80px rgba(0,0,0,0.8)" }}>
        <div className="px-4 py-4 flex items-center gap-3">
          <button onClick={onClose} className="size-8 grid place-items-center rounded-full bg-white/5">
            <X className="size-4" />
          </button>
          <h2 className="flex-1 font-bold">New message</h2>
          <button
            onClick={() => onStart(handle)}
            disabled={!handle.trim()}
            className="h-8 px-4 rounded-full lit-purple text-sm font-semibold disabled:opacity-40"
          >
            Start
          </button>
        </div>
        <div className="px-4 pb-5">
          <label className="block">
            <span className="text-xs text-muted-foreground">To (@handle or 0x…)</span>
            <div className="mt-1 flex items-center gap-2 h-11 px-3 rounded-xl bg-white/5">
              <UserPlus className="size-4 text-muted-foreground" />
              <input
                autoFocus
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@handle or 0x…"
                className="flex-1 bg-transparent text-sm font-mono focus:outline-none"
              />
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}
