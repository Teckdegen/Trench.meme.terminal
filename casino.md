# trench.meme Casino — Developer Guide

The biggest PvP onchain casino on Monad. This document is the single source of
truth for the concept, the economics, the contract architecture, every game,
and the build order. A developer should be able to pick this up cold and build.

---

## 1. The Concept

Three rules define everything:

1. **Every game is PvP.** Players bet against other players' bags. There is no
   house bankroll, no game where the house is the counterparty. Every MON won
   was staked by another player.
2. **The pot is the payout.** Payouts are pari-mutuel (horse racing style):
   winners split what the losers staked, minus rake. Odds are never fixed; the
   UI always shows "your payout if you win right now" computed live from the
   pool.
3. **Fully onchain.** Game state lives in smart contracts on Monad. No
   database is the source of truth for money. Bets are NFTs (Uniswap V3
   position style). Randomness is commit reveal, verifiable by anyone.

The house's only role: hold escrow in the contract, enforce fairness, take a
rake on every settled pot. The house mathematically cannot lose and provably
cannot cheat. That is the marketing line: *"We don't play against you. We just
run the table."*

### Why Monad makes this viable

400ms blocks and sub cent gas mean 60 second roulette rounds and instant dice
duels are practical fully onchain. The same design is dead on arrival on
Ethereum mainnet.

---

## 2. Economics

### Rake

- A flat percentage (default **300 bps = 3%**, configurable per game, stored in
  the Vault) is skimmed from every settled pot and sent to the platform fee
  wallet (same wallet that receives trading fees).
- Rake is the ONLY house revenue. No edge, no spread, no float games.

### The two payout structures

**Duels (1v1 or small lobby).** Equal stakes escrowed from each player. Winner
receives `total_stakes − rake`. Ties either reroll (dice) or refund.

**Pari-mutuel pools.** Many players bet into one round, possibly on different
outcomes with different probabilities. On settlement:

```
rake          = total_pool × rake_bps / 10_000
losing_pool   = total_pool − winning_side_stakes
payout(i)     = stake(i) + (losing_pool − rake) × weight(i) / Σ weights(winners)
```

`weight(i)` adjusts for outcome probability so unlikely picks pay more. For
roulette: `weight = stake × (36 / numbers_covered)`. A straight number bet
carries 36× the weight of nothing; red/black carries ~2×. The absolute payout
still floats with the pool (this is intentional and must be communicated in
the UI as a live "projected payout" figure that updates as bets come in).

Edge cases that MUST be handled:
- **Everyone picked the winner** → losing pool is 0, everyone gets their stake
  back minus nothing (no rake on a push).
- **Nobody picked the winner** → entire pool minus rake rolls over into the
  next round of the same game (jackpot effect; do NOT send it to the house).
- **Single bettor in a pooled round** → round does not run; auto refund.

---

## 3. Contract Architecture

Foundry project, deployed on Monad (chain id 143). Suggested layout:

```
contracts/
├── TrenchCasinoVault.sol    escrow + pool accounting + rake skim
├── PositionNFT.sol          ERC-721 bet tickets, onchain SVG metadata
├── RandomBeacon.sol         commit reveal randomness manager
├── GameRegistry.sol         maps gameId → module address, governance adds games
└── games/
    ├── DuelEngine.sol       generic 1v1 / small lobby engine
    ├── PoolEngine.sol       generic pari-mutuel round engine
    └── <game adapters>      thin per-game modules on top of the two engines
```

### TrenchCasinoVault

- Holds all escrowed MON. Games never hold funds directly.
- `deposit(roundId)` payable, called by game modules on behalf of players.
- `settle(roundId, winners[], amounts[])` callable only by the registered game
  module for that round. Sends rake to `feeWallet`, credits winners as
  **claimable balances** (pull pattern — winners call `claim()`; never push
  transfers in a loop, one reverting recipient must not block a round).
- `refund(roundId)` for expired/cancelled rounds.
- Emergency: `pause()` stops new bets, never blocks claims/refunds.

### PositionNFT (the Uniswap idea)

Every bet mints an ERC-721 to the bettor. Token data (in contract storage,
rendered into `tokenURI` as onchain SVG, Uniswap V3 style):

