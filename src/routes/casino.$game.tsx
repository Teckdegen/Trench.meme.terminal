import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, Users, Zap, ShieldCheck, Clock, Info, TrendingUp, ChevronRight } from "lucide-react";
import { CASINO_GAMES, findGame } from "@/lib/casino-games";
import { GameArt } from "@/components/casino/GameArt";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useState } from "react";

export const Route = createFileRoute("/casino/$game")({
  loader: ({ params }) => {
    const g = findGame(params.game);
    if (!g) throw notFound();
    return g;
  },
  component: GamePage,
});

function GamePage() {
  const game = Route.useLoaderData();
  useDocumentTitle(`${game.name} · Casino`);

  return (
    <div className="relative pb-12 space-y-5 overflow-x-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div style={{
          position: "absolute", top: "-5%", left: "-10%",
          width: 700, height: 700, borderRadius: "50%",
          background: `radial-gradient(circle, ${game.glow}22, transparent 65%)`,
          filter: "blur(60px)",
        }} />
      </div>

      {/* Back nav */}
      <Link to="/casino"
        className="relative z-10 inline-flex items-center gap-2 text-sm font-semibold transition-colors hover:text-white"
        style={{ color: "rgba(245,243,255,0.55)" }}>
        <ArrowLeft className="size-4" /> All Games
      </Link>

      {/* Hero card */}
      <GameHero game={game} />

      {/* Two-column layout: left = game area, right = sidebar */}
      <div className="relative z-10 grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5">
        <div className="space-y-5">
          <GamePlayArea game={game} />
          <RecentRounds game={game} />
        </div>
        <div className="space-y-5">
          <HowToPlay game={game} />
          <LivePlayers game={game} />
          <TopWinners game={game} />
        </div>
      </div>

      {/* More games */}
      <MoreGames current={game.slug} />
    </div>
  );
}

// ─── Hero section ────────────────────────────────────────────────────────────
function GameHero({ game }: { game: ReturnType<typeof findGame> & {} }) {
  return (
    <div
      className="relative z-10 overflow-hidden rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-6"
      style={{
        background: `linear-gradient(135deg, ${game.from} 0%, ${game.to} 100%)`,
        border: "2px solid rgba(255,255,255,0.12)",
        boxShadow: `0 10px 0 rgba(0,0,0,0.5), 0 30px 60px rgba(0,0,0,0.5), 0 0 50px ${game.glow}33`,
      }}
    >
      {/* Glow blob */}
      <div className="absolute -right-12 -top-20 pointer-events-none" style={{
        width: 380, height: 380,
        background: `radial-gradient(circle, ${game.glow}55, transparent 60%)`,
        filter: "blur(30px)",
      }} />
      {/* Shimmer */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 50%)",
      }} />

      {/* Cartoon art — big hero display */}
      <div className="relative shrink-0 drop-shadow-[0_12px_24px_rgba(0,0,0,0.6)]"
        style={{ animation: "heroFloat 4s ease-in-out infinite" }}>
        <GameArt kind={game.art} accent={game.glow} size={130} />
      </div>

      <div className="relative flex-1">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span
            className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full"
            style={game.status === "live"
              ? { background: "#22c55e", color: "#0a0612", boxShadow: "0 0 12px rgba(34,197,94,0.5)" }
              : { background: "rgba(0,0,0,0.4)", color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.12)" }
            }>
            {game.status === "live" ? "● Live" : "Coming Soon"}
          </span>
          <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full"
            style={{ background: "rgba(0,0,0,0.3)", color: "rgba(255,255,255,0.55)", border: "1px solid rgba(255,255,255,0.1)" }}>
            PvP · 6% rake
          </span>
        </div>

        <h1
          className="font-black text-white leading-none"
          style={{
            fontSize: "clamp(28px, 4vw, 50px)",
            letterSpacing: "-0.03em",
            textShadow: "0 4px 0 rgba(0,0,0,0.4)",
          }}
        >
          {game.name}
        </h1>
        <p className="mt-2 text-sm sm:text-base leading-relaxed max-w-lg"
          style={{ color: "rgba(255,255,255,0.72)" }}>
          {game.tagline}
        </p>

        {/* Quick stats */}
        <div className="mt-4 flex flex-wrap gap-3">
          {[
            { icon: <Users className="size-3.5" />, val: "—", label: "Players" },
            { icon: <TrendingUp className="size-3.5" />, val: "—", label: "Pool" },
            { icon: <Clock className="size-3.5" />, val: "—", label: "Next round" },
            { icon: <Zap className="size-3.5" />, val: "400ms", label: "Block time" },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
              style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <span style={{ color: game.glow }}>{s.icon}</span>
              <span className="text-[11px] font-bold text-white">{s.val}</span>
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`@keyframes heroFloat {
        0%,100% { transform: translateY(0) rotate(0deg); }
        50% { transform: translateY(-10px) rotate(3deg); }
      }`}</style>
    </div>
  );
}

