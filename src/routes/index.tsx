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

        {/* Hero */}
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

        {/* One section. Two doors. */}
        <section className="px-5 sm:px-10 pb-20">
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
        <footer className="mt-auto px-6 sm:px-10 py-6 flex items-center justify-between text-[12px] text-white/40">
          <span>© {new Date().getFullYear()} {APP_NAME}</span>
          <span>Built on Monad</span>
        </footer>
      </div>
    </div>
  );
}
