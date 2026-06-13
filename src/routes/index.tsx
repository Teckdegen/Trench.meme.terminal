// Marketing landing page. The trading terminal lives at /meme — this page
// is public (no login gate) and renders full-bleed OVER the app chrome via
// a fixed container, so the sidebar/topbar/bubbles never peek through.

import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowUpRight, Zap, Crosshair, Copy, Dices, Scale, ShieldCheck,
  Fingerprint, KeyRound, Link2,
} from "lucide-react";
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

      <div className="relative flex flex-col">
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

        {/* Hero — fills the first viewport */}
        <main className="min-h-[72vh] grid place-items-center px-5 py-16">
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

        {/* ── Section: all-in-one grid (Dawn-style feature blocks) ── */}
        <section className="px-5 sm:px-10 py-20 bg-black/70 backdrop-blur-sm">
          <h2
            className="text-center font-black tracking-tight leading-tight text-[#d6d3d1] mx-auto max-w-2xl"
            style={{ fontSize: "clamp(26px, 3.6vw, 44px)" }}
          >
            The <span className="text-[#a855f7]">all in one</span> degen terminal
            at your fingertips.
          </h2>

          <div className="mt-14 max-w-5xl mx-auto grid md:grid-cols-2 gap-x-12 gap-y-12 items-center">
            {/* Trading — text left, panel right */}
            <FeatureText
              title="Trading"
              items={[
                { icon: Zap, text: "Live trench feed with new pairs, latest trades and trending" },
                { icon: Crosshair, text: "Swaps fire in under a second, signed in the background" },
                { icon: Copy, text: "Limit orders, copy trading and live PnL tracking" },
              ]}
            />
            <PanelTerminal />

            {/* Casino — panel left, text right */}
            <div className="order-4 md:order-3"><PanelCasino /></div>
            <div className="order-3 md:order-4">
              <FeatureText
                title="Casino"
                badge="Coming soon"
                items={[
                  { icon: Dices, text: "Every game is PvP. You win other degens bags" },
                  { icon: Scale, text: "The pot is the payout, just like the track" },
                  { icon: ShieldCheck, text: "Provably fair, settled onchain. The house never plays" },
                ]}
              />
            </div>

            {/* Infrastructure — text left, panel right */}
            <FeatureText
              title="Infrastructure"
              items={[
                { icon: Fingerprint, text: "Sign in with Google, Apple or X and get a wallet in seconds" },
                { icon: KeyRound, text: "Your wallet, your keys, fully in your control" },
                { icon: Link2, text: "Everything onchain on Monad at 400ms blocks" },
              ]}
            />
            <PanelInfra />
          </div>
        </section>

        {/* ── Section: 3 steps (Dawn-style "fast way") ── */}
        <section className="px-5 sm:px-10 py-20 bg-black/80">
          <h2
            className="text-center font-black tracking-tight leading-tight text-[#d6d3d1]"
            style={{ fontSize: "clamp(26px, 3.6vw, 44px)" }}
          >
            The <span className="text-[#a855f7] italic">fast</span> way to degen.
          </h2>

          <div className="mt-12 max-w-4xl mx-auto rounded-3xl border border-white/10 overflow-hidden divide-y divide-white/10">
            <StepRow
              step="Step 1"
              title="Sign in"
              body="Login with Google, Apple or X. Your wallet is ready before the page finishes loading."
            />
            <StepRow
              step="Step 2"
              title="Snipe the trenches"
              body="Catch launches the moment they go live and trade them at full speed."
            />
            <StepRow
              step="Step 3"
              title="Trench the odds"
              body="Dice duels, roulette, crash. Every game is PvP and every payout comes straight from the pool."
            />
          </div>

          <div className="mt-12 text-center">
            <a
              href="/meme"
              className="px-8 py-3.5 rounded-full bg-[#a855f7] hover:bg-[#9333ea] text-white text-base font-bold inline-flex items-center gap-2 transition-colors"
              style={{ boxShadow: "0 10px 40px rgba(168,85,247,0.5)" }}
            >
              Enter the trenches <ArrowUpRight className="size-5" />
            </a>
          </div>
        </section>

        {/* Footer strip */}
        <footer className="px-6 sm:px-10 py-6 flex items-center justify-between text-[12px] text-white/40 bg-black/80">
          <span>© {new Date().getFullYear()} {APP_NAME}</span>
          <span>Built on Monad</span>
        </footer>
      </div>
    </div>
  );
}

// ─────────────── Section building blocks ───────────────────────────────