// ─── Main play area ───────────────────────────────────────────────────────────
function GamePlayArea({ game }: { game: ReturnType<typeof findGame> & {} }) {
  const isSoon = game.status === "soon";

  if (isSoon) return <ComingSoonPanel game={game} />;

  // Per-game UI for "live" games — will wire up when contracts deploy
  switch (game.slug) {
    case "moondoom": return <MoonOrDoomUI game={game} />;
    case "sendit": return <SendItUI game={game} />;
    case "degenwheel": return <DegenWheelUI game={game} />;
    case "chamber": return <ChamberUI game={game} />;
    default: return <GenericBetUI game={game} />;
  }
}

function ComingSoonPanel({ game }: { game: ReturnType<typeof findGame> & {} }) {
  return (
    <div className="relative overflow-hidden rounded-2xl p-8 flex flex-col items-center text-center gap-4"
      style={{
        background: `linear-gradient(135deg, ${game.from}cc 0%, ${game.to}cc 100%)`,
        border: "2px solid rgba(255,255,255,0.1)",
        boxShadow: `0 8px 0 rgba(0,0,0,0.4), 0 0 40px ${game.glow}22`,
      }}>
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse at top, rgba(168,85,247,0.1), transparent 60%)",
      }} />

      {/* Big bouncing art */}
      <div style={{ animation: "heroFloat 3s ease-in-out infinite" }} className="relative z-10">
        <GameArt kind={game.art} accent={game.glow} size={120} />
      </div>

      <div className="relative z-10">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-3"
          style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.15)" }}>
          <Clock className="size-4" style={{ color: game.glow }} />
          <span className="text-sm font-black text-white">Dropping Soon</span>
        </div>
        <h2 className="text-2xl font-black text-white" style={{ textShadow: "0 3px 0 rgba(0,0,0,0.4)" }}>
          {game.name} is loading...
        </h2>
        <p className="mt-2 text-sm max-w-sm mx-auto" style={{ color: "rgba(255,255,255,0.6)" }}>
          Contracts are being audited. Get ready to degenerate responsibly.
        </p>

        <div className="mt-6 grid grid-cols-3 gap-3 max-w-sm mx-auto">
          {["Contracts", "Audit", "Launch"].map((step, i) => (
            <div key={step} className="flex flex-col items-center gap-1.5 p-3 rounded-xl"
              style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="size-7 rounded-full flex items-center justify-center text-xs font-black"
                style={{
                  background: i === 0 ? game.glow : "rgba(255,255,255,0.1)",
                  color: i === 0 ? "#0a0612" : "rgba(255,255,255,0.4)",
                  boxShadow: i === 0 ? `0 0 12px ${game.glow}66` : "none",
                }}>
                {i === 0 ? "✓" : i + 1}
              </div>
              <span className="text-[11px] font-semibold"
                style={{ color: i === 0 ? "white" : "rgba(255,255,255,0.4)" }}>
                {step}
              </span>
            </div>
          ))}
        </div>

        <button className="mt-6 px-6 py-2.5 rounded-xl text-sm font-black text-white transition-all"
          style={{
            background: `linear-gradient(135deg, ${game.glow}, ${game.from})`,
            boxShadow: `0 4px 0 rgba(0,0,0,0.4), 0 0 20px ${game.glow}44`,
          }}
          onClick={() => alert("Notify me feature coming soon!")}>
          🔔 Notify Me at Launch
        </button>
      </div>
    </div>
  );
}

