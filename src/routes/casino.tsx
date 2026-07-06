import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Dices, TrendingUp, Users, Zap } from "lucide-react";
import { CASINO_GAMES, type CasinoGame } from "@/lib/casino-games";
import { GameArt } from "@/components/casino/GameArt";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export const Route = createFileRoute("/casino")({ component: CasinoLobby });

function CasinoLobby() {
  useDocumentTitle("Casino · trench.meme");

  return (
    <div className="relative space-y-6 pb-12 overflow-x-hidden">
      {/* ─── Ambient background blobs ─── */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div style={{
          position: "absolute", top: "-10%", left: "-5%",
          width: 600, height: 600, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(168,85,247,0.13), transparent 70%)",
          filter: "blur(40px)",
        }} />
        <div style={{
          position: "absolute", top: "20%", right: "-8%",
          width: 500, height: 500, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(217,70,239,0.08), transparent 70%)",
          filter: "blur(40px)",
        }} />
        <div style={{
          position: "absolute", bottom: "5%", left: "30%",
          width: 400, height: 400, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(139,92,246,0.07), transparent 70%)",
          filter: "blur(50px)",
        }} />
      </div>

      {/* ─── Hero ─── */}
      <div
        className="relative overflow-hidden rounded-3xl p-6 sm:p-10 z-10"
        style={{
          background: "linear-gradient(135deg, #1a0b33 0%, #0d0620 40%, #200840 75%, #0a0612 100%)",
          border: "1.5px solid rgba(168,85,247,0.25)",
          boxShadow: "0 0 60px rgba(168,85,247,0.15), 0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Hero glow balls */}
        <div className="absolute -right-16 -top-20 pointer-events-none" style={{
          width: 440, height: 440,
          background: "radial-gradient(circle, rgba(168,85,247,0.4), transparent 60%)",
          filter: "blur(30px)",
        }} />
        <div className="absolute left-1/2 bottom-0 pointer-events-none" style={{
          width: 300, height: 200,
          background: "radial-gradient(circle, rgba(217,70,239,0.15), transparent 70%)",
          filter: "blur(30px)",
        }} />

        {/* Cartoon chips decoration — absolute positioned art */}
        <div className="absolute right-6 bottom-4 sm:right-10 sm:bottom-6 pointer-events-none opacity-60 hidden sm:flex gap-2">
          <GameArt kind="coin" accent="#facc15" size={56} />
          <GameArt kind="diamond" accent="#38bdf8" size={56} />
          <GameArt kind="crown" accent="#f97316" size={56} />
        </div>

        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 h-7 px-3.5 rounded-full text-[11px] font-black uppercase tracking-widest"
            style={{ background: "rgba(168,85,247,0.2)", border: "1px solid rgba(168,85,247,0.4)", color: "#c084fc" }}>
            <ShieldCheck className="size-3.5" style={{ color: "#22c55e" }} />
            Provably fair · 100% Onchain · Monad
          </div>

          <h1
            className="mt-4 font-black text-white leading-none"
            style={{
              fontSize: "clamp(36px, 6vw, 68px)",
              letterSpacing: "-0.03em",
              textShadow: "0 4px 0 rgba(0,0,0,0.4), 0 0 60px rgba(168,85,247,0.5)",
            }}
          >
            Trench the Odds.
          </h1>

          <p className="mt-3 text-sm sm:text-base max-w-xl leading-relaxed" style={{ color: "rgba(245,243,255,0.7)" }}>
            Every game is PvP — you win other degens' bags.
            The house just runs the table and takes <span style={{ color: "#a855f7", fontWeight: 700 }}>6%</span>.
            No edge. No spread. No rigged RNG.
          </p>

          {/* Stats row */}
          <div className="mt-5 flex flex-wrap gap-4">
            {[
              { icon: <Dices className="size-4" />, label: "13 Games", sub: "PvP only" },
              { icon: <Zap className="size-4" />, label: "400ms Blocks", sub: "Instant settle" },
              { icon: <Users className="size-4" />, label: "0 House Edge", sub: "Pure PvP" },
              { icon: <TrendingUp className="size-4" />, label: "6% Rake", sub: "Only house cut" },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <span style={{ color: "#a855f7" }}>{s.icon}</span>
                <div>
                  <div className="text-xs font-bold text-white">{s.label}</div>
                  <div className="text-[10px]" style={{ color: "rgba(245,243,255,0.5)" }}>{s.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Live wins ticker ─── */}
      <WinsTicker />

      {/* ─── Section heading ─── */}
      <div className="relative z-10 flex items-center justify-between">
        <h2 className="font-black text-white tracking-tight" style={{ fontSize: "clamp(18px, 2.5vw, 26px)", textShadow: "0 2px 0 rgba(0,0,0,0.3)" }}>
          Choose Your Game
        </h2>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
          style={{ background: "rgba(168,85,247,0.15)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.3)" }}>
          {CASINO_GAMES.length} games
        </span>
      </div>

      {/* ─── Game grid ─── */}
      <div className="relative z-10 grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-5">
        {CASINO_GAMES.map((g) => (
          <GameCard key={g.slug} game={g} />
        ))}
      </div>

      {/* ─── Bottom CTA ─── */}
      <div className="relative z-10 mt-4 rounded-2xl p-5 text-center"
        style={{
          background: "linear-gradient(135deg, #120a22, #1a0b33)",
          border: "1px solid rgba(168,85,247,0.2)",
        }}>
        <p className="text-sm font-semibold" style={{ color: "rgba(245,243,255,0.6)" }}>
          More games dropping every week. All onchain, all PvP.
        </p>
        <p className="text-[11px] mt-1" style={{ color: "rgba(245,243,255,0.35)" }}>
          Bet tickets are ERC-721 NFTs — transferable, tradeable, verifiable.
        </p>
      </div>
    </div>
  );
}

function GameCard({ game }: { game: CasinoGame }) {
  return (
    <Link
      to="/casino/$game"
      params={{ game: game.slug }}
      className="group relative block overflow-hidden transition-all duration-200 hover:-translate-y-2 active:translate-y-0 active:scale-[0.98]"
      style={{
        borderRadius: 20,
        background: `linear-gradient(150deg, ${game.from} 0%, ${game.to} 100%)`,
        border: "2px solid rgba(255,255,255,0.12)",
        boxShadow: `0 8px 0 rgba(0,0,0,0.45), 0 20px 40px rgba(0,0,0,0.5), 0 0 30px ${game.glow}22`,
      }}
    >
      {/* Glow blob */}
      <div
        className="absolute -right-8 -top-10 pointer-events-none opacity-60 group-hover:opacity-90 transition-opacity duration-300"
        style={{
          width: 160, height: 160,
          background: `radial-gradient(circle, ${game.glow}88, transparent 65%)`,
          filter: "blur(14px)",
        }}
      />

      {/* Shimmer overlay on hover */}
      <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, transparent 60%)",
        }}
      />

      <div className="relative p-3.5 sm:p-5 flex flex-col items-center text-center"
        style={{ minHeight: 210 }}>

        {/* Status chip */}
        <span
          className="absolute left-3 top-3 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full"
          style={game.status === "live"
            ? { background: "#22c55e", color: "#0a0612", boxShadow: "0 0 10px rgba(34,197,94,0.5)" }
            : { background: "rgba(0,0,0,0.45)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)" }
          }
        >
          {game.status === "live" ? "● Live" : "Soon"}
        </span>

        {/* Art — bounces on hover */}
        <div className="mt-5 mb-2 transition-all duration-300 group-hover:scale-[1.15] group-hover:-rotate-[4deg] group-hover:drop-shadow-[0_8px_16px_rgba(0,0,0,0.5)]">
          <GameArt kind={game.art} accent={game.glow} size={88} />
        </div>

        <h3
          className="font-black text-white leading-tight tracking-tight"
          style={{ fontSize: "clamp(14px, 2.2vw, 19px)", textShadow: "0 2px 0 rgba(0,0,0,0.4)" }}
        >
          {game.name}
        </h3>
        <p className="mt-1.5 text-[11px] leading-snug" style={{ color: "rgba(255,255,255,0.65)" }}>
          {game.tagline}
        </p>

        <div className="mt-auto pt-3 inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider"
          style={{ color: "rgba(255,255,255,0.85)" }}>
          Play
          <span className="inline-block transition-transform duration-200 group-hover:translate-x-1">→</span>
        </div>
      </div>

      {/* Bottom glow bar */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: `linear-gradient(90deg, transparent, ${game.glow}, transparent)` }}
      />
    </Link>
  );
}

