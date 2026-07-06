import { createFileRoute, Link } from "@tanstack/react-router";
import { CASINO_GAMES, type CasinoGame } from "@/lib/casino-games";
import { GameArt } from "@/components/casino/GameArt";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export const Route = createFileRoute("/casino")({ component: CasinoLobby });

// ─── Category definitions ─────────────────────────────────────────────────────
const CATEGORIES = [
  {
    label: "Degen Games",
    emoji: "🎲",
    slugs: ["moondoom", "sendit", "degenwheel", "chamber", "knifecatcher"],
  },
  {
    label: "Mind Games",
    emoji: "🧠",
    slugs: ["capper", "exitscam", "diamondhands", "gaswar"],
  },
  {
    label: "Market Games",
    emoji: "📈",
    slugs: ["pumpdump", "rugrun", "whalethrone"],
  },
  {
    label: "Table Games",
    emoji: "🃏",
    slugs: ["poker"],
  },
];

function CasinoLobby() {
  useDocumentTitle("Casino · trench.meme");

  return (
    <div className="space-y-8 pb-10" style={{ background: "#000", minHeight: "100%" }}>

      {/* ── Top tabs ── */}
      <TopTabs />

      {/* ── Category sections ── */}
      {CATEGORIES.map((cat) => {
        const games = cat.slugs
          .map((s) => CASINO_GAMES.find((g) => g.slug === s))
          .filter(Boolean) as CasinoGame[];
        if (!games.length) return null;
        return (
          <section key={cat.label}>
            <SectionHeader label={cat.label} emoji={cat.emoji} />
            <ScrollRow games={games} />
          </section>
        );
      })}

      {/* ── Recent bets feed ── */}
      <RecentBets />
    </div>
  );
}

// ─── Top filter tabs ──────────────────────────────────────────────────────────
const TABS = ["Lobby", "Degen Games", "Mind Games", "Market Games", "New Releases"];

