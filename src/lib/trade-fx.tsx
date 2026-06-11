// Trade sound effects + branded toasts.
//
//   * Buy  → ascending chirp + green-accent toast
//   * Sell → descending chirp + red-accent toast
//   * Fail → dull buzz + red-accent toast
//
// Toast layout: [accent icon] [brand logo] [title + description] [close]
// Matches the dark "Failed to buy CBANK" notification style.

import { toast } from "sonner";
import { APP_LOGO } from "@/lib/brand";

// ─────────────────────────── Audio ──────────────────────────────────
let _ctx: AudioContext | null = null;
function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (_ctx) return _ctx;
  try {
    const Ctor = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return null;
    _ctx = new Ctor();
    return _ctx;
  } catch { return null; }
}

function playChirp(freqs: number[], totalMs = 220, type: OscillatorType = "triangle", peakGain = 0.18) {
  const ac = ctx();
  if (!ac) return;
  try { ac.resume(); } catch {}
  const gain = ac.createGain();
  gain.connect(ac.destination);
  gain.gain.setValueAtTime(0.0001, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(peakGain, ac.currentTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + totalMs / 1000);
  const stepMs = totalMs / freqs.length;
  freqs.forEach((f, i) => {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const start = ac.currentTime + (i * stepMs) / 1000;
    const end = start + stepMs / 1000;
    o.connect(gain);
    o.start(start);
    o.stop(end + 0.02);
  });
}

export function playBuySound()  { playChirp([523.25, 783.99, 1046.50], 260); }    // C5 → G5 → C6
export function playSellSound() { playChirp([784.0, 523.25, 392.00], 260); }      // G5 → C5 → G4

// Failure: dissonant 2-tone buzz (tritone) then a short downstep —
// distinctively "wrong" without being annoying.
export function playFailSound() {
  const ac = ctx();
  if (!ac) return;
  try { ac.resume(); } catch {}
  const now = ac.currentTime;
  const gain = ac.createGain();
  gain.connect(ac.destination);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);

  const mk = (f: number, t: OscillatorType = "sawtooth") => {
    const o = ac.createOscillator();
    o.type = t; o.frequency.value = f;
    o.connect(gain);
    return o;
  };
  // Burst 1 — dissonant pair (A3 + D#4, a tritone), 110ms
  const a = mk(220);
  const b = mk(311.13);
  a.start(now); b.start(now);
  a.stop(now + 0.11); b.stop(now + 0.11);
  // Burst 2 — drop down, 180ms
  const c = mk(165, "square");
  c.start(now + 0.13); c.stop(now + 0.30);
}

let primed = false;
export function primeAudioOnFirstClick() {
  if (typeof window === "undefined" || primed) return;
  primed = true;
  const handler = () => {
    const ac = ctx();
    try { ac?.resume(); } catch {}
    window.removeEventListener("pointerdown", handler);
  };
  window.addEventListener("pointerdown", handler, { once: true });
}

// ─────────────────────── Custom toast layout ────────────────────────
type Kind = "buy" | "sell" | "fail";

function ToastCard({
  kind, title, description, txHash, dismiss,
}: { kind: Kind; title: string; description?: string; txHash?: string; dismiss: () => void }) {
  // Accent + icon per kind — pure inline SVG so no external icon import is
  // needed for a leaf rendering function.
  const accent =
    kind === "buy"  ? { ring: "rgba(34,197,94,0.35)",   text: "#86efac", bg: "rgba(34,197,94,0.10)",  iconBg: "#22c55e", glyph: "✓" }
    : kind === "sell" ? { ring: "rgba(168,85,247,0.35)", text: "#d8b4fe", bg: "rgba(168,85,247,0.10)", iconBg: "#a855f7", glyph: "↗" }
    : { ring: "rgba(239,68,68,0.35)", text: "#fecaca", bg: "rgba(239,68,68,0.10)", iconBg: "#ef4444", glyph: "✕" };

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12,
        minWidth: 320, maxWidth: 420,
        padding: "10px 12px",
        borderRadius: 14,
        background: "#0a0410",
        border: `1px solid ${accent.ring}`,
        boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Accent badge */}
      <div
        style={{
          width: 28, height: 28, borderRadius: 8,
          display: "grid", placeItems: "center",
          background: accent.iconBg, color: "#fff",
          fontWeight: 800, fontSize: 14, lineHeight: 1, flexShrink: 0,
        }}
      >
        {accent.glyph}
      </div>

      {/* Brand logo */}
      <img
        src={APP_LOGO} alt="trench.meme"
        style={{ width: 28, height: 28, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
      />

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", lineHeight: 1.2 }}>{title}</div>
        {description && (
          <div style={{ fontSize: 11, color: accent.text, marginTop: 2, lineHeight: 1.3 }}>
            {description}
          </div>
        )}
        {txHash && (
          <a
            href={`https://monadscan.xyz/tx/${txHash}`}
            target="_blank" rel="noreferrer"
            style={{ fontSize: 10, color: "#c4b5fd", fontFamily: "monospace", display: "inline-block", marginTop: 2 }}
          >
            {txHash.slice(0, 8)}…{txHash.slice(-6)}
          </a>
        )}
      </div>

      {/* Close */}
      <button
        onClick={dismiss}
        style={{
          width: 24, height: 24, borderRadius: 6,
          background: "transparent", color: "#9ca3af", border: 0, cursor: "pointer",
          display: "grid", placeItems: "center", flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}

// ─────────────────────── Public API ─────────────────────────────────
function fmt(amount: string | number, max = 4) {
  const n = Number(amount);
  if (!isFinite(n)) return String(amount);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(Math.min(max, n < 1 ? 6 : 4));
}

export function notifyTrade(input: {
  side: "buy" | "sell";
  symbol: string;
  amount?: number | string;
  usdValue?: number | string;
  txHash?: string;
}) {
  const verb = input.side === "buy" ? "Bought" : "Sold";
  const title = `${verb} ${input.symbol.startsWith("$") ? "" : "$"}${input.symbol}`;
  const desc = [
    input.amount != null ? `${fmt(input.amount)} ${input.symbol}` : null,
    input.usdValue != null ? `≈ $${Number(input.usdValue).toFixed(2)}` : null,
  ].filter(Boolean).join(" · ");

  if (input.side === "buy") playBuySound(); else playSellSound();

  toast.custom(
    (id) => (
      <ToastCard
        kind={input.side}
        title={title}
        description={desc || undefined}
        txHash={input.txHash}
        dismiss={() => toast.dismiss(id)}
      />
    ),
    { duration: 5000, position: "top-center" },
  );
}

export function notifyTradeFailed(input: {
  side: "buy" | "sell";
  symbol: string;
  reason: string;
}) {
  playFailSound();
  const verb = input.side === "buy" ? "Failed to buy" : "Failed to sell";
  toast.custom(
    (id) => (
      <ToastCard
        kind="fail"
        title={`${verb} ${input.symbol.startsWith("$") ? "" : "$"}${input.symbol}`}
        description={input.reason}
        dismiss={() => toast.dismiss(id)}
      />
    ),
    { duration: 6000, position: "top-center" },
  );
}