// ─── Moon or Doom UI ─────────────────────────────────────────────────────────
function MoonOrDoomUI({ game }: { game: ReturnType<typeof findGame> & {} }) {
  const [pick, setPick] = useState<"MOON" | "DOOM" | null>(null);
  const [stake, setStake] = useState("10");
  const presets = ["5", "10", "25", "50", "100"];

  return (
    <div className="rounded-2xl overflow-hidden" style={{
      background: "linear-gradient(135deg, #120a22, #0a0612)",
      border: "1.5px solid rgba(168,85,247,0.2)",
      boxShadow: "0 8px 0 rgba(0,0,0,0.4)",
    }}>
      {/* Pool header */}
      <div className="px-5 pt-5 pb-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div>
          <div className="text-xs font-semibold" style={{ color: "rgba(245,243,255,0.5)" }}>Current Pool</div>
          <div className="text-2xl font-black text-white tabular-nums">340 MON</div>
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold" style={{ color: "rgba(245,243,255,0.5)" }}>Your payout if you win</div>
          <div className="text-xl font-black tabular-nums" style={{ color: "#22c55e" }}>
            {stake ? `~${(parseFloat(stake) * 1.88).toFixed(0)} MON` : "—"}
          </div>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Side picker — big cartoon buttons */}
        <div className="grid grid-cols-2 gap-3">
          {(["MOON", "DOOM"] as const).map((side) => {
            const isMoon = side === "MOON";
            const active = pick === side;
            return (
              <button
                key={side}
                onClick={() => setPick(side)}
                className="relative overflow-hidden rounded-2xl p-5 flex flex-col items-center gap-3 transition-all duration-150"
                style={{
                  background: active
                    ? isMoon
                      ? "linear-gradient(135deg, #7c3aed, #4c1d95)"
                      : "linear-gradient(135deg, #7f1d1d, #3b0000)"
                    : "rgba(255,255,255,0.04)",
                  border: `2px solid ${active ? (isMoon ? "#a855f7" : "#ef4444") : "rgba(255,255,255,0.08)"}`,
                  boxShadow: active
                    ? `0 6px 0 rgba(0,0,0,0.4), 0 0 24px ${isMoon ? "rgba(168,85,247,0.4)" : "rgba(239,68,68,0.4)"}`
                    : "0 4px 0 rgba(0,0,0,0.2)",
                  transform: active ? "translateY(-2px)" : "none",
                }}>
                <div style={{ fontSize: 48, filter: `drop-shadow(0 4px 8px rgba(0,0,0,0.5))` }}>
                  {isMoon ? "🚀" : "💀"}
                </div>
                <div className="font-black text-white tracking-wide" style={{ fontSize: 20 }}>{side}</div>
                <div className="text-[11px]" style={{ color: "rgba(255,255,255,0.55)" }}>
                  {isMoon ? "MON pumps" : "MON dumps"}
                </div>
                <div className="text-xs font-bold" style={{ color: isMoon ? "#a855f7" : "#ef4444" }}>
                  170 MON in
                </div>
                {active && (
                  <div className="absolute top-2 right-2 size-5 rounded-full flex items-center justify-center text-[10px] font-black"
                    style={{ background: isMoon ? "#a855f7" : "#ef4444", color: "#fff" }}>✓</div>
                )}
              </button>
            );
          })}
        </div>

        {/* Stake input */}
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "rgba(245,243,255,0.5)" }}>Stake (MON)</div>
          <div className="flex gap-2 mb-2">
            {presets.map((p) => (
              <button key={p} onClick={() => setStake(p)}
                className="flex-1 py-1.5 rounded-lg text-xs font-bold transition-all"
                style={{
                  background: stake === p ? "#8b5cf6" : "rgba(255,255,255,0.06)",
                  color: stake === p ? "#fff" : "rgba(245,243,255,0.6)",
                  border: stake === p ? "1px solid #a855f7" : "1px solid transparent",
                }}>
                {p}
              </button>
            ))}
          </div>
          <input
            type="number" value={stake} onChange={(e) => setStake(e.target.value)}
            className="w-full px-4 py-3 rounded-xl text-sm font-bold text-white outline-none"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
            placeholder="Enter amount..."
          />
        </div>

        {/* Place bet */}
        <button
          disabled={!pick}
          className="w-full py-4 rounded-xl font-black text-base transition-all"
          style={{
            background: pick ? "linear-gradient(135deg, #8b5cf6, #6d28d9)" : "rgba(255,255,255,0.05)",
            color: pick ? "#fff" : "rgba(255,255,255,0.3)",
            boxShadow: pick ? "0 6px 0 rgba(0,0,0,0.4), 0 0 24px rgba(139,92,246,0.3)" : "0 4px 0 rgba(0,0,0,0.2)",
            transform: pick ? "none" : "none",
            cursor: pick ? "pointer" : "not-allowed",
          }}>
          {pick ? `Bet ${stake} MON on ${pick} →` : "Pick a Side First"}
        </button>

        <p className="text-[10px] text-center" style={{ color: "rgba(245,243,255,0.3)" }}>
          6% rake on settlement · NFT bet ticket minted on-chain · provably fair
        </p>
      </div>
    </div>
  );
}

