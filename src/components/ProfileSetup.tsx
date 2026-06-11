// One-time profile setup — optional. New accounts already get their wallet
// address as the default @handle on sign-in; users can edit from Profile.

import { useEffect, useState } from "react";
import { AtSign, Check, Loader2, X } from "lucide-react";
import { useMe } from "@/lib/useMe";
import { patchIdentity } from "@/lib/identity";
import { useAccountProfile, updateMyProfile, isHandleAvailable } from "@/lib/supabase-hooks";

export function ProfileSetup() {
  const me = useMe();
  const { profile } = useAccountProfile(me);
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [available, setAvailable] = useState<null | boolean>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // No forced modal — wallet address is the default handle until they edit it.
  useEffect(() => {
    if (!me || !profile) return;
    setOpen(false);
  }, [me, profile]);

  // Live handle availability check (debounced)
  useEffect(() => {
    if (!handle.trim() || !me) { setAvailable(null); return; }
    const clean = handle.trim().toLowerCase().replace(/^@/, "");
    if (!/^[a-z0-9_]{3,20}$/.test(clean)) { setAvailable(false); return; }
    setChecking(true);
    const id = setTimeout(async () => {
      try {
        const ok = await isHandleAvailable(clean, me);
        setAvailable(ok);
      } catch { setAvailable(null); }
      finally { setChecking(false); }
    }, 350);
    return () => clearTimeout(id);
  }, [handle, me]);

  const submit = async () => {
    if (!me || !available) return;
    const clean = handle.trim().toLowerCase().replace(/^@/, "");
    setSaving(true); setErr(null);
    try {
      await updateMyProfile({
        data: {
          me,
          patch: {
            handle: clean,
            display_name: displayName.trim() || clean,
            bio: bio.trim() || null,
          },
        },
      });
      patchIdentity(me, {
        handle: clean,
        display_name: displayName.trim() || clean,
      });
      setOpen(false);
    } catch (e: any) {
      setErr(e?.message ?? "Could not save");
    } finally { setSaving(false); }
  };

  if (!open || !me) return null;
  const cleanHandle = handle.trim().toLowerCase().replace(/^@/, "");
  const canSubmit = available === true && !saving;

  return (
    <div className="fixed inset-0 z-[65] grid place-items-center px-3">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-md" />
      <div
        className="relative w-full max-w-md rounded-3xl bg-background border border-white/10 p-6 overflow-hidden"
        style={{ boxShadow: "0 30px 80px rgba(0,0,0,0.8)" }}
      >
        {/* Top sheen */}
        <div className="absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

        <div className="size-12 rounded-2xl bg-primary/15 text-primary grid place-items-center">
          <AtSign className="size-5" />
        </div>
        <h2 className="text-xl font-bold mt-4">Set up your profile</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Pick a username so others can find, follow, and @-mention you.
        </p>

        <div className="space-y-3 mt-5">
          {/* Handle */}
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-bold">Username</span>
            <div className="mt-1 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
              <input
                autoFocus
                value={handle}
                onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                placeholder="degen"
                maxLength={20}
                className="w-full h-11 rounded-xl bg-white/5 pl-7 pr-10 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2">
                {checking ? <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  : available === true ? <Check className="size-4 text-up" />
                  : available === false ? <X className="size-4 text-down" />
                  : null}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 leading-snug px-1">
              {cleanHandle.length === 0
                ? "3-20 characters · letters, numbers, and underscores only"
                : available === false && !/^[a-z0-9_]{3,20}$/.test(cleanHandle)
                ? "Invalid format. Letters/numbers/underscore, 3-20 chars."
                : available === false
                ? `@${cleanHandle} is taken — try another`
                : available === true
                ? `Nice — @${cleanHandle} is yours`
                : "Checking availability…"}
            </p>
          </label>

          {/* Display name */}
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-bold">Display name</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={cleanHandle || "Your name"}
              maxLength={40}
              className="mt-1 w-full h-11 rounded-xl bg-white/5 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </label>

          {/* Bio */}
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-bold">Bio · optional</span>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 160))}
              placeholder="Onchain trader. Degens for fun."
              rows={2}
              className="mt-1 w-full rounded-xl bg-white/5 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <p className="text-[10px] text-muted-foreground text-right tabular-nums">{160 - bio.length}</p>
          </label>

          {err && <p className="text-xs text-down">{err}</p>}

          <button
            onClick={submit}
            disabled={!canSubmit}
            className="w-full h-12 rounded-xl lit-purple text-sm font-bold disabled:opacity-40"
          >
            {saving ? "Saving…" : "Complete profile"}
          </button>

          <p className="text-[10px] text-muted-foreground text-center">
            You can edit any of this later from your profile page.
          </p>
        </div>
      </div>
    </div>
  );
}
