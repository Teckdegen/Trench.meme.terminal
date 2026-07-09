// Agora-powered voice room with Discord-style controls.
//
// Browser flow:
//   1. Hit our server fn `agoraToken({ roomId, uid })`
//   2. Initialize an AgoraRTC client
//   3. Join the channel with the returned token + app id
//   4. Publish a mic track (muted by default), subscribe to everyone else
//   5. Track audio-volume-indicator so we can show who's speaking (green glow)
//   6. Render: participant tiles + mute + deafen + push-to-talk (hold Space)

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Headphones, VolumeX, Hand, PhoneOff, MicOff as MuteAllIcon } from "lucide-react";
import { agoraToken } from "@/lib/agora";
import { setCabalHand, useCabalHands, muteAllCabal, useCabalMuteAll } from "@/lib/cabal";

type Remote = { uid: number | string; audio: boolean; speaking: boolean; muted: boolean };

// Same wallet→uid hash the token server uses, so we can map raised-hand
// signals (keyed by address) back to Agora participant tiles (keyed by uid).
function walletToUid(addr: string): number {
  let h = 0;
  const s = addr.toLowerCase();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h & 0x7fffffff) || 1;
}

function recoverFromStaleChunk(error: unknown) {
  if (typeof window === "undefined") return false;
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!/dynamically imported module|failed to fetch/i.test(message)) return false;
  const key = "trench.voice.chunk_reload";
  const last = Number(sessionStorage.getItem(key) ?? 0);
  if (Date.now() - last < 30_000) return false;
  sessionStorage.setItem(key, String(Date.now()));
  window.location.reload();
  return true;
}