// ─── Send It (Dice Duel) UI ───────────────────────────────────────────────────
function SendItUI({ game }: { game: ReturnType<typeof findGame> & {} }) {
  const [stake, setStake] = useState("10");

  return (
    <div className="rounded-2xl overflow-hidden" style={{
      background: "linear-gradient(135deg, #120a22, #0a0612)",
      border: "1.5px solid rgba(139,92,246,0.2)",
      boxShadow: "0 8px 0 rgba(0,0,0,0.4)",
    }}>
      <div className="p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-white text-lg">Dice Duel</h3>
          <span className="text-xs px-2.5 py-1 rounded-full font-bold"
            style={{ background: "rgba(139,92,246,0.15)", color: "#a855f7" }}>
            Stake-weighted roll
          </span>
        </div>

        {/* Visual dice */}
        <div className="grid grid-cols-2 gap-3">
          {["You", "Opponent"].map((who, i) => (
            <div key={who} className="rounded-2xl p-4 flex flex-col items-center gap-3"
              style={{
                background: i === 0 ? "rgba(139,92,246,0.1)" : "rgba(255,255,255,0.04)",
                border: `1.5px solid ${i === 0 ? "rgba(139,92,246,0.3)" : "rgba(255,255,255,0.07)"}`,
              }}>
              <div style={{ fontSize: 52, filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.5))" }}>🎲</div>
              <div className="font-black text-white">{who}</div>
              <div className="text-3xl font-black tabular-nums" style={{ color: i === 0 ? "#a855f7" : "rgba(245,243,255,0.3)" }}>
                ?
              </div>
            </div>
          ))}
        </div>

        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "rgba(245,243,255,0.5)" }}>Your Stake (MON)</div>
          <input type="number" value={stake} onChange={(e) => setStake(e.target.value)}
            className="w-full px-4 py-3 rounded-xl text-sm font-bold text-white outline-none"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
        </div>

        <button className="w-full py-4 rounded-xl font-black text-base text-white"
          style={{
            background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
            boxShadow: "0 6px 0 rgba(0,0,0,0.4), 0 0 24px rgba(139,92,246,0.3)",
          }}>
          Post Challenge — {stake} MON →
        </button>
      </div>
    </div>
  );
}

