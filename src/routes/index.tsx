// Marketing landing page. The trading terminal lives at /meme — this page
// is public (no login gate) and renders full-bleed OVER the app chrome via
// a fixed container, so the sidebar/topbar/bubbles never peek through.

import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
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

      <div className="relative min-h-full flex flex-col">
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
        <main className="flex-1 grid place-items-center px-5 py-16">
          <div className="max-w-3xl text-center">
            <h1
              className="font-black tracking-tight leading-[1.15] text-[#d6d3d1]"
              style={{ fontSize: "clamp(28px, 4vw, 56px)" }}
            >
              The most <span className="text-[#a855f7]">powerful</span> way to
              trade the trenches.
            </h1>
            <p className="mt-5 text-[#d6d3d1] text-sm sm:text-base leading-relaxed max-w-xl mx-auto">
              <span className="font-bold text-white">Trench the odds</span>
            </p>
            <div className="mt-8 flex items-center justify-center gap-3">
              <a
                href="/meme"
                className="px-6 py-2.5 rounded-full bg-[#a855f7] hover:bg-[#9333ea] text-white text-sm font-bold inline-flex items-center gap-1.5 transition-colors"
                style={{ boxShadow: "0 10px 40px rgba(168,85,247,0.5)" }}
              >
                Start trading <ArrowUpRight className="size-4" />
              </a>
            </div>
          </div>
        </main>

        {/* Footer strip */}
        <footer className="px-6 sm:px-10 py-6 flex items-center justify-between text-[12px] text-white/40">
          <span>© {new Date().getFullYear()} {APP_NAME}</span>
          <span>Built on Monad</span>
        </footer>
      </div>
    </div>
  );
}