```
gameId, roundId, pick (game specific encoding), stake, timestamp,
status: OPEN | WON | LOST | REFUNDED | CLAIMED
```

- **Claim = burn.** A WON ticket is burned to pull the payout from the Vault.
- Tickets are **freely transferable while OPEN** — this creates the secondary
  market for live bets (sell your crash ticket mid round, flip a roulette
  ticket before the spin). The claimer is whoever holds the NFT at settlement.
- LOST tickets persist as collectibles (dead ticket collection, loss
  leaderboards).
- The SVG ticket art shows game, pick, stake, round and status — it must look
  good in a wallet. This is marketing surface, treat it as such.

What NOT to do: do not mint individual playing cards as NFTs. Hands/cards are
encoded in the position's metadata. Cosmetic NFT decks/skins are a separate
collection sold later (Phase 6).

### RandomBeacon — two modes

**Duel mode (fully trustless, no operator):**
1. Each player submits `commit = keccak256(secret)` with their bet.
2. After the duel is matched, both reveal secrets within `REVEAL_WINDOW`
   (suggest 5 minutes).
3. `entropy = keccak256(secretA ‖ secretB ‖ roundId)`.
4. A player who fails to reveal **forfeits their stake** to the opponent
   (minus rake). This makes griefing strictly losing.
5. UX note: the frontend generates and stores the secret locally (localStorage
   keyed by duel id) and auto reveals. The user never sees this mechanic.

**Pool mode (operator commit, verifiable, punishable):**
1. Round opens: operator submits `commit = keccak256(seed)` in the same tx.
2. Betting closes at `closeBlock`.
3. Operator reveals `seed` after `closeBlock + 2`;
   `entropy = keccak256(seed ‖ blockhash(closeBlock + 1) ‖ roundId)`.
4. If the operator does not reveal within `REVEAL_WINDOW`, **anyone** can call
   `voidRound()` → full refunds, no rake. The operator's only possible attack
   is refusing to reveal, and the contract makes that a pure loss.
5. If Chainlink VRF or Pyth Entropy ships on Monad, swap this module without
   touching games (the beacon is behind an interface).

### Keeper functions

`closeRound()`, `settleRound()`, `expireDuel()`, `voidRound()` are all
**permissionless** — anyone may call them (gas refund + small bounty paid from
the pot is a nice touch). The trench bot calls them first in practice; the
design must not depend on the bot being honest or alive.

---

## 4. The Games

Engine column says which generic engine the adapter sits on. Resolution is the
exact rule the contract enforces.

### Wave 1 — prove the rails

| # | Game | Engine | Resolution |
|---|------|--------|-----------|
| 1 | **Dice Duel** | Duel | Each player's roll = `entropy % 10000` salted with their address. Higher wins. Tie → reroll with nonce++. |
| 2 | **Coinflip / War** | Duel | One bit / one card from entropy per player. Higher card wins; war (tie) → reroll. |
| 3 | **RPS** | Duel | The commit IS the move: `commit = keccak(move ‖ salt)`. Classic textbook contract. Tie → refund minus zero rake. |

### Wave 2 — the live tables

| # | Game | Engine | Resolution |
|---|------|--------|-----------|
| 4 | **Roulette** | Pool | Shared spin every 60s (only if ≥2 bettors with opposing outcomes). `result = entropy % 37`. Picks: straight, red/black, odd/even, dozens, columns. Pari-mutuel weights as in §2. |
| 5 | **Crash** | Pool | Bust point derived from entropy with median ~2x distribution: `bust = max(1, (2^32 / (entropy % 2^32)) × house_curve)`. Players cash out onchain (tx must land before bust block). Busters' stakes split among cashed out players weighted by cashout multiplier. |

### Wave 3 — cheap engine clones

| # | Game | Engine | Resolution |
|---|------|--------|-----------|
| 6 | **Limbo Duel** | Duel | Both pick target multiplier at bet time. Shared entropy gives one roll `r`. Survivors = players whose target ≤ r. Survivor with the higher target wins; both bust → higher target loses (punish greed) or refund — pick one and document it. |
| 7 | **Plinko Race** | Duel (lobby 2–8) | Same board seed, one ball path per player derived from `entropy ‖ address`. Best slot multiplier takes the pot. Ties split. |
| 8 | **Jackpot Wheel** | Pool | One pot. `winner` drawn with probability proportional to stake. The purest pari-mutuel. |
| 9 | **Lightning Lottery** | Pool | 60 second micro lottery, one winner takes pool minus rake. Runs forever. |