export function RoomVoice({
  roomId, identity, onLeave, isAdmin,
}: { roomId: string; identity: string; onLeave?: () => void; isAdmin?: boolean }) {
  const clientRef = useRef<any>(null);
  const localTrackRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(true);          // mic muted
  const [deafened, setDeafened] = useState(false);   // incoming audio muted
  const [meSpeaking, setMeSpeaking] = useState(false);
  const [handUp, setHandUp] = useState(false);
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // Cross-client call control (raise hand + admin mute-all) over cabal realtime.
  const raisedHands = useCabalHands(roomId);                 // addresses with hand up
  const handUidSet = new Set(raisedHands.map(walletToUid));  // → Agora uids
  const muteAllTs = useCabalMuteAll(roomId);
  const seenMute = useRef<number | null>(null);

  const toggleHand = () => {
    setHandUp((v) => {
      const next = !v;
      void setCabalHand(roomId, identity, next);
      return next;
    });
  };

  // Broadcast an admin "mute everyone" and drop our own hands on unmount.
  useEffect(() => () => { void setCabalHand(roomId, identity, false); }, [roomId, identity]);

  // React to admin mute-all: baseline the current signal on join, then force
  // our mic muted on any later bump (admins are exempt — they run it).
  useEffect(() => {
    if (!ready) return;
    if (seenMute.current === null) { seenMute.current = muteAllTs; return; }
    if (muteAllTs > seenMute.current) {
      seenMute.current = muteAllTs;
      if (!isAdmin) {
        localTrackRef.current?.setMuted(true);
        setMuted(true);
      }
    }
  }, [muteAllTs, ready, isAdmin]);

  // Join on mount, leave on unmount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: AgoraRTC } = await import("agora-rtc-sdk-ng");
        const t = await agoraToken({ data: { roomId, uid: identity } });
        if (cancelled) return;
        if (!t.appId) throw new Error("Agora not configured");

        const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        clientRef.current = client;

        client.on("user-published", async (user, mediaType) => {
          await client.subscribe(user, mediaType);
          if (mediaType === "audio") {
            user.audioTrack?.play();
            setRemotes((s) => {
              const without = s.filter((r) => r.uid !== user.uid);
              return [...without, { uid: user.uid, audio: true, speaking: false, muted: false }];
            });
          }
        });
        client.on("user-unpublished", (user) => {
          setRemotes((s) => s.map((r) => r.uid === user.uid ? { ...r, muted: true, speaking: false } : r));
        });
        client.on("user-left", (user) => {
          setRemotes((s) => s.filter((r) => r.uid !== user.uid));
        });

        // Speaker indicator — Agora emits one event per ~2 active speakers
        client.enableAudioVolumeIndicator();
        client.on("volume-indicator", (volumes: Array<{ uid: number | string; level: number }>) => {
          const SPEAK_THRESHOLD = 5;
          for (const v of volumes) {
            const speaking = v.level >= SPEAK_THRESHOLD;
            if (v.uid === 0 || v.uid === client.uid) {
              setMeSpeaking(speaking);
            } else {
              setRemotes((s) => s.map((r) => r.uid === v.uid ? { ...r, speaking } : r));
            }
          }
        });

        await client.join(t.appId, t.channel, t.token, t.uid);

        // Create the mic track but keep it muted until the user clicks
        const mic = await AgoraRTC.createMicrophoneAudioTrack();
        await mic.setMuted(true);
        await client.publish([mic]);
        localTrackRef.current = mic;
        setReady(true);
      } catch (e: any) {
        if (recoverFromStaleChunk(e)) return;
        setErr(e?.message ?? "Failed to join voice");
      }
    })();

    return () => {
      cancelled = true;
      const mic = localTrackRef.current;
      const client = clientRef.current;
      try { mic?.stop(); mic?.close(); } catch {}
      client?.leave().catch(() => {});
    };
  }, [roomId, identity]);

  const toggleMute = async () => {
    const mic = localTrackRef.current;
    if (!mic) return;
    const next = !muted;
    await mic.setMuted(next);
    setMuted(next);
  };

  // Deafen: mute every remote audio track + force-mute local mic (so others
  // know you can't hear them — Discord parity).
  const toggleDeafen = async () => {
    const client = clientRef.current;
    if (!client) return;
    const next = !deafened;
    setDeafened(next);
    for (const user of (client.remoteUsers ?? [])) {
      try {
        if (next) user.audioTrack?.stop();
        else user.audioTrack?.play();
      } catch {}
    }
    // Deafening also mutes the mic (matches Discord)
    if (next && !muted) await toggleMute();
  };

  // Push-to-talk: hold Space to unmute. Releases the key re-mutes.
  // Skipped when focus is in an input/textarea so chat doesn't trigger it.
  useEffect(() => {
    if (!ready) return;
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    };
    const down = async (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || isTyping()) return;
      e.preventDefault();
      const mic = localTrackRef.current;
      if (!mic || !muted) return;
      await mic.setMuted(false);
      setMuted(false);
    };
    const up = async (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTyping()) return;
      const mic = localTrackRef.current;
      if (!mic || muted) return;
      await mic.setMuted(true);
      setMuted(true);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [ready, muted]);

  if (err) return <p className="text-xs text-down px-3 py-2">{err}</p>;

  const count = remotes.length + 1;

  // Telegram-style call screen: header, centered circular participant grid with
  // speaking rings, then a floating pill control bar. All in the trench theme.
  return (
    <div className="flex flex-col flex-1 min-h-0"
      style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.14), transparent 60%), #0a0612" }}>

      {/* Header */}
      <div className="shrink-0 flex items-center justify-center gap-2 pt-4 pb-2">
        <span className="relative flex size-2">
          <span className={`absolute inline-flex h-full w-full rounded-full ${ready ? "bg-up animate-ping opacity-60" : "bg-muted-foreground"}`} />
          <span className={`relative inline-flex size-2 rounded-full ${ready ? "bg-up" : "bg-muted-foreground"}`} />
        </span>
        <span className="text-xs font-semibold text-muted-foreground">
          {ready
            ? `Voice · ${count} ${count === 1 ? "person" : "people"}${raisedHands.length > 0 ? ` · ✋ ${raisedHands.length}` : ""}`
            : "Joining…"}
        </span>
      </div>

      {/* Participant grid */}
      <div className="flex-1 min-h-0 overflow-y-auto grid place-items-center px-4 py-3">
        <div className="flex flex-wrap items-start justify-center gap-x-5 gap-y-4 max-w-md">
          <Tile label={shortAddr(identity)} muted={muted} speaking={meSpeaking && !muted} self handUp={handUp} />
          {remotes.map((r) => (
            <Tile key={r.uid} label={shortAddr(String(r.uid))} muted={r.muted} speaking={r.speaking}
              handUp={handUidSet.has(Number(r.uid))} />
          ))}
        </div>
      </div>

      {/* Floating pill control bar */}
      <div className="shrink-0 flex justify-center pb-4 pt-1">
        <div className="flex items-center gap-2 px-3 py-2 rounded-full"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }}>
          <CtrlButton
            active={!muted}
            onClick={toggleMute}
            disabled={!ready || deafened}
            icon={muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
            label={muted ? "Unmute" : "Mute"}
          />
          <CtrlButton
            active={!deafened}
            danger={deafened}
            onClick={toggleDeafen}
            disabled={!ready}
            icon={deafened ? <VolumeX className="size-5" /> : <Headphones className="size-5" />}
            label={deafened ? "Undeafen" : "Deafen"}
          />
          <CtrlButton
            active={handUp}
            onClick={toggleHand}
            disabled={!ready}
            icon={<Hand className="size-5" />}
            label="Raise hand"
          />
          {isAdmin && (
            <button
              onClick={() => void muteAllCabal(roomId)}
              disabled={!ready}
              title="Mute everyone"
              aria-label="Mute everyone"
              className="size-11 grid place-items-center rounded-full bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-40"
            >
              <MuteAllIcon className="size-5" />
            </button>
          )}
          {onLeave && (
            <button
              onClick={onLeave}
              title="Leave call"
              aria-label="Leave call"
              className="size-11 grid place-items-center rounded-full bg-down text-white transition-transform active:scale-95"
              style={{ boxShadow: "0 4px 14px rgba(239,68,68,0.4)" }}
            >
              <PhoneOff className="size-5" />
            </button>
          )}
        </div>
      </div>
      <p className="shrink-0 text-center text-[10px] text-muted-foreground/60 pb-2 hidden sm:block">
        Hold Space to talk
      </p>
    </div>
  );
}

