import { useRef, useState } from "react";
import { Camera, Download, Share2, Twitter, X } from "lucide-react";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import { APP_NAME } from "@/lib/brand";

// html-to-image must re-fetch every <img> in the card; cross-origin hosts
// without CORS headers make that fetch throw and kill the export. Swap each
// remote image for a data URL (fetched through our server proxy) first.
async function inlineRemoteImages(root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(imgs.map(async (img) => {
    const src = img.getAttribute("src") ?? "";
    if (!/^https?:\/\//i.test(src)) return;               // already inline/data:
    if (src.startsWith(location.origin)) return;          // same-origin is fine
    if (img.dataset.inlined === "1") return;
    try {
      const { proxyImageAsDataUrl } = await import("@/lib/image-proxy");
      const { dataUrl } = await proxyImageAsDataUrl({ data: { url: src } });
      if (dataUrl) {
        img.src = dataUrl;
        img.dataset.inlined = "1";
      } else {
        // Proxy couldn't fetch it — drop the image rather than failing the
        // whole capture.
        img.style.visibility = "hidden";
      }
    } catch {
      img.style.visibility = "hidden";
    }
  }));
}

type Props = {
  open: boolean;
  onClose: () => void;
  symbol: string;
  tokenImage?: string | null;
  side?: "Long" | "Short" | "Buy" | "Sell";
  /** The trader's profile picture — shown in the avatar circle. */
  pfp?: string | null;
  pnlUsd?: number;
  pnlPct?: number;
  multiplier?: number;
  entry?: string;
  exit?: string;
  /** Total USD put into the position (cost basis of what was sold). */
  investedUsd?: number;
  /** Total USD realized on the way out (proceeds of the sell). */
  soldUsd?: number;
  holdingTime?: string;
  handle?: string;
  address?: string;
};

const fmtUsd = (n: number) =>
  `$${Math.abs(n).toLocaleString("en-US", {
    maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2,
    minimumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2,
  })}`;

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
      await inlineRemoteImages(ref.current);
      let dataUrl: string;
      try {
        dataUrl = await toPng(ref.current, {
          pixelRatio: 2.5,
          cacheBust: true,
          backgroundColor: "#030006",
        });
      } catch {
        // Some browsers choke on webfont embedding — retry without fonts
        // rather than failing the download outright.
        dataUrl = await toPng(ref.current, {
          pixelRatio: 2.5,
          cacheBust: true,
          backgroundColor: "#030006",
          skipFonts: true,
        });
      }
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `trench-${p.symbol}-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.warn("[pnl-card] PNG export failed", e);
      toast.error("Couldn't save the image — try again.");
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
            aspectRatio: "1.91 / 1",
            borderRadius: 28,
            background: "linear-gradient(118deg, #07010d 0%, #0a0214 52%, #1c0533 100%)",
            border: "2px solid #7c3aed",
            boxShadow: "0 0 0 1px rgba(216,180,254,0.35) inset, 0 0 44px rgba(124,58,237,0.5)",
          }}
        >
          {/* Ambient glows — one behind the trooper, one behind the % */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(circle at 84% 78%, rgba(168,85,247,0.4), transparent 34%), radial-gradient(circle at 12% 18%, rgba(88,28,135,0.45), transparent 42%)",
            }}
          />

          {/* Content */}
          <div className="absolute inset-0 flex flex-col" style={{ padding: "5% 5.5%" }}>
            {/* Header: pair on the left, brand on the right */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                {(p.pfp ?? p.tokenImage) ? (
                  <img
                    src={(p.pfp ?? p.tokenImage)!}
                    alt={p.handle ?? p.symbol}
                    crossOrigin="anonymous"
                    className="size-10 rounded-full object-cover ring-2 ring-white/20"
                  />
                ) : (
                  <div className="size-10 rounded-full grid place-items-center bg-[#d4537e] ring-2 ring-white/20 text-[12px] font-black text-white">
                    {(p.handle ?? p.symbol).slice(0, 3).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-[24px] sm:text-[28px] font-black tracking-tight text-white leading-none">
                    {p.symbol}<span className="text-white/40">/MON</span>
                  </p>
                  {p.side && (
                    <p className="text-[10px] uppercase tracking-[0.22em] text-white/40 mt-1.5">
                      {p.side === "Sell" ? "Position closed" : p.side}
                    </p>
                  )}
                </div>
              </div>
              <span className="text-[15px] font-bold tracking-tight text-white/55">
                {APP_NAME}
              </span>
            </div>

            {/* Headline % + realized PnL */}
            <div className="mt-3">
              <p
                className="font-black tracking-tight leading-none"
                style={{
                  fontSize: "clamp(44px, 7.5vw, 64px)",
                  color: up ? "#4ade80" : "#f87171",
                  textShadow: up
                    ? "0 0 26px rgba(74,222,128,0.42)"
                    : "0 0 26px rgba(248,113,113,0.42)",
                }}
              >
                {up ? "+" : ""}{headline.replace(/^\+/, "")}
              </p>
              <div className="flex items-center gap-3 mt-2">
                {p.pnlUsd != null && (
                  <span className={`text-[19px] font-black ${up ? "text-up" : "text-down"}`}>
                    {up ? "+" : "-"}{fmtUsd(p.pnlUsd)}
                  </span>
                )}
                {p.holdingTime && (
                  <span className="text-[12px] text-white/50">
                    held {p.holdingTime}
                  </span>
                )}
              </div>
            </div>

            {/* Stats — invested vs what came out */}
            <div className="mt-auto flex items-end gap-7">
              {p.investedUsd != null && (
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/45 whitespace-nowrap">Invested</p>
                  <p className="text-[19px] font-black font-mono text-white mt-0.5">{fmtUsd(p.investedUsd)}</p>
                </div>
              )}
              {p.soldUsd != null && (
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/45 whitespace-nowrap">Sold for</p>
                  <p className="text-[19px] font-black font-mono text-white mt-0.5">{fmtUsd(p.soldUsd)}</p>
                </div>
              )}
              {p.investedUsd == null && p.soldUsd == null && p.entry && (
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">Entry</p>
                  <p className="text-[19px] font-black font-mono text-white mt-0.5">{p.entry}</p>
                </div>
              )}
              {p.investedUsd == null && p.soldUsd == null && p.exit && (
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">Exit</p>
                  <p className="text-[19px] font-black font-mono text-white mt-0.5">{p.exit}</p>
                </div>
              )}
              <div className="ml-auto text-right">
                {(p.handle || p.address) && (
                  <p className="text-[11px] text-white/45 font-mono">
                    {p.handle ? `@${p.handle}` : `${p.address!.slice(0, 6)}…${p.address!.slice(-4)}`}
                  </p>
                )}
                <p className="text-[10px] text-white/30 mt-0.5">{APP_NAME}</p>
              </div>
            </div>
          </div>
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