// ─── Degen Wheel UI ───────────────────────────────────────────────────────────
function DegenWheelUI({ game }: { game: ReturnType<typeof findGame> & {} }) {
  const [pick, setPick] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const sectors = [
    { label: "🔴 Red", key: "red", color: "#ef4444" },
    { label: "⚫ Black", key: "black", color: "#374151" },
    { label: "🟣 0", key: "0", color: "#a855f7" },
    { label: "Straight #", key: "number", color: "#f97316" },
  ];

  return (
    <div className="rounded-2xl overflow-hidden" style={{
      background: "linear-gradient(135deg, #120a22, #0a0612)",
      border: "1.5px solid rgba(217,70,239,0.2)",
      boxShadow: "0 8px 0 rgba(0,0,0,0.4)",
    }}>
      <div className="p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-white text-lg">Roulette Wheel</h3>
          <span className="text-xs px-2.5 py-1 rounded-full font-bold"
            style={{ background: "rgba(217,70,239,0.15)", color: "#e879f9" }}>
            Pari-mutuel
          </span>
        </div>

        {/* Wheel graphic */}
        <div className="flex justify-center">
          <div className="relative size-44 rounded-full flex items-center justify-center"
            style={{
              background: "conic-gradient(#7c3aed 0deg, #7c3aed 90deg, #ef4444 90deg, #ef4444 180deg, #1f2937 180deg, #1f2937 270deg, #a855f7 270deg, #a855f7 360deg)",
              border: "6px solid rgba(255,255,255,0.2)",
              boxShadow: `0 0 40px ${game.glow}44`,
              animation: spinning ? "spin 2s linear infinite" : "none",
            }}>
            <div className="size-16 rounded-full flex items-center justify-center font-black text-2xl text-white"
              style={{ background: "#0a0612", border: "4px solid rgba(255,255,255,0.3)" }}>
              🎰
            </div>
          </div>
        </div>

        {/* Bet type selector */}
        <div className="grid grid-cols-2 gap-2">
          {sectors.map((s) => (
            <button key={s.key} onClick={() => setPick(s.key)}
              className="rounded-xl py-3 px-3 text-sm font-bold text-left flex items-center gap-2 transition-all"
              style={{
                background: pick === s.key ? `${s.color}22` : "rgba(255,255,255,0.04)",
                border: `1.5px solid ${pick === s.key ? s.color : "rgba(255,255,255,0.07)"}`,
                color: pick === s.key ? s.color : "rgba(245,243,255,0.6)",
              }}>
              <span style={{ fontSize: 18 }}>{s.label.split(" ")[0]}</span>
              <span>{s.label.split(" ").slice(1).join(" ")}</span>
            </button>
          ))}
        </div>

        <button className="w-full py-4 rounded-xl font-black text-base text-white"
          onClick={() => setSpinning(true)}
          style={{
            background: "linear-gradient(135deg, #d946ef, #7c3aed)",
            boxShadow: "0 6px 0 rgba(0,0,0,0.4), 0 0 24px rgba(217,70,239,0.3)",
          }}>
          Place Bet →
        </button>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Chamber (Russian Roulette) UI ───────────────────────────────────────────
function ChamberUI({ game }: { game: ReturnType<typeof findGame> & {} }) {
  const seats = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, taken: i < 3 }));

  return (
    <div className="rounded-2xl overflow-hidden" style={{
      background: "linear-gradient(135deg, #200a0a, #0a0612)",
      border: "1.5px solid rgba(239,68,68,0.2)",
      boxShadow: "0 8px 0 rgba(0,0,0,0.4)",
    }}>
      <div className="p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-white text-lg">6-Player Chamber</h3>
          <span className="text-xs px-2.5 py-1 rounded-full font-bold"
            style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}>
            3/6 filled
          </span>
        </div>

        {/* Revolver visual */}
        <div className="flex justify-center">
          <div className="relative size-40">
            {seats.map((seat, i) => {
              const angle = (i / 6) * 360 - 90;
              const rad = (angle * Math.PI) / 180;
              const cx = 50 + 38 * Math.cos(rad);
              const cy = 50 + 38 * Math.sin(rad);
              return (
                <div key={seat.id}
                  className="absolute flex items-center justify-center rounded-full font-black text-sm transition-all"
                  style={{
                    width: 32, height: 32,
                    left: `${cx}%`, top: `${cy}%`,
                    transform: "translate(-50%, -50%)",
                    background: seat.taken ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.06)",
                    border: `2px solid ${seat.taken ? "#ef4444" : "rgba(255,255,255,0.15)"}`,
                    boxShadow: seat.taken ? "0 0 12px rgba(239,68,68,0.4)" : "none",
                    color: seat.taken ? "#f87171" : "rgba(255,255,255,0.3)",
                  }}>
                  {seat.taken ? "💀" : i + 1}
                </div>
              );
            })}
            {/* Center */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="size-14 rounded-full flex items-center justify-center text-2xl"
                style={{
                  background: "#0a0612",
                  border: "4px solid rgba(239,68,68,0.4)",
                  boxShadow: "0 0 24px rgba(239,68,68,0.3)",
                }}>
                🔫
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl p-3 text-sm text-center"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "rgba(245,243,255,0.7)" }}>
          One seat loses everything. Five survivors split the pool. <span style={{ color: "#f87171", fontWeight: 700 }}>Equal buy-in only.</span>
        </div>

        <button className="w-full py-4 rounded-xl font-black text-base text-white"
          style={{
            background: "linear-gradient(135deg, #ef4444, #7f1d1d)",
            boxShadow: "0 6px 0 rgba(0,0,0,0.4), 0 0 24px rgba(239,68,68,0.3)",
          }}>
          Take a Seat — 10 MON →
        </button>
      </div>
    </div>
  );
}

