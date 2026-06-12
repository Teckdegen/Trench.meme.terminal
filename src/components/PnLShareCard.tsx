import { useRef, useState } from "react";
import { Camera, Download, Share2, Twitter, X } from "lucide-react";
import { toPng } from "html-to-image";
import { APP_NAME, APP_TROOPER } from "@/lib/brand";

type Props = {
  open: boolean;
  onClose: () => void;
  symbol: string;
  tokenImage?: string | null;
  side?: "Long" | "Short" | "Buy" | "Sell";
  pnlUsd?: number;
  pnlPct?: number;
  multiplier?: number;
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
  const headline = p.multiplier && p.multiplier >= 2
    ? `${p.multiplier.toFixed(2)}x`
    : `${up ? "+" : ""}${pct.toFixed(0)}%`;

  const download = async () => {
    if (!ref.current) return;
    setBusy(true);
    try {
      const dataUrl = await toPng(ref.current, {
        pixelRatio: 2.5,
        cacheBust: true,
        backgroundColor: "#030006",
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `trench-${p.symbol}-${Date.now()}.png`;
      a.click();
    } finally {
      setBusy(false);
    }
  };

  const shareTwitter = () => {
    const text = encodeURIComponent(`${headline} on $${p.symbol}\nvia ${APP_NAME}`);
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
      <button className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={p.onClose} aria-label="Close" />

      <div className="relative w-full max-w-[780px]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Share trade</h3>
          <button onClick={p.onClose} className="size-9 grid place-items-center rounded-full bg-white/8 hover:bg-white/12">
            <X className="size-4" />
          </button>
        </div>

        <div
          ref={ref}
          className="relative overflow-hidden"
          style={{
            aspectRatio: "2.72 / 1",
            borderRadius: 34,
            background: "linear-gradient(105deg, #030006 0%, #05000a 58%, #17002c 100%)",
            border: "3px solid #7c3aed",
            boxShadow: "0 0 0 1px rgba(216,180,254,0.55) inset, 0 0 50px rgba(124,58,237,0.62)",
          }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(circle at 74% 50%, rgba(168,85,247,0.52), transparent 28%), radial-gradient(circle at 92% 52%, rgba(88,28,135,0.56), transparent 38%)",
            }}
          />

          <div
            className="absolute overflow-hidden"
            style={{
              left: "4.5%",
              top: "14%",
              width: "70%",
              height: "72%",
              borderRadius: 10,
              border: "1px solid rgba(216,180,254,0.82)",
              background: "linear-gradient(90deg, #000 0%, #020004 72%, rgba(88,28,135,0.22) 100%)",
              boxShadow: "0 0 24px rgba(168,85,247,0.24) inset",
            }}
          >
            <img
              src={APP_TROOPER}
              alt="trench"
              crossOrigin="anonymous"
              className="absolute"
              style={{
                left: "4%",
                bottom: "6%",
                height: "86%",
                width: "34%",
                objectFit: "contain",
                objectPosition: "left bottom",
                imageRendering: "pixelated" as any,
              }}
            />

            <div
              className="absolute left-0 right-0 text-center text-white/45 font-semibold tracking-tight"
              style={{ bottom: "-1px", fontSize: 18, textShadow: "0 2px 8px #000" }}
            >
              {APP_NAME}
            </div>
          </div>

          <div className="absolute right-[5%] top-[13%] flex items-center gap-2">
            <span className="text-[32px] sm:text-[40px] font-black tracking-tight text-white leading-none">
              ${p.symbol}
            </span>
            {p.tokenImage && (
              <img
                src={p.tokenImage}
                alt={p.symbol}
                crossOrigin="anonymous"
                className="size-9 rounded-full object-cover ring-2 ring-white/25"
              />
            )}
          </div>

          <div className="absolute right-[5%] text-right" style={{ top: "38%" }}>
            <p
              className="font-black tracking-tight leading-none"
              style={{
                fontSize: "clamp(72px, 12vw, 122px)",
                color: up ? "#4ade80" : "#f87171",
                textShadow: up
                  ? "0 0 30px rgba(74,222,128,0.48)"
                  : "0 0 30px rgba(248,113,113,0.48)",
              }}
            >
              {up ? "+" : ""}{headline.replace(/^\+/, "")}
            </p>

            {p.pnlUsd != null && (
              <p className={`mt-1 text-lg font-black ${up ? "text-up" : "text-down"}`}>
                {up ? "+" : "-"}${Math.abs(p.pnlUsd).toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </p>
            )}
          </div>

          {(p.entry || p.exit || p.holdingTime) && (
            <div className="absolute right-[5.5%] text-[11px] text-white/70 space-y-0.5 text-right" style={{ bottom: 30 }}>
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

          {(p.handle || p.address) && (
            <div className="absolute bottom-3 left-5 text-[9px] text-white/40 font-mono">
              {p.handle ? `@${p.handle}` : p.address}
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <button onClick={shareTwitter} className="h-[60px] rounded-3xl bg-white/[0.07] hover:bg-white/[0.11] text-base font-bold inline-flex items-center justify-center gap-2">
            <Twitter className="size-5" /> Tweet
          </button>
          <button onClick={shareNative} className="h-[60px] rounded-3xl bg-white/[0.07] hover:bg-white/[0.11] text-base font-bold inline-flex items-center justify-center gap-2">
            <Share2 className="size-5" /> Share
          </button>
          <button onClick={download} disabled={busy} className="h-[60px] rounded-3xl lit-purple text-base font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40">
            <Download className="size-5" /> {busy ? "Saving..." : "PNG"}
          </button>
        </div>
      </div>
    </div>
  );
}

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

let _setOpen: ((p: Props) => void) | null = null;
export function _registerPnLShareSink(fn: (p: Props) => void) { _setOpen = fn; }
export function autoShowPnLCard(p: Omit<Props, "open" | "onClose">) {
  _setOpen?.({ ...p, open: true, onClose: () => _setOpen?.({ ...p, open: false, onClose: () => {} }) });
}

export function PnLShareSink() {
  const [props, setProps] = useState<Props | null>(null);
  _registerPnLShareSink((p) => setProps(p));
  if (!props) return null;
  return <PnLShareCard {...props} onClose={() => setProps(null)} />;
}