function Tile({
  label, muted, speaking, self, handUp,
}: { label: string; muted: boolean; speaking: boolean; self?: boolean; handUp?: boolean }) {
  return (
    <div className="relative flex flex-col items-center gap-1.5" style={{ width: 76 }}>
      <div className="relative">
        {/* Speaking ring — purple glow that pulses while talking */}
        <div
          className="size-16 rounded-full grid place-items-center text-sm font-bold uppercase transition-all"
          style={{
            background: "linear-gradient(135deg, rgba(168,85,247,0.25), rgba(109,40,217,0.25))",
            color: "#c4b5fd",
            boxShadow: speaking
              ? "0 0 0 3px #a855f7, 0 0 22px rgba(168,85,247,0.55)"
              : "0 0 0 2px rgba(255,255,255,0.06)",
          }}
        >
          {label.slice(0, 2)}
        </div>
        {muted && (
          <span className="absolute -bottom-0.5 -right-0.5 size-6 rounded-full bg-down grid place-items-center ring-2 ring-[#0a0612]">
            <MicOff className="size-3 text-white" />
          </span>
        )}
        {handUp && (
          <span className="absolute -top-0.5 -left-0.5 size-6 rounded-full bg-primary grid place-items-center ring-2 ring-[#0a0612]">
            <Hand className="size-3 text-white" />
          </span>
        )}
      </div>
      <span className="text-[11px] font-mono opacity-80 truncate max-w-[74px]">
        {self ? "You" : label}
      </span>
    </div>
  );
}

function CtrlButton({
  icon, label, onClick, active, danger, disabled,
}: {
  icon: React.ReactNode; label: string; onClick: () => void;
  active?: boolean; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`size-11 grid place-items-center rounded-full disabled:opacity-40 transition-colors ${
        danger ? "bg-down text-white"
          : active ? "bg-primary text-primary-foreground"
          : "bg-white/8 hover:bg-white/15 text-foreground"
      }`}
    >
      {icon}
    </button>
  );
}

function shortAddr(s: string) {
  if (!s) return "??";
  if (s.length <= 8) return s;
  return s.slice(0, 4) + "…" + s.slice(-4);
}
