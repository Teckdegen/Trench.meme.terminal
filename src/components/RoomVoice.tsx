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
import { Mic, MicOff, Headphones, VolumeX, Hand } from "lucide-react";
import { agoraToken } from "@/lib/agora";

type Remote = { uid: number | string; audio: boolean; speaking: boolean; muted: boolean };

export function RoomVoice({
  roomId, identity, onLeave,
}: { roomId: string; identity: string; onLeave?: () => void }) {
  const clientRef = useRef<any>(null);
  const localTrackRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(true);          // mic muted
  const [deafened, setDeafened] = useState(false);   // incoming audio muted
  const [meSpeaking, setMeSpeaking] = useState(false);
  const [handUp, setHandUp] = useState(false);
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const [err, setErr] = useState<string | null>(null);

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

  return (
    <div className="border-t border-white/10">
      {/* Participant tiles — Discord-style grid */}
      <div className="px-3 pt-3 pb-2 flex flex-wrap gap-2">
        <Tile label={shortAddr(identity)} muted={muted} speaking={meSpeaking} self handUp={handUp} />
        {remotes.map((r) => (
          <Tile key={r.uid} label={shortAddr(String(r.uid))} muted={r.muted} speaking={r.speaking} />
        ))}
      </div>

      {/* Control bar */}
      <div className="px-3 pb-3 flex items-center gap-2">
        <CtrlButton
          active={!muted}
          onClick={toggleMute}
          disabled={!ready || deafened}
          icon={muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          label={muted ? "Unmute" : "Mute"}
        />
        <CtrlButton
          active={!deafened}
          danger={deafened}
          onClick={toggleDeafen}
          disabled={!ready}
          icon={deafened ? <VolumeX className="size-4" /> : <Headphones className="size-4" />}
          label={deafened ? "Undeafen" : "Deafen"}
        />
        <CtrlButton
          active={handUp}
          onClick={() => setHandUp((v) => !v)}
          disabled={!ready}
          icon={<Hand className="size-4" />}
          label="Raise hand"
        />
        <div className="flex-1 text-[11px] text-muted-foreground text-right">
          {ready ? (
            <>
              {remotes.length + 1} in voice
              <span className="ml-2 hidden sm:inline opacity-60">· hold Space to talk</span>
            </>
          ) : "Joining…"}
        </div>
        {onLeave && (
          <button
            onClick={onLeave}
            className="h-9 px-3 rounded-full bg-down/20 text-down text-[11px] font-semibold"
          >
            Leave
          </button>
        )}
      </div>
    </div>
  );
}

function Tile({
  label, muted, speaking, self, handUp,
}: { label: string; muted: boolean; speaking: boolean; self?: boolean; handUp?: boolean }) {
  return (
    <div
      className="relative flex flex-col items-center gap-1 p-2 rounded-xl bg-white/5 transition-all"
      style={{
        boxShadow: speaking && !muted ? "0 0 0 2px rgb(34 197 94)" : "0 0 0 2px transparent",
        minWidth: 64,
      }}
    >
      <div className="size-10 rounded-full bg-primary/15 text-primary grid place-items-center text-[10px] font-bold uppercase">
        {label.slice(0, 2)}
      </div>
      <span className="text-[10px] font-mono opacity-80 truncate max-w-[60px]">
        {self ? "You" : label}
      </span>
      {muted && (
        <span className="absolute -top-1 -right-1 size-5 rounded-full bg-down grid place-items-center">
          <MicOff className="size-2.5 text-white" />
        </span>
      )}
      {handUp && (
        <span className="absolute -top-1 -left-1 size-5 rounded-full bg-primary grid place-items-center">
          <Hand className="size-2.5 text-white" />
        </span>
      )}
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
      className={`size-10 grid place-items-center rounded-full disabled:opacity-40 transition-colors ${
        danger ? "bg-down text-white"
          : active ? "bg-up text-background"
          : "bg-white/5 hover:bg-white/10"
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