function TopTabs() {
  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide pb-1 pt-1">
      {TABS.map((t, i) => (
        <button
          key={t}
          className="shrink-0 px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors"
          style={i === 0
            ? { background: "#a855f7", color: "#fff" }
            : { background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.55)" }
          }
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ label, emoji }: { label: string; emoji: string }) {
  return (
    <div className="flex items-center justify-between mb-4 px-0.5">
      <h2 className="font-black text-white flex items-center gap-2" style={{ fontSize: 18 }}>
        {emoji} {label}
      </h2>
      <button className="text-xs font-semibold" style={{ color: "#a855f7" }}>
        See all →
      </button>
    </div>
  );
}

// ─── Horizontal scroll row of game cards ─────────────────────────────────────
function ScrollRow({ games }: { games: CasinoGame[] }) {
  return (
    <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 -mx-1 px-1">
      {games.map((g) => (
        <GameCard key={g.slug} game={g} />
      ))}
    </div>
  );
}

// ─── Game card — reference style: art fills the card, name at bottom ─────────
function GameCard({ game }: { game: CasinoGame }) {
  return (
    <Link
      to="/casino/$game"
      params={{ game: game.slug }}
      className="group relative shrink-0 overflow-hidden transition-all duration-150 hover:scale-[1.04] active:scale-[0.97]"
      style={{
        width: 150,
        height: 200,
        borderRadius: 16,
        background: `linear-gradient(160deg, ${game.from} 0%, ${game.to} 100%)`,
        boxShadow: `0 6px 0 rgba(0,0,0,0.6), 0 0 20px ${game.glow}22`,
      }}
    >
      {/* Glow blob */}
      <div className="absolute -top-6 -right-6 pointer-events-none opacity-70 group-hover:opacity-100 transition-opacity"
        style={{
          width: 110, height: 110,
          background: `radial-gradient(circle, ${game.glow}99, transparent 65%)`,
          filter: "blur(10px)",
        }}
      />

      {/* Status chip */}
      {game.status === "live" && (
        <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide"
          style={{ background: "#22c55e", color: "#000" }}>
          <span className="size-1.5 rounded-full bg-black animate-pulse inline-block" />
          Live
        </div>
      )}

      {/* Cartoon art — centered, big */}
      <div className="absolute inset-0 flex items-center justify-center"
        style={{ paddingBottom: 36 }}>
        <div className="transition-transform duration-200 group-hover:scale-[1.12] group-hover:-rotate-3"
          style={{ filter: `drop-shadow(0 8px 16px rgba(0,0,0,0.6)) drop-shadow(0 0 12px ${game.glow}66)` }}>
          <GameArt kind={game.art} accent={game.glow} size={90} />
        </div>
      </div>

      {/* Name bar at bottom */}
      <div className="absolute bottom-0 left-0 right-0 px-3 py-2.5"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)" }}>
        <div className="font-black text-white leading-tight" style={{ fontSize: 13, textShadow: "0 1px 0 rgba(0,0,0,0.5)" }}>
          {game.name}
        </div>
        <div className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>
          {game.status === "live" ? "PvP · 6% rake" : "Coming soon"}
        </div>
      </div>

      {/* Bottom hover glow bar */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        style={{ background: `linear-gradient(90deg, transparent, ${game.glow}, transparent)` }}
      />
    </Link>
  );
}

// ─── Recent bets feed ─────────────────────────────────────────────────────────
const FEED_TABS = ["All Bets", "Lucky Wins", "Degens", "Races"];

const BETS = [
  { game: "🎲 Dice", user: "@kojo",      time: "10:01 AM", bet: "0.00050 MON", mult: "1.02×", payout: "0.00051 MON", win: true },
  { game: "🪅 Plinko", user: "@swanzzz",  time: "10:01 AM", bet: "0.00020 MON", mult: "0.80×", payout: "0.00016 MON", win: false },
  { game: "🎲 Dice", user: "@kojo",      time: "10:01 AM", bet: "0.00050 MON", mult: "1.10×", payout: "0.00055 MON", win: true },
  { game: "🪅 Plinko", user: "@swanzzz",  time: "10:01 AM", bet: "0.00020 MON", mult: "0.80×", payout: "0.00016 MON", win: false },
  { game: "💀 Chamber", user: "@degen42", time: "10:02 AM", bet: "10 MON",      mult: "4.70×", payout: "47 MON",      win: true },
  { game: "🚀 Send It", user: "@mona",    time: "10:02 AM", bet: "25 MON",      mult: "1.88×", payout: "47 MON",      win: true },
  { game: "📈 P/D",   user: "@trench001", time: "10:03 AM", bet: "50 MON",      mult: "0×",    payout: "0 MON",       win: false },
];

function RecentBets() {
  return (
    <div className="rounded-2xl overflow-hidden" style={{
      background: "#0a0612",
      border: "1px solid rgba(255,255,255,0.07)",
    }}>
      {/* Feed tabs */}
      <div className="flex items-center gap-0 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
        {FEED_TABS.map((t, i) => (
          <button
            key={t}
            className="px-4 py-3 text-xs font-bold whitespace-nowrap transition-colors"
            style={i === 0
              ? { color: "#a855f7", borderBottom: "2px solid #a855f7" }
              : { color: "rgba(255,255,255,0.45)" }
            }
          >
            {t}
          </button>
        ))}
      </div>

      {/* Table header */}
      <div className="grid px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide"
        style={{
          gridTemplateColumns: "1.4fr 1.2fr 0.9fr 1.1fr 0.7fr 1.1fr",
          color: "rgba(255,255,255,0.35)",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}>
        <span>Game</span>
        <span>User</span>
        <span>Time</span>
        <span>Bet</span>
        <span>Multiplier</span>
        <span>Payout</span>
      </div>

      {/* Rows */}
      {BETS.map((b, i) => (
        <div key={i}
          className="grid px-4 py-2.5 items-center hover:bg-white/[0.02] transition-colors"
          style={{
            gridTemplateColumns: "1.4fr 1.2fr 0.9fr 1.1fr 0.7fr 1.1fr",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}>
          <span className="text-xs font-semibold text-white">{b.game}</span>
          <span className="flex items-center gap-1.5">
            <span className="size-5 rounded-full flex items-center justify-center text-[10px]"
              style={{ background: "rgba(168,85,247,0.2)" }}>
              {b.user[1].toUpperCase()}
            </span>
            <span className="text-xs font-semibold" style={{ color: "#a855f7" }}>{b.user}</span>
          </span>
          <span className="text-xs tabular-nums" style={{ color: "rgba(255,255,255,0.45)" }}>{b.time}</span>
          <span className="text-xs font-mono tabular-nums" style={{ color: "rgba(255,255,255,0.7)" }}>{b.bet}</span>
          <span className="text-xs font-bold tabular-nums" style={{ color: b.win ? "#22c55e" : "#ef4444" }}>{b.mult}</span>
          <span className="text-xs font-bold tabular-nums" style={{ color: b.win ? "#22c55e" : "#ef4444" }}>{b.payout}</span>
        </div>
      ))}
    </div>
  );
}