### Wave 4 — depth

| # | Game | Engine | Resolution |
|---|------|--------|-----------|
| 10 | **Mines Duel** | Duel | Identical hidden 5×5 board (same entropy), each player picks tiles until they hit a bomb (picks submitted as a committed sequence to keep it one tx). Most safe tiles wins. |
| 11 | **Keno** | Pool | 10 numbers drawn from entropy. Tickets weighted by match count table. Best matches split the pot. |
| 12 | **Tower Duel** | Duel | Mines variant: same tower, committed climb sequences, higher floor wins. |
| 13 | **Last Degen Standing** | Duel (lobby 6–10) | Elimination each round from entropy until one survivor. Pot to survivor. |
| 14 | **Sic Bo** | Pool | Three dice from entropy, standard bet board, pari-mutuel weights. |

### Wave 5 — card engines

| # | Game | Engine | Resolution |
|---|------|--------|-----------|
| 15 | **Blackjack Duel** | Duel | Same shoe from entropy. Both players play vs the deck (committed hit/stand strategy or turn based with short clocks). Closest to 21 without bust takes the pot. Push → refund. |
| 16 | **Baccarat** | Pool | Standard coup dealt from entropy. Player pool vs Banker pool vs Tie pool, losing pools pay winning pool. |
| 17 | **Video Poker Duel** | Duel | Same deck, one committed draw each, best 5 card hand wins. |
| 18 | **Hi-Lo Ladder Duel** | Duel | Same card stream, committed guess sequences, longer correct streak wins. |

### Wave 6 — Up / Down (the ONLY token game)

One price game, done perfectly. No token battles, no pump roulettes, no
volume races — they dilute the casino. Up / Down is the whole category.

| # | Game | Engine | How it works |
|---|------|--------|--------------|
| 19 | **Up / Down** | Duel (P2P matched) | Pick an asset, pick UP or DOWN, pick a stake. Your bet sits on the open book until another user takes the OPPOSITE side at the same stake — the moment it matches, the round fires. |

**The flow:**

1. Player A picks asset (MON or a whitelisted token), direction (UP or DOWN),
   stake, and a window (1 / 5 / 15 minutes).
2. The bet sits on an open order book, visible to everyone, cancellable and
   auto refunded after expiry (default 10 min) if nobody matches it.
3. Player B takes the opposite direction at the same stake → **match fires**.
   The contract draws **the line**: the asset's price anchored at the match
   block (two block TWAP from the canonical DEX pool — never our API).
4. When the window closes, the contract reads the close price the same way:
   - close above the line → UP wins the pot minus rake
   - close below the line → DOWN wins
   - exactly on the line → both refunded, no rake
5. Both positions are NFTs while live — a winning looking Up ticket at minute
   3 of 5 is sellable on the ticket market.

**Asset list:** MON to start, plus a small curated set of tokens added by the
team (governance/admin function `allowAsset(pool)` — the asset must have a
deep enough canonical pool for the TWAP to be manipulation resistant; thin
curve tokens are NOT eligible).

**Why P2P matching instead of a pool:** the matched opposite side IS the
pricing. No line setting, no odds math — UP money equals DOWN money by
construction, the fairest possible price bet. The open book also doubles as
content: "3 degens are longing MON at 50 each, someone fade them."

Settlement reads **onchain state only** (anchored TWAP snapshots from the DEX
pool). The settle function recomputes from chain data anyone can verify.

### Wave 7 — Poker: always on Hold'em cash tables (the crown jewel)

The purest PvP game in existence: 100% of the money on the table belongs to
players, the house rakes pots. Persistent tables that never close — sit down
with a stack, play, stand up whenever.