// ─── Generic bet UI (fallback for live games without specific UI yet) ─────────
function GenericBetUI({ game }: { game: ReturnType<typeof findGame> & {} }) {
  const [stake, setStake] = useState("10");
  return (
    <div className="rounded-2xl overflow-hidden" style={{
      background: "linear-gradient(135deg, #120a22, #0a0612)",
      border: "1.5px solid rgba(168,85,247,0.2)",
      boxShadow: "0 8px 0 rgba(0,0,0,0.4)",
    }}>
      <div className="p-5 space-y-4">
        <div className="flex justify-center py-4">
          <div style={{ animation: "heroFloat 3s ease-in-out infinite" }}>
            <GameArt kind={game.art} accent={game.glow} size={100} />
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "rgba(245,243,255,0.5)" }}>Stake (MON)</div>
          <input type="number" value={stake} onChange={(e) => setStake(e.target.value)}
            className="w-full px-4 py-3 rounded-xl text-sm font-bold text-white outline-none"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
        </div>
        <button className="w-full py-4 rounded-xl font-black text-base text-white"
          style={{
            background: `linear-gradient(135deg, ${game.glow}, ${game.from})`,
            boxShadow: `0 6px 0 rgba(0,0,0,0.4), 0 0 24px ${game.glow}44`,
          }}>
          Place Bet — {stake} MON →
        </button>
      </div>
    </div>
  );
}

