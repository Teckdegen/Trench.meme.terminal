import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { deletePost, editPost } from "@/lib/supabase-hooks";

export function PostMenu({
  postId,
  me,
  body,
  onEdit,
  onDelete,
}: {
  postId: string;
  me: string;
  body: string;
  onEdit: (next: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const remove = async () => {
    if (!confirm("Delete this post?")) return;
    setBusy(true);
    try {
      await deletePost({ data: { postId, me } });
      onDelete();
      setOpen(false);
    } catch (e) {
      console.error(e);
      alert("Could not delete post");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const next = draft.trim();
    if (!next || next === body) { setEditing(false); return; }
    setBusy(true);
    try {
      await editPost({ data: { postId, me, body: next } });
      onEdit(next);
      setEditing(false);
      setOpen(false);
    } catch (e) {
      console.error(e);
      alert("Could not save edit");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm focus:outline-none focus:border-primary/40 resize-none"
        />
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => { setEditing(false); setDraft(body); }}
            disabled={busy}
            className="h-8 px-3 rounded-full text-xs font-semibold bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !draft.trim()}
            className="h-8 px-3 rounded-full text-xs font-semibold lit-purple disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative shrink-0" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="size-8 -m-1 grid place-items-center rounded-full hover:bg-white/10 text-muted-foreground"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 min-w-[140px] rounded-xl bg-background border border-white/10 shadow-xl py-1">
          <button
            type="button"
            onClick={() => { setOpen(false); setEditing(true); }}
            disabled={busy}
            className="w-full px-3 py-2 text-left text-sm hover:bg-white/5 inline-flex items-center gap-2"
          >
            <Pencil className="size-3.5" /> Edit
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="w-full px-3 py-2 text-left text-sm text-down hover:bg-down/10 inline-flex items-center gap-2"
          >
            <Trash2 className="size-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