| # | Game | Format |
|---|------|--------|
| 20 | **Heads Up Hold'em** | 2 seat cash tables. Ship FIRST — two players makes the hidden card problem and the turn logic vastly simpler. |
| 21 | **6 Max Hold'em** | Standard cash tables, multiple stake tiers (e.g. 1/2, 5/10, 25/50 MON blinds). |
| 22 | **Sit & Go tournaments** | 6 players, fixed buy in, blinds escalate, last stack takes the prize pool. Reuses the cash table engine. |
| 23 | **Omaha** | Same engine, 4 hole cards. Free once Hold'em works. |

**Seat = Position NFT.** Sitting down escrows your buy in into the Vault and
mints a Seat NFT encoding table id, seat index and current stack. Standing up
burns it and withdraws the stack. The seat is transferable while sitting —
selling a live seat mid session is allowed and very on brand.

**Betting flow.** Turn based contract calls: `fold / check / call / bet(x) /
raise(x)`, enforced order, per action clock (suggest 30s; timeout = auto
check/fold so a disconnect never stalls the table). Blinds posted
automatically each hand by the contract. Side pots computed onchain (this is
the fiddly part — test exhaustively). Rake per pot, capped like real card
rooms (e.g. 3% capped at 5 MON), no rake on hands that end preflop ("no flop,
no drop").

**The hidden card problem.** Hole cards must stay secret during the hand but
be provably un-rigged. Three schemes, in order of trust minimization:

1. **Mental poker (fully trustless).** Players cooperatively encrypt and
   shuffle the deck; no party ever knows a card until its reveal. Gold
   standard, but interaction heavy and a disconnecting player stalls the
   table. Viable for heads up; painful for 6 max.
2. **zk shuffle dealer (recommended target).** A dealer service shuffles and
   deals encrypted cards with zero knowledge proofs that the shuffle was a
   valid permutation of a standard deck (zkHoldem style). Smooth UX,
   cryptographic fairness, works at 6 max. This is the production scheme.
3. **Commit reveal dealer (pragmatic v1).** Dealer commits `hash(shuffled
   deck ‖ salt)` before the hand; at hand end the full deck is revealed and
   verified against the commitment, and every dealt card must match. Players
   trust the dealer not to peek DURING the hand, but any rigging is provable
   after the fact and slashes the dealer's bond. Acceptable to launch heads
   up tables while the zk scheme is built; the dealer posts a slashable bond
   ≥ the table's max buy in.

**Rollout inside Wave 7:** heads up cash (scheme 3, bonded dealer) → zk
shuffle dealer swap in → 6 max cash → Sit & Go → Omaha.

### Social / format layer (not games, multipliers on everything)

- **Challenge anyone**: duel button on profiles and in cabal chat. A challenge
  message deep links to an escrow ready duel.
- **Tournaments**: weekly brackets, entry fees pool into the prize, Position
  NFTs as trophies.
- **Cabal vs Cabal**: team pots, cabal leaderboards, war weekends.
- **Seasons**: rake volume mints season points → cosmetic decks/skins for top
  100. Computed entirely from contract events.
- **Ticket market**: UI over PositionNFT transfers — list/buy live OPEN
  tickets. Start with fixed price listings; royalty = extra rake bps on ticket
  sales.
- **Parlay forging** (later): burn N winning tickets to mint a combined odds
  ticket for a future round.

---

## 5. Frontend Integration

Stack stays what the app already uses; the casino adds routes, not infra.

- **Signing**: bets go through the existing Para server signing path
  (`sendViaPara`) — users never see a popup. A bet is one contract call:
  `placeBet(gameId, roundId, pick, commit)` with MON value.
- **Reads**: round state, open duels, pools, history — all from contract view
  functions + event logs over RPC (the codebase already does chain reads in
  `discovery-api.ts`). Poll at 2–5s; Monad blocks are 400ms so this feels live.
  No Supabase for any money state. (A read side indexer/cache is allowed later
  purely for leaderboard speed — it must be reconstructible from events.)
- **Live layer**: Gun.js (already running for DMs/cabals) carries table chat,
  presence, "X joined the pot" pings, win ticker. Never money.
- **Routes**:
  - `/casino` — lobby. Stake style card grid (purple/black skin), live counts
    (open duels, current pots, next spin countdown), wins ticker, global chat.
  - `/casino/<game>` — game room. Duel games: challenge board (open
    challenges, create with stake, accept, my duels, recent results). Pool
    games: shared table (betting window countdown, everyone's bets visible
    live, projected payout per pick, result history strip, verify link).
- **Verify panel**: every settled round/duel page recomputes the outcome
  client side from the revealed seed + commits and shows green checks. This is
  the provably fair receipt and must be one click from every result.
- **Sidebar**: Casino nav item (dices icon) next to Dashboard.

### UX invariants

- Projected payout updates live as pools change (pari-mutuel demands this).
- Unmatched duels show countdown to auto refund (default expiry: 10 minutes).
- Every settle shows the onchain tx hash.
- The reveal/commit mechanics are invisible: secrets generated and stored
  client side automatically, auto revealed by the app (and by the bot as a
  backstop if the user closes the tab — see keeper).

---

## 6. Bot / Keeper Duties

The existing trench bot gets a casino worker. Everything it calls is
permissionless; it is a convenience, not a trust assumption.

- `closeRound()` / `settleRound()` on pooled games at the betting deadline.
- Reveal operator seeds for pool rounds (the bot holds the seed pre image).
- `expireDuel()` → refunds for challenges nobody accepted.
- Auto reveal backstop for duel players who went offline (only possible if
  the player opted to escrow their secret with the bot — optional convenience,
  default is client side).
- Push settle events into the Gun ticker and notifications.

---

## 7. Security Checklist (non negotiable before real TVL)

- [ ] Pull payments only (claimable balances), never push loops.
- [ ] Reentrancy guards on deposit/claim/refund.
- [ ] Checks effects interactions everywhere; settle is idempotent.
- [ ] No round can be settled twice; no ticket claimed twice (burn on claim).
- [ ] `voidRound()` path tested: operator disappearing = everyone refunded.
- [ ] Reveal griefing economics verified (non revealer always loses).
- [ ] Bet caps per round configurable; start small, raise with confidence.
- [ ] Pause stops bets but NEVER blocks claims/refunds.
- [ ] Fuzz the pari-mutuel math (rounding dust: round payouts down, sweep dust
      to next round's pool, never to the house).
- [ ] Block stuffing / MEV review for crash cashouts and close blocks.
- [ ] External audit before raising bet caps past launch limits. This contract
      holds everyone's bags; treat it like a DEX.
- [ ] Jurisdiction/geo gating decision made before public launch (this is
      real money gambling).

---

## 8. Build Order

| Phase | Deliverable |
|-------|------------|
| 1 | Foundry repo: Vault + PositionNFT + RandomBeacon + DuelEngine + DiceDuel. Full test suite. Monad testnet deploy. |
| 2 | `/casino` lobby + dice challenge board reading pure chain state. Para signed bets. Verify panel. |
| 3 | PoolEngine + Roulette (the flagship live table) + Lightning Lottery (engine reuse smoke test). |
| 4 | Crash + the ticket secondary market UI (PositionNFT transfers). |
| 5 | Waves 3–4 games, one per week. Tournaments + cabal wars. |
| 6 | Card engines (Wave 5), Up / Down (Wave 6), cosmetic NFT decks, seasons. |
| 7 | Poker (Wave 7): heads up cash with bonded dealer → zk shuffle → 6 max → Sit & Go → Omaha. |
| — | Audit gate before lifting launch bet caps. |

### Config defaults (tune later, ship with these)

| Param | Default |
|-------|---------|
| Rake | 300 bps |
| Duel expiry | 10 min |
| Reveal window | 5 min |
| Pool round cadence (roulette/lottery) | 60s, skip if <2 opposing bettors |
| Launch bet caps | 1–500 MON per position |
| Keeper bounty | 0.1% of pot, from rake share |

---

## 9. What this is NOT

- Not a house banked casino: no game's payout ever depends on a treasury.
- Not third party content: no Pragmatic/Evolution/etc. Those require a
  gambling license + aggregator contracts and are a separate business decision
  (Phase "later, maybe"). Everything here is original, owned, onchain.
- Not database gambling: if Supabase dies, every balance, bet, and payout is
  still fully recoverable from chain state. The contract is the casino.