// ─── Recent Rounds ────────────────────────────────────────────────────────────
function RecentRounds({ game }: { game: ReturnType<typeof findGame> & {} }) {
  const rounds = [
    { id: "#1,042", winner: "@kojo", outcome: "MOON", payout: "+220 MON", ts: "2m ago", color: "#22c55e" },
    { id: "#1,041", winner: "@mona", outcome: "DOOM", payout: "+85 MON", ts: "4m ago", color: "#22c55e" },
    { id: "#1,040", winner: "@degen42", outcome: "MOON", payout: "+310 MON", ts: "7m ago", color: "#22c55e" },
    { id: "#1,039", winner: "House", outcome: "—", payout: "+48 MON", ts: "11m ago", color: "#f97316" },
  ];

  return (
    <div className="rounded-2xl overflow-hidden" style={{
      background: "linear-gradient(135deg, #0e0820, #0a0612)",
      border: "1px solid rgba(255,255,255,0.06)",
    }}>
      <div className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <h3 className="font-black text-white text-sm">Recent Rounds</h3>
        <span className="text-[10px] font-semibold" style={{ color: "rgba(245,243,255,0.4)" }}>Live from chain</span>
      </div>
      <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
        {rounds.map((r) => (
          <div key={r.id} className="px-5 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-mono" style={{ color: "rgba(245,243,255,0.35)" }}>{r.id}</span>
              <span className="text-sm font-semibold text-white">{r.winner}</span>
              <span className="text-xs px-1.5 py-0.5 rounded font-bold"
                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(245,243,255,0.5)" }}>
                {r.outcome}
              </span>
            </div>
            <div className="text-right">
              <div className="text-sm font-black" style={{ color: r.color }}>{r.payout}</div>
              <div className="text-[10px]" style={{ color: "rgba(245,243,255,0.35)" }}>{r.ts}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── How to Play ──────────────────────────────────────────────────────────────
const HOW_TO_PLAY: Record<string, { steps: string[]; note?: string }> = {
  moondoom: {
    steps: [
      "Pick MOON (price up) or DOOM (price down)",
      "Enter your stake — both sides must be represented for the round to fire",
      "After lock, entropy is drawn onchain and your side wins or loses",
      "Winners split the losing side's pot minus 6% rake",
    ],
    note: "Equal stakes = true 50/50. Your payout floats live as bets come in.",
  },
  sendit: {
    steps: [
      "Post a challenge with your stake",
      "Opponent matches within ±10% of your stake",
      "Both commit a secret seed; after reveal window, keccak entropy resolves",
      "Stake-weighted roll: bigger stack needs a smaller raw roll to win",
    ],
    note: "Up to 8 rerolls on exact ties; 9th tie = push.",
  },
  chamber: {
    steps: [
      "6 equal buy-ins fill the table",
      "Post-fill block hash seeds a random seat 0–5",
      "That seat's player loses everything; the other 5 split the pool",
      "Each survivor walks away up ~1 buy-in (minus rake)",
    ],
    note: "Pure 5/6 odds for every seat. No better or worse seat.",
  },
  degenwheel: {
    steps: [
      "Bet on a number (0–36), red/black, or odd/even",
      "Round locks when betting window closes",
      "Entropy draws result from 0–36 (European roulette)",
      "Winners split the losing side's pot, weighted by odds",
    ],
    note: "Straight number pays ~36× the weight of red/black.",
  },
  diamondhands: {
    steps: [
      "Enter 1v1 with equal stakes",
      "Either player can paperhands at any time — first to fold loses",
      "If nobody folds before crash block (~6 min), house takes the pot",
      "Hold longer than your opponent to win their bag",
    ],
    note: "Crash block at 900 blocks. poke() is permissionless.",
  },
  exitscam: {
    steps: [
      "4 players, equal stakes. Secret vote: HOLD or DUMP",
      "All HOLD → even split. 1 DUMP → lone rugger takes the bag",
      "2+ DUMP → house takes it all (they cancel each other out)",
      "No reveal before deadline = auto-DUMP",
    ],
  },
  gaswar: {
    steps: [
      "Escrow the max bid. Submit your sealed bid (≤ max).",
      "All-pay: everyone loses their bid win or lose; unbid amount refunded",
      "Highest sealed bid wins the entire pot minus rake",
      "Ties split the prize. No-reveal = max bid charged.",
    ],
  },
  whalethrone: {
    steps: [
      "Anyone can seize the throne by paying the current price",
      "Each seize adds to the pot, prev king's ticket marked LOST",
      "Price steps up 20% per seize, end block extends 30 blocks",
      "When time runs out, current king wins the whole pot minus rake",
    ],
    note: "Continuous game — new round auto-opens after each win.",
  },
  knifecatcher: {
    steps: [
      "8 players fill the table with equal stakes",
      "Single entropy draw picks one winner from 8 seats",
      "Winner takes the whole pot minus rake",
      "Everyone else loses their stake",
    ],
    note: "The UI shows dramatic eliminations, but it's one entropy draw.",
  },
};

function HowToPlay({ game }: { game: ReturnType<typeof findGame> & {} }) {
  const [open, setOpen] = useState(false);
  const guide = HOW_TO_PLAY[game.slug] ?? {
    steps: [
      "Enter the game lobby and set your stake",
      "Wait for enough opposing players to join",
      "Onchain entropy settles the round",
      "Winners claim their share from the vault",
    ],
  };

  return (
    <div className="rounded-2xl overflow-hidden" style={{
      background: "linear-gradient(135deg, #0e0820, #0a0612)",
      border: "1px solid rgba(255,255,255,0.06)",
    }}>
      <button className="w-full px-5 py-4 flex items-center justify-between"
        onClick={() => setOpen(!open)}
        style={{ borderBottom: open ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
        <div className="flex items-center gap-2">
          <Info className="size-4" style={{ color: game.glow }} />
          <h3 className="font-black text-white text-sm">How to Play</h3>
        </div>
        <ChevronRight className="size-4 transition-transform duration-200"
          style={{ color: "rgba(245,243,255,0.4)", transform: open ? "rotate(90deg)" : "none" }} />
      </button>
      {open && (
        <div className="px-5 py-4 space-y-3">
          <ol className="space-y-2">
            {guide.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="shrink-0 size-5 rounded-full flex items-center justify-center text-[10px] font-black mt-0.5"
                  style={{ background: `${game.glow}33`, color: game.glow }}>
                  {i + 1}
                </span>
                <span style={{ color: "rgba(245,243,255,0.75)" }}>{step}</span>
              </li>
            ))}
          </ol>
          {guide.note && (
            <p className="text-[11px] px-3 py-2 rounded-lg"
              style={{ background: `${game.glow}11`, color: "rgba(245,243,255,0.55)", border: `1px solid ${game.glow}22` }}>
              💡 {guide.note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Live Players ─────────────────────────────────────────────────────────────
function LivePlayers({ game }: { game: ReturnType<typeof findGame> & {} }) {
  const players = [
    { who: "@kojo", stake: "50 MON", side: "MOON", avatar: "🦊" },
    { who: "@degen42", stake: "25 MON", side: "DOOM", avatar: "💀" },
    { who: "@trench001", stake: "100 MON", side: "MOON", avatar: "🚀" },
  ];

  return (
    <div className="rounded-2xl overflow-hidden" style={{
      background: "linear-gradient(135deg, #0e0820, #0a0612)",
      border: "1px solid rgba(255,255,255,0.06)",
    }}>
      <div className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-2">
          <Users className="size-4" style={{ color: game.glow }} />
          <h3 className="font-black text-white text-sm">Live in this round</h3>
        </div>
        <span className="size-1.5 rounded-full bg-green-400 animate-pulse" />
      </div>
      <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
        {players.map((p) => (
          <div key={p.who} className="px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-full flex items-center justify-center text-base"
                style={{ background: "rgba(255,255,255,0.06)" }}>
                {p.avatar}
              </div>
              <span className="text-sm font-semibold text-white">{p.who}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tabular-nums" style={{ color: "rgba(245,243,255,0.6)" }}>{p.stake}</span>
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded"
                style={{
                  background: p.side === "MOON" ? "rgba(139,92,246,0.2)" : "rgba(239,68,68,0.2)",
                  color: p.side === "MOON" ? "#a855f7" : "#f87171",
                }}>
                {p.side}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Top Winners ──────────────────────────────────────────────────────────────
function TopWinners({ game }: { game: ReturnType<typeof findGame> & {} }) {
  const winners = [
    { rank: "🥇", who: "@kojo", winnings: "12,400 MON", wins: 84 },
    { rank: "🥈", who: "@trench001", winnings: "8,100 MON", wins: 61 },
    { rank: "🥉", who: "@mona", winnings: "6,800 MON", wins: 52 },
    { rank: "4", who: "@degen42", winnings: "4,200 MON", wins: 44 },
    { rank: "5", who: "@gasmaxxer", winnings: "3,900 MON", wins: 39 },
  ];

  return (
    <div className="rounded-2xl overflow-hidden" style={{
      background: "linear-gradient(135deg, #0e0820, #0a0612)",
      border: "1px solid rgba(255,255,255,0.06)",
    }}>
      <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <h3 className="font-black text-white text-sm">Top Winners (all time)</h3>
      </div>
      <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
        {winners.map((w) => (
          <div key={w.who} className="px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-base w-6 text-center">{w.rank}</span>
              <span className="text-sm font-semibold text-white">{w.who}</span>
            </div>
            <div className="text-right">
              <div className="text-sm font-black" style={{ color: "#22c55e" }}>{w.winnings}</div>
              <div className="text-[10px]" style={{ color: "rgba(245,243,255,0.4)" }}>{w.wins} wins</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── More Games ───────────────────────────────────────────────────────────────
function MoreGames({ current }: { current: string }) {
  const others = CASINO_GAMES.filter((g) => g.slug !== current).slice(0, 4);
  return (
    <div className="relative z-10 space-y-4">
      <h3 className="font-black text-white" style={{ fontSize: 18, textShadow: "0 2px 0 rgba(0,0,0,0.3)" }}>
        More Games
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {others.map((g) => (
          <Link key={g.slug} to="/casino/$game" params={{ game: g.slug }}
            className="group relative overflow-hidden rounded-xl p-4 flex flex-col items-center gap-2 text-center transition-all duration-150 hover:-translate-y-1"
            style={{
              background: `linear-gradient(150deg, ${g.from}, ${g.to})`,
              border: "1.5px solid rgba(255,255,255,0.1)",
              boxShadow: `0 6px 0 rgba(0,0,0,0.4), 0 0 20px ${g.glow}11`,
            }}>
            <div className="transition-transform duration-200 group-hover:scale-110">
              <GameArt kind={g.art} accent={g.glow} size={56} />
            </div>
            <div className="font-black text-white text-xs leading-tight">{g.name}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
