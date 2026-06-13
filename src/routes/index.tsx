// Marketing landing page. The trading terminal lives at /meme — this page
// is public (no login gate) and renders full-bleed OVER the app chrome via
// a fixed container, so the sidebar/topbar/bubbles never peek through.

import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, Dices, TrendingUp } from "lucide-react";
import { APP_NAME, APP_LOGO } from "@/lib/brand";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const LANDING_BG =
  "https://www.image2url.com/r2/default/images/1781284346702-ef70b66f-8264-40da-b3fa-3215a77f7153.jpg";

export const Route = createFileRoute("/")({ component: Landing });

function Landing() {
  useDocumentTitle(null);
  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto bg-black"
      style={{
        backgroundImage: `url(${LANDING_BG})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Darken the photo so the type carries the page */}
      <div className="absolute inset-0 bg-black/55" />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 30% 10%, rgba(168,85,247,0.22), transparent 55%), linear-gradient(to bottom, rgba(0,0,0,0.25), rgba(0,0,0,0.7))",
        }}
      />

      <div className="relative flex flex-col min-h-full">
        {/* Top bar — logo left, App button right */}
        <header className="flex items-center justify-between px-6 sm:px-10 py-6">
          <div className="flex items-center gap-2.5">
            <img src={APP_LOGO} alt={APP_NAME} className="size-8 rounded-lg object-cover" />
            <span className="text-white font-bold text-xl tracking-tight">{APP_NAME}</span>
          </div>
          {/* Plain <a>, not router Link — entering the app does a full page
              load so the terminal boots completely fresh. */}
          <a
            href="/meme"
            className="h-11 px-6 rounded-full bg-[#a855f7] hover:bg-[#9333ea] text-white text-sm font-bold inline-flex items-center gap-1.5 transition-colors"
            style={{ boxShadow: "0 8px 30px rgba(168,85,247,0.45)" }}
          >
            App <ArrowUpRight className="size-4" />
          </a>
        </header>

        {/* ── Section 1: Hero ── */}
        <main className="min-h-[68vh] grid place-items-center px-5 py-16">
          <div className="max-w-4xl text-center">
            <h1
              className="font-black tracking-tight leading-[1.12] text-[#d6d3d1]"
              style={{ fontSize: "clamp(36px, 5.5vw, 76px)" }}
            >
              The most <span className="text-[#a855f7]">powerful</span> way to
              trade the trenches.
            </h1>
            <p className="mt-6 text-[#d6d3d1] text-lg sm:text-2xl leading-relaxed max-w-2xl mx-auto">
              <span className="font-bold text-white">Trench the odds</span>
            </p>
            <div className="mt-10 flex items-center justify-center gap-3">
              <a
                href="/meme"
                className="px-8 py-3.5 rounded-full bg-[#a855f7] hover:bg-[#9333ea] text-white text-base font-bold inline-flex items-center gap-2 transition-colors"
                style={{ boxShadow: "0 10px 40px rgba(168,85,247,0.5)" }}
              >
                Start trading <ArrowUpRight className="size-5" />
              </a>
            </div>
          </div>
        </main>

        {/* ── Section 2: Dawn style rows — pure vibes, no feature lists ── */}
        <section className="px-5 sm:px-10 py-20 bg-black/75 backdrop-blur-sm">
          <h2
            className="text-center font-black tracking-tight leading-tight text-[#d6d3d1]"
            style={{ fontSize: "clamp(26px, 3.6vw, 44px)" }}
          >
            The <span className="text-[#a855f7] italic">degen</span> way
            <br className="hidden sm:block" /> to play.
          </h2>

          <div className="mt-12 max-w-4xl mx-auto rounded-3xl border border-white/10 overflow-hidden divide-y divide-white/10">
            <VibeRow
              chip="The trenches"
              title="Trade the memes"
              body="Every token on Monad, the moment it exists."
              panel={<PanelTerminal />}
            />
            <VibeRow
              chip="The casino"
              title="PvP everything"
              body="Dice, roulette, crash, poker. You against other degens. Never the house."
              panel={<PanelCasino />}
            />
            <VibeRow
              chip="The pot"
              title="Winner takes it all"
              body="Every payout comes straight from the pool. We just run the table."
              panel={<PanelPot />}
            />
          </div>
        </section>

        {/* ── Section 3: Two doors ── */}
        <section className="px-5 sm:px-10 pb-20 bg-black/75">
          <div className="max-w-4xl mx-auto grid sm:grid-cols-2 gap-5">
            <a
              href="/meme"
              className="group rounded-3xl border border-white/10 bg-[#0a0511]/90 p-8 hover:border-[#a855f7]/60 transition-colors"
              style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
            >
              <span className="size-12 rounded-2xl bg-[#a855f7]/20 grid place-items-center">
                <TrendingUp className="size-6 text-[#c084fc]" />
              </span>
              <h2 className="mt-5 text-white font-black text-2xl tracking-tight">
                Trade memes
              </h2>
              <p className="mt-2 text-sm text-[#a8a29e] leading-relaxed">
                Every token on Monad, live in one terminal.
              </p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-[#c084fc] group-hover:text-white transition-colors">
                Enter the trenches <ArrowUpRight className="size-4" />
              </span>
            </a>

            <div
              className="rounded-3xl border border-white/10 bg-[#0a0511]/90 p-8"
              style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
            >
              <span className="size-12 rounded-2xl bg-[#a855f7]/20 grid place-items-center">
                <Dices className="size-6 text-[#c084fc]" />
              </span>
              <h2 className="mt-5 text-white font-black text-2xl tracking-tight">
                Trench the odds
              </h2>
              <p className="mt-2 text-sm text-[#a8a29e] leading-relaxed">
                PvP casino. Winner takes the pot.
              </p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-[#a855f7]/20 text-[#c084fc]">
                Coming soon
              </span>
            </div>
          </div>
        </section>

        {/* Footer strip */}
        <footer className="mt-auto px-6 sm:px-10 py-6 flex items-center justify-between text-[12px] text-white/40 bg-black/75">
          <span>© {new Date().getFullYear()} {APP_NAME}</span>
          <span>Built on Monad</span>
        </footer>
      </div>
    </div>
  );
}

// ─────────────── Section 2 building blocks ──────────────────────────────

function VibeRow({
  chip, title, body, panel,
}: { chip: string; title: string; body: string; panel: React.ReactNode }) {
  return (
    <div className="grid md:grid-cols-2 bg-[#070110]/80">
      <div className="px-6 sm:px-8 py-8 flex flex-col justify-center">
        <span className="h-7 px-3 rounded-full border border-white/15 text-white/60 text-[11px] font-bold uppercase tracking-wide inline-flex items-center justify-center w-fit">
          {chip}
        </span>
        <h3 className="mt-4 text-white font-black text-2xl tracking-tight">{title}</h3>
        <p className="mt-2 text-sm text-[#a8a29e] leading-relaxed max-w-sm">{body}</p>
      </div>
      <div className="px-6 sm:px-8 py-8 md:border-l border-white/10 grid place-items-center">
        {panel}
      </div>
    </div>
  );
}

// Abstract terminal rows — fake token list with green/red pills
function PanelTerminal() {
  const rows = [
    { w: "60%", up: true,  pct: "+341%" },
    { w: "46%", up: true,  pct: "+89%" },
    { w: "52%", up: false, pct: "-12%" },
  ];
  return (
    <div className="w-full max-w-[320px] space-y-3">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="size-7 rounded-full bg-[#a855f7]/25 shrink-0" />
          <span className="h-2.5 rounded-full bg-white/10" style={{ width: r.w }} />
          <span className={`ml-auto text-[11px] font-mono font-bold ${r.up ? "text-[#4ade80]" : "text-[#f87171]"}`}>
            {r.pct}
          </span>
        </div>
      ))}
    </div>
  );
}

// Abstract casino panel — a live pot with player dots
function PanelCasino() {
  return (
    <div className="flex items-center gap-6">
      <div
        className="size-24 rounded-full grid place-items-center border-2 border-[#a855f7]/60 shrink-0"
        style={{ background: "radial-gradient(circle, rgba(168,85,247,0.22), transparent 70%)" }}
      >
        <div className="text-center">
          <p className="text-white font-black text-base leading-none">1,840</p>
          <p className="text-[10px] text-white/50 mt-1">MON pot</p>
        </div>
      </div>
      <div className="space-y-2">
        {["@kojo", "@degen42", "@mona"].map((h, i) => (
          <div key={h} className="flex items-center gap-2">
            <span className={`size-4 rounded-full ${i % 2 ? "bg-[#a855f7]/40" : "bg-white/15"}`} />
            <span className="text-[11px] text-white/60 font-mono">{h}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Abstract payout panel — winner row + settle receipts
function PanelPot() {
  return (
    <div className="w-full max-w-[320px] space-y-3">
      <div className="flex items-center gap-3 rounded-2xl bg-[#a855f7]/15 border border-[#a855f7]/40 px-4 py-3">
        <span className="size-7 rounded-full bg-[#a855f7]/40 shrink-0" />
        <span className="text-sm text-white font-bold">@mona wins</span>
        <span className="ml-auto text-sm font-mono font-bold text-[#4ade80]">+3,420 MON</span>
      </div>
      {["paid from the pool", "settled onchain"].map((t, i) => (
        <div key={t} className="flex items-center gap-2.5 px-1">
          <span className="size-1.5 rounded-full bg-[#4ade80]" />
          <span className="text-[11px] text-white/55 font-mono">{t}</span>
          <span className="ml-auto text-[10px] text-white/30 font-mono">block #807241{i}</span>
        </div>
      ))}
    </div>
  );
}
