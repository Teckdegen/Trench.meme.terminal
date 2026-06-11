// Shareable PnL card. Matches the screenshot:
//   * Thin purple glow border, pure black background, soft purple radial
//     on the right
//   * Trench.meme trooper image on the left
//   * Token name + small token logo top-right
//   * Big multiplier (e.g. "+247%" or "3.47x") below the name
//   * "via trench.meme" small footer
//
// Two entry points:
//   * <ShareTradeButton …/>  — drop on any trade row, opens modal w/ download
//   * autoShowPnLCard(...)   — fire after a sell to pop the modal automatically

import { useRef, useState } from "react";
import { Camera, Share2, Download, X, Twitter } from "lucide-react";
import { APP_TROOPER, APP_NAME } from "@/lib/brand";

type Props = {
  open: boolean;
  onClose: () => void;
  symbol: string;
  tokenImage?: string | null;
  side?: "Long" | "Short" | "Buy" | "Sell";
  pnlUsd?: number;
  pnlPct?: number;          // e.g. +247  → "+247%"
  multiplier?: number;       // e.g. 3.47  → "3.47x" (preferred over pct when ≥ 2x)
  entry?: string;
  exit?: string;
  holdingTime?: string;
  handle?: string;
  address?: string;
};

export function PnLShareCard(p: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  if (!p.open) return null;

  const pct = p.pnlPct ?? (p.multiplier ? (p.multiplier - 1) * 100 : 0);
  const up = pct >= 0;
  // Prefer "Nx" when the gain is >= 100%, else show the percent.
  const headline = p.multiplier && p.multiplier >= 2
    ? `${p.multiplier.toFixed(2)}x`
    : `${up ? "+" : ""}${pct.toFixed(0)}%`;

  const download = async () => {
    if (!ref.current) return;
    setBusy(true);
    try {
      const pkg = "html-to-image";
      const mod: any = await import(/* @vite-ignore */ pkg).catch(() => null);
      if (!mod) { alert("Install html-to-image: npm i html-to-image"); return; }
      const dataUrl = await mod.toPng(ref.current, { pixelRatio: 2, cacheBust: true });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `trench-${p.symbol}-${Date.now()}.png`;
      a.click();
    } finally { setBusy(false); }
  };

  const shareTwitter = () => {
    const text = encodeURIComponent(
      `${up ? "🟢" : "🔴"} ${headline} on $${p.symbol}\nvia ${APP_NAME}`,
    );
    window.open(`https://twitter.com/intent/tweet?text=${text}`, "_blank");
  };

  const shareNative = async () => {
    if (typeof navigator === "undefined" || !(navigator as any).share) return;
    try {
      await (navigator as any).share({
        title: `${headline} on $${p.symbol}`,
        text: `via ${APP_NAME}`,
        url: typeof location !== "undefined" ? location.href : "",
      });
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center px-3">
      <button className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={p.onClose} aria-label="Close" />
      <div className="relative w-full max-w-lg">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Share trade</h3>
          <button onClick={p.onClose} className="size-8 grid place-items-center rounded-full bg-white/5">
            <X className="size-4" />
          </button>
        </div>

        {/* The actual shareable card — 2.6:1 aspect to match the screenshot */}
        <div
          ref={ref}
          className="relative rounded-3xl overflow-hidden"
          style={{
            aspectRatio: "2.6 / 1",
            background: "#050008",
            border: "2px solid #6d28d9",
            boxShadow: "0 0 0 1px rgba(168,85,247,0.4), 0 0 40px -8px rgba(168,85,247,0.6)",
          }}
        >
          {/* Soft purple glow on the right */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "radial-gradient(ellipse at 80% 50%, rgba(126,34,206,0.55), transparent 55%)",
            }}
          />

          {/* Trooper — bottom-left, large */}
          <img
            src={APP_TROOPER}
            alt="trench"
            crossOrigin="anonymous"
            className="absolute"
            style={{
              left: "3%",
              bottom: 0,
              height: "92%",
              objectFit: "contain",
              objectPosition: "left bottom",
              imageRendering: "pixelated" as any,
            }}
          />

          {/* Token info — top right */}
          <div className="absolute top-5 right-6 flex items-center gap-2">
            <span className="text-2xl font-black tracking-tight text-white">
              ${p.symbol}
            </span>
            {p.tokenImage && (
              <img
                src={p.tokenImage}
                alt={p.symbol}
                crossOrigin="anonymous"
                className="size-7 rounded-full object-cover ring-1 ring-white/20"
              />
            )}
          </div>

          {/* Big multiplier — upper-right, right under the token name */}
          <div className="absolute right-6 text-right" style={{ top: "30%" }}>
            <p
              className="font-black tracking-tight leading-none"
              style={{
                fontSize: "min(7.5vw, 78px)",
                color: up ? "#4ade80" : "#f87171",
                textShadow: up
                  ? "0 0 30px rgba(74,222,128,0.45)"
                  : "0 0 30px rgba(248,113,113,0.45)",
              }}
            >
              {up ? "+" : ""}{headline.replace(/^\+/, "")}
            </p>
            {p.pnlUsd != null && (
              <p className={`mt-1 text-base font-bold ${up ? "text-up" : "text-down"}`}>
                {up ? "+" : ""}${Math.abs(p.pnlUsd).toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </p>
            )}
          </div>

          {/* Stats stacked below the multiplier — one per line */}
          {(p.entry || p.exit || p.holdingTime) && (
            <div className="absolute right-6 text-[11px] text-white/70 space-y-0.5 text-right"
                 style={{ bottom: 36 }}>
              {p.entry && (
                <div>
                  <span className="text-white/50">Entry </span>
                  <span className="font-mono text-white">{p.entry}</span>
                </div>
              )}
              {p.exit && (
                <div>
                  <span className="text-white/50">Exit </span>
                  <span className="font-mono text-white">{p.exit}</span>
                </div>
              )}
              {p.holdingTime && (
                <div>
                  <span className="text-white/50">Held </span>
                  <span className="text-white">{p.holdingTime}</span>
                </div>
              )}
            </div>
          )}

          {/* Footer — brand centered at the bottom */}
          <div className="absolute bottom-3 left-0 right-0 text-center text-[11px] text-white/60 font-semibold tracking-wide">
            {APP_NAME}
          </div>

          {/* Optional handle / address — tiny, bottom-left so it doesn't
              fight the centered brand */}
          {(p.handle || p.address) && (
            <div className="absolute bottom-3 left-5 text-[9px] text-white/40 font-mono">
              {p.handle ? `@${p.handle}` : ""}
            </div>
          )}
        </div>

        {/* Share row */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          <button onClick={shareTwitter} className="h-10 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold inline-flex items-center justify-center gap-1.5">
            <Twitter className="size-3.5" /> Tweet
          </button>
          <button onClick={shareNative} className="h-10 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold inline-flex items-center justify-center gap-1.5">
            <Share2 className="size-3.5" /> Share
          </button>
          <button onClick={download} disabled={busy} className="h-10 rounded-xl lit-purple text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-40">
            <Download className="size-3.5" /> {busy ? "Saving…" : "PNG"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Inline button you can drop next to any trade row
export function ShareTradeButton(props: Omit<Props, "open" | "onClose">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={(e) => { e.preventDefault(); setOpen(true); }}
        className="h-7 px-2 rounded-md bg-white/5 hover:bg-white/10 text-[11px] inline-flex items-center gap-1"
      >
        <Camera className="size-3" /> Share
      </button>
      <PnLShareCard {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// Imperative trigger — call from after a successful sell when you already
// know the PnL. Renders into a root portal-style div mounted in __root.
let _setOpen: ((p: Props) => void) | null = null;
export function _registerPnLShareSink(fn: (p: Props) => void) { _setOpen = fn; }
export function autoShowPnLCard(p: Omit<Props, "open" | "onClose">) {
  _setOpen?.({ ...p, open: true, onClose: () => _setOpen?.({ ...p, open: false, onClose: () => {} }) });
}

// Singleton sink — mount once at app root so `autoShowPnLCard()` always
// has somewhere to render.
export function PnLShareSink() {
  const [props, setProps] = useState<Props | null>(null);
  _registerPnLShareSink((p) => setProps(p));
  if (!props) return null;
  return <PnLShareCard {...props} onClose={() => setProps(null)} />;
}
