// Casino game catalog for the /casino lobby. Names + taglines mirror casino.md
// (trench-named PvP games). `art` picks the cartoon SVG; `hue` drives the card
// gradient (all within the trench purple/black palette, with a few accent hues
// for variety — kept dark so it stays on-brand).

export type GameStatus = "live" | "soon";

export type CasinoGame = {
  slug: string;
  name: string;
  tagline: string;
  status: GameStatus;
  art: string;          // GameArt kind
  from: string;         // gradient start
  to: string;           // gradient end
  glow: string;         // accent glow color
};

export const CASINO_GAMES: CasinoGame[] = [
  { slug: "moondoom",   name: "Moon or Doom", tagline: "The 50/50 flip. Call it, double it.",     status: "soon", art: "coin",    from: "#7c3aed", to: "#3b0764", glow: "#a855f7" },
  { slug: "sendit",     name: "Send It",      tagline: "High-roll dice duel. Higher sends it.",    status: "soon", art: "dice",    from: "#6d28d9", to: "#2e1065", glow: "#8b5cf6" },
  { slug: "rugrun",     name: "Rug Run",      tagline: "Ride the pump, exit before the rug.",      status: "soon", art: "rocket",  from: "#9333ea", to: "#4a1d96", glow: "#c084fc" },
  { slug: "pumpdump",   name: "Pump or Dump", tagline: "MON up or down. 5-minute market.",         status: "soon", art: "chart",   from: "#5b21b6", to: "#1e1035", glow: "#a855f7" },
  { slug: "degenwheel", name: "Degen Wheel",  tagline: "Shared spin. Winners split the pool.",     status: "soon", art: "wheel",   from: "#7e22ce", to: "#3b0764", glow: "#d946ef" },
  { slug: "chamber",    name: "Chamber",      tagline: "6 degens, one bullet. Survivors split.",   status: "soon", art: "bullet",  from: "#7f1d1d", to: "#2e1065", glow: "#ef4444" },
  { slug: "exitscam",   name: "Exit Scam",    tagline: "Hold or dump the bag. Trust nobody.",      status: "soon", art: "vault",   from: "#6d28d9", to: "#2a1150", glow: "#a855f7" },
  { slug: "diamondhands", name: "Diamond Hands", tagline: "Nerve vs nerve. First to fold loses.",  status: "soon", art: "diamond", from: "#4c1d95", to: "#0e1b3a", glow: "#38bdf8" },
  { slug: "capper",     name: "Capper",       tagline: "Liar's dice. Call the cap or fold.",       status: "soon", art: "mask",    from: "#701a75", to: "#2e1065", glow: "#e879f9" },
  { slug: "whalethrone", name: "Whale Throne", tagline: "Seize the throne. Last whale wins the pot.", status: "soon", art: "crown", from: "#854d0e", to: "#2e1065", glow: "#facc15" },
  { slug: "knifecatcher", name: "Knife Catcher", tagline: "8 in, one out. Catch the falling knife.", status: "soon", art: "knife", from: "#831843", to: "#2e1065", glow: "#fb7185" },
  { slug: "gaswar",     name: "Gas War",      tagline: "Sealed all-pay auction. Highest bid takes it.", status: "soon", art: "gavel", from: "#5b21b6", to: "#1e1035", glow: "#a855f7" },
  { slug: "poker",      name: "Degen Poker",  tagline: "Always-on Hold'em. Onchain, zero rake to the house but 6%.", status: "soon", art: "cards", from: "#166534", to: "#0e2a1a", glow: "#22c55e" },
];

export function findGame(slug: string): CasinoGame | undefined {
  return CASINO_GAMES.find((g) => g.slug === slug);
}
