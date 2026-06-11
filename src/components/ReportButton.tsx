// Reusable "report" button. Drop it next to any flaggable content:
//   <ReportButton kind="post" targetId={post.id} />
//   <ReportButton kind="account" targetId={wallet} />

import { useState } from "react";
import { Flag, X } from "lucide-react";
import { useMe } from "@/lib/useMe";
import { fileReport, type ReportKind, type ReportReason } from "@/lib/reports";

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam",           label: "Spam" },
  { value: "scam",           label: "Scam / rug" },
  { value: "harassment",     label: "Harassment" },
  { value: "impersonation",  label: "Impersonation" },
  { value: "nsfw",           label: "NSFW" },
  { value: "illegal",        label: "Illegal" },
  { value: "other",          label: "Other" },
];

export function ReportButton({
  kind, targetId, compact,
}: { kind: ReportKind; targetId: string; compact?: boolean }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("spam");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const submit = async () => {
    if (!me) return;
    setBusy(true);
    const r = await fileReport(me, kind, targetId, reason, note.trim() || undefined);
    setBusy(false);
    if (r.ok) {
      setStatus("Reported. Thanks — we'll review.");
      setTimeout(() => { setOpen(false); setStatus(null); setNote(""); }, 1500);
    } else {
      setStatus(r.error ?? "Couldn't submit.");
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={!me}
        title={me ? "Report" : "Sign in to report"}
        className={`${
          compact ? "size-7" : "size-8"
        } grid place-items-center rounded-full text-muted-foreground hover:text-down hover:bg-down/10 disabled:opacity-40`}
      >
        <Flag className={compact ? "size-3.5" : "size-4"} />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] grid place-items-center px-3">
          <button className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-sm rounded-3xl bg-background border border-white/10 overflow-hidden"
               style={{ boxShadow: "0 30px 80px rgba(0,0,0,0.8)" }}>
            <div className="px-4 py-3 flex items-center gap-2 border-b border-white/10">
              <Flag className="size-4 text-down" />
              <h3 className="font-bold text-sm flex-1">Report {kind}</h3>
              <button onClick={() => setOpen(false)} className="size-7 grid place-items-center rounded-full bg-white/5">
                <X className="size-3.5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-1.5">
                {REASONS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setReason(r.value)}
                    className={`h-9 rounded-xl text-xs font-semibold ${
                      reason === r.value ? "lit-purple" : "bg-white/5 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                maxLength={500}
                placeholder="Add context (optional, 500 chars max)"
                className="w-full h-20 rounded-xl bg-white/5 px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <p className="text-[10px] text-muted-foreground text-right tabular-nums">{500 - note.length}</p>
              {status && (
                <p className={`text-xs ${status.startsWith("Reported") ? "text-up" : "text-down"}`}>{status}</p>
              )}
              <button
                onClick={submit}
                disabled={busy}
                className="w-full h-10 rounded-xl bg-down text-white text-sm font-bold disabled:opacity-40"
              >
                {busy ? "Sending…" : "Submit report"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