function WinsTicker() {
  const wins = [
    { who: "@kojo", game: "Moon or Doom", amt: "+120 MON", color: "#22c55e" },
    { who: "@degen42", game: "Rug Run", amt: "+1,103 MON", color: "#22c55e" },
    { who: "@mona", game: "Send It", amt: "+340 MON", color: "#22c55e" },
    { who: "@rex", game: "Chamber", amt: "+88 MON", color: "#22c55e" },
    { who: "@trench001", game: "Degen Wheel", amt: "+512 MON", color: "#22c55e" },
    { who: "@paperhand", game: "Diamond Hands", amt: "-50 MON", color: "#ef4444" },
    { who: "@gasmaxxer", game: "Gas War", amt: "+770 MON", color: "#22c55e" },
    { who: "@exitking", game: "Exit Scam", amt: "+230 MON", color: "#22c55e" },
  ];
  return (
    <div className="relative overflow-hidden rounded-xl flex items-center"
      style={{
        height: 40,
        background: "rgba(168,85,247,0.06)",
        border: "1px solid rgba(168,85,247,0.15)",
      }}>
      <span className="shrink-0 h-full px-3 grid place-items-center text-[10px] font-black uppercase tracking-widest"
        style={{ background: "rgba(168,85,247,0.2)", color: "#c084fc", borderRight: "1px solid rgba(168,85,247,0.2)" }}>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
          Live
        </span>
      </span>
      <div className="flex-1 overflow-hidden">
        <div className="flex items-center gap-8 whitespace-nowrap animate-[ticker_28s_linear_infinite] px-5">
          {[...wins, ...wins].map((w, i) => (
            <span key={i} className="text-[11px] flex items-center gap-2">
              <span style={{ color: "#a855f7", fontWeight: 700 }}>{w.who}</span>
              <span style={{ color: "rgba(245,243,255,0.45)" }}>·</span>
              <span style={{ color: "rgba(245,243,255,0.7)" }}>{w.game}</span>
              <span style={{ color: "rgba(245,243,255,0.45)" }}>·</span>
              <span style={{ color: w.color, fontWeight: 700 }}>{w.amt}</span>
            </span>
          ))}
        </div>
      </div>
      <style>{`@keyframes ticker { from { transform: translateX(0) } to { transform: translateX(-50%) } }`}</style>
    </div>
  );
}