function FeatureText({
  title, badge, items,
}: {
  title: string;
  badge?: string;
  items: { icon: React.ComponentType<{ className?: string }>; text: string }[];
}) {
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <h3 className="text-white font-bold text-2xl tracking-tight">{title}</h3>
        {badge && (
          <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#a855f7]/20 text-[#c084fc] font-bold">
            {badge}
          </span>
        )}
      </div>
      <ul className="mt-4 space-y-3">
        {items.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-2.5 text-sm text-[#d6d3d1]">
            <span className="size-6 shrink-0 rounded-md bg-white/5 grid place-items-center mt-[-2px]">
              <Icon className="size-3.5 text-[#c084fc]" />
            </span>
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-3xl border border-white/10 bg-[#0a0511]/90 p-5 min-h-[200px] flex flex-col justify-center"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 20px 60px rgba(0,0,0,0.5)" }}
    >
      {children}
    </div>
  );
}

// Abstract terminal rows — fake token list with green/red pills
function PanelTerminal() {
  const rows = [
    { w: "62%", up: true,  pct: "+341%" },
    { w: "48%", up: true,  pct: "+89%" },
    { w: "55%", up: false, pct: "-12%" },
    { w: "40%", up: true,  pct: "+27%" },
  ];
  return (
    <Panel>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="size-7 rounded-full bg-[#a855f7]/25 shrink-0" />
            <span className="h-2.5 rounded-full bg-white/10" style={{ width: r.w }} />
            <span className={`ml-auto text-[11px] font-mono font-bold ${r.up ? "text-[#4ade80]" : "text-[#f87171]"}`}>
              {r.pct}
            </span>
            <span className="h-6 px-2.5 rounded-full bg-[#a855f7]/20 text-[#c084fc] text-[10px] font-bold grid place-items-center">
              Buy
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// Abstract casino panel — a live pot with player dots
function PanelCasino() {
  return (
    <Panel>
      <div className="flex items-center justify-center gap-6">
        <div className="text-center">
          <div
            className="size-28 rounded-full grid place-items-center border-2 border-[#a855f7]/60"
            style={{ background: "radial-gradient(circle, rgba(168,85,247,0.22), transparent 70%)" }}
          >
            <div>
              <p className="text-white font-black text-lg leading-none">1,840</p>
              <p className="text-[10px] text-white/50 mt-1">MON pot</p>
            </div>
          </div>
        </div>
        <div className="space-y-2.5">
          {["@kojo", "@degen42", "@mona", "@rex"].map((h, i) => (
            <div key={h} className="flex items-center gap-2">
              <span className={`size-5 rounded-full ${i % 2 ? "bg-[#a855f7]/40" : "bg-white/15"}`} />
              <span className="text-[11px] text-white/60 font-mono">{h}</span>
              <span className="text-[10px] text-[#4ade80] font-mono ml-2">{(i + 1) * 120} MON</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// Abstract infra panel — wallet pill + settlement rows
function PanelInfra() {
  return (
    <Panel>
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3">
          <span className="size-8 rounded-full bg-[#a855f7]/30 grid place-items-center">
            <Fingerprint className="size-4 text-[#c084fc]" />
          </span>
          <div>
            <p className="text-white text-sm font-bold leading-none">0x49ab…1f2e</p>
            <p className="text-[10px] text-white/45 mt-1">ready in seconds</p>
          </div>
          <span className="ml-auto text-[10px] text-[#4ade80] font-bold">● live</span>
        </div>
        {["swap confirmed", "duel settled", "pot paid out"].map((t, i) => (
          <div key={t} className="flex items-center gap-2.5 px-1">
            <span className="size-1.5 rounded-full bg-[#4ade80]" />
            <span className="text-[11px] text-white/55 font-mono">{t}</span>
            <span className="ml-auto text-[10px] text-white/30 font-mono">block #807241{i}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function StepRow({ step, title, body }: { step: string; title: string; body: string }) {
  return (
    <div className="grid sm:grid-cols-[140px_1fr] gap-3 sm:gap-8 px-6 sm:px-8 py-7 bg-[#070110]/80">
      <span className="h-7 px-3 rounded-full border border-white/15 text-white/60 text-[11px] font-bold uppercase tracking-wide inline-flex items-center justify-center w-fit">
        {step}
      </span>
      <div>
        <h3 className="text-white font-bold text-lg tracking-tight">{title}</h3>
        <p className="mt-1.5 text-sm text-[#a8a29e] leading-relaxed max-w-xl">{body}</p>
      </div>
    </div>
  );
}
