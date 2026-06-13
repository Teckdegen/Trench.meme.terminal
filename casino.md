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

- A flat percentage (default **1000 bps = 10%**, configurable per game, stored in
  the Vault) is skimmed from every settled pot and sent to the platform fee
  wallet (same wallet that receives trading fees).
- Rake is the ONLY house revenue. No edge, no spread, no float games.

### The two payout structures

**Duels (1v1 or small lobby).** Stakes do NOT have to be equal — a bet can
match any opposing bet whose stake is within the match tolerance (default
**35%**, `MATCH_TOLERANCE_BPS = 3500`, configurable). Unequal stakes ARE the
odds: if A stakes 50 and B stakes 40, the pot is 90 — A risks 50 to win 40,
B risks 40 to win 50. Winner takes the whole pot minus rake. This makes the
open challenge boards liquid: you never wait for an exact stake twin, you
take the closest opponent. Ties: reroll where the game allows it (dice,
war); where it can't, the round settles as a push — rake is still taken,
the remainder returns pro rata.

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

Edge cases — the rules:
- **The house ALWAYS takes its cut.** Rake is skimmed on every round that
  settles, no exceptions — wins, pushes, ties. The only rake free path is a
  pure refund (unmatched bet, voided round that never ran).
- **Everyone picked the winner — impossible by construction.** A round only
  FIRES when at least two different outcomes are backed (opposing picks
  matched). One sided rounds never run; those bets are refunded at lock. So
  an all winners settlement cannot occur.
- **Nobody picked the winner → the house wins the pool.** If every backed
  outcome loses (e.g. roulette lands on a number nobody covered), the entire
  pool goes to the house. That is the bet you made and lost — there is
  always a loser, and when everyone loses, the counterparty is the house.
- **Single bettor in a pooled round** → round does not fire; auto refund.

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

- **Every ticket ends burned. No exceptions.** Tickets are round artifacts,
  not collectibles — after a round resolves, no ticket from it may keep
  existing:
  - WON → burned by the holder's `claim()` call (burn and payout are one
    atomic action; you cannot claim without burning).
  - LOST → burnable by anyone after settlement via a permissionless
    `sweepBurn(roundId)` that batch burns all dead tickets of a round. The
    keeper bot calls it right after settling; holders can also burn their
    own early.
  - REFUNDED → burned by the refund call itself, same atomic pattern as
    claim.
- **Burning is safe by construction:** a ticket's value lives in the Vault's
  accounting, not in the token id — sweep burning a LOST ticket destroys
  nothing of value, and a WON ticket can never be burned by anyone except
  its holder claiming it.
- Tickets are **freely transferable while OPEN** — this creates the secondary
  market for live bets (sell your crash ticket mid round, flip a roulette
  ticket before the spin). The claimer is whoever holds the NFT at settlement.
- The SVG ticket art shows game, pick, stake, round and status — it must look
  good in a wallet while live. This is marketing surface, treat it as such.

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

**Pool mode (pure onchain, no operator at all):**
1. A round's betting window closes at a fixed `lockBlock` (block height, not
   a function call — bets after it simply revert).
2. `entropy = keccak256(blockhash(lockBlock + 1) ‖ roundId ‖ lastBetTxSalt)`
   where `lastBetTxSalt` is a salt accumulated from every bet placed (each
   bet folds `keccak(sender ‖ amount ‖ pick)` into the round's salt). No
   seed, no reveal, no operator, nothing offchain.
3. The entropy block (`lockBlock + 1`) is AFTER betting closed, so no bettor
   can position against a known outcome. Block producer influence is the
   residual risk — acceptable at launch bet caps on Monad's decentralized
   validator set, and mitigated by the accumulated bet salt.
4. If `blockhash(lockBlock + 1)` is no longer available when settlement is
   first triggered (>256 blocks passed with zero interactions — minutes on
   Monad), the round voids and everyone refunds. With any activity at all
   this never happens.
5. If Chainlink VRF or Pyth Entropy ships on Monad, swap this module without
   touching games (the beacon is behind an interface).

### Self driving rounds — no keeper, no bot, no server

The contracts run themselves. There is no privileged operator and no offchain
process the casino depends on:

- **Time is block height.** Betting windows open and close by block number.
  Nothing "closes" a round — a bet after `lockBlock` reverts, period.
- **The poke pattern.** Every state transition (settle the previous round,
  expire a stale duel, sweep burn dead tickets) is a permissionless function
  folded into normal player actions: placing a bet on the next round
  automatically settles the previous one in the same tx; claiming triggers
  settlement if it hasn't run yet. The players ARE the keeper.
- **A small caller bounty** (paid from rake) makes triggering transitions
  profitable, so even a dead frontend doesn't stall rounds — anyone with a
  wallet can poke.
- The trench bot MAY poke as a convenience for latency, but the system is
  fully alive without it. If every server we run disappears, the casino keeps
  settling.

---

## 4. The Games

Engine column says which generic engine the adapter sits on. Resolution is the
exact rule the contract enforces.

### Wave 1 — prove the rails

| # | Game | Engine | Resolution |
|---|------|--------|-----------|
| 1 | **Dice Duel** | Duel | Each player's roll = `entropy % 10000` salted with their address. Higher wins. Tie → reroll with nonce++. |
| 2 | **Coinflip / War** | Duel | One bit / one card from entropy per player. Higher card wins; war (tie) → reroll. |
| 3 | **RPS** | Duel | The commit IS the move: `commit = keccak(move ‖ salt)`. Classic textbook contract. Tie → settles as a push: rake taken, remainder returned. |

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
| 15 | **Blackjack Duel** | Duel | Same shoe from entropy. Both players play vs the deck (committed hit/stand strategy or turn based with short clocks). Closest to 21 without bust takes the pot. Push → rake taken, remainder returned. |
| 16 | **Baccarat** | Pool | Standard coup dealt from entropy. Player pool vs Banker pool vs Tie pool, losing pools pay winning pool. |
| 17 | **Video Poker Duel** | Duel | Same deck, one committed draw each, best 5 card hand wins. |
| 18 | **Hi-Lo Ladder Duel** | Duel | Same card stream, committed guess sequences, longer correct streak wins. |

### Wave 6 — Up / Down (the ONLY token game)

One price game, done perfectly. No token battles, no pump roulettes, no
volume races — they dilute the casino. Up / Down is the whole category, and
it is deliberately rigid:

- **One asset: MON.** Nothing else. No whitelist, no token picker.
- **One market: the 5 minute round.** No window options.
- **Five stake tiers, nothing in between:** 5 / 10 / 25 / 50 / 100 MON
  (constants in the contract, adjustable only by governance).

| # | Game | Engine | How it works |
|---|------|--------|--------------|
| 19 | **MON Up / Down** | Tier matched round | Rounds run back to back, 5 minutes each. During the betting window you pick UP or DOWN and one of the 5 stake tiers. Bets are matched 1:1 against the opposite side at the same tier. The round can hold 100+ players — it is just many matched pairs sharing one line. |

**FULLY OFFCHAIN game, onchain money.** This is the key architecture point:
the contract (`UpDown.sol`) is *just a vault* — it takes bets and pays out.
Everything else (matching UP vs DOWN into winner/loser pairs, drawing the
line from the live MON price, the win math) runs in the trench **bot
offchain**. That is what lets a single round hold **a million players at
once** — there are no onchain matching loops, just escrow in and payout out.

**The flow:**

1. A round opens (5 minutes). Players `bet(UP/DOWN)` with one of the five tier
   amounts. Each bet is escrowed into the Vault and mints a ticket. The UI
   shows live depth per tier ("UP 12,400 × 25 MON vs DOWN 11,900 × 25 MON").
2. Matching is computed **offchain** by the bot, per tier: every UP bet is
   paired against an equal-tier DOWN bet — always a winner mapped to a loser.
   Unmatched bets (the spillover on the heavier side) are simply refunded.
3. After 5 minutes the bot reads the live MON price and computes the whole
   result offchain: who is paired with whom, the line, and each winner's
   payout (their stake back + their matched loser's stake, minus rake).
4. The bot calls `resolve(roundId, winners, amounts, winTickets, loseTickets,
   monPrice)`. The contract pays out through the Vault, which **caps total
   payout at the round's escrowed pool and skims the 10% rake** — so the bot
   can never over-pay even if it computes wrong. The `monPrice` is recorded in
   the `Resolved` event for public audit.
   - close above the line → UP side wins each pair
   - close below the line → DOWN side wins each pair
   - dead on the line → push: rake taken, stakes returned
5. The next round is already open. The market never sleeps.

**Why this is safe despite the offchain logic:**
- The Vault enforces conservation — a round cannot pay out more than it took
  in, so a buggy or malicious bot cannot drain anything.
- Every winner is funded by exactly one equal-tier loser, so the pot always
  covers the bills with zero house exposure.
- If the bot ever goes down, anyone can call `reclaim(roundId)` after 1 hour
  and every player gets their stake back. The bot cannot trap funds.
- The settled `monPrice` is on-chain in events; anyone can verify the result
  against the real MON price at that time.

**Trust model:** the bot is trusted only to compute the pairing + price
correctly (same trust as any price feed). It cannot touch funds outside a
round, cannot over-pay, and cannot rug.

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
rooms (10% capped at 5 MON per pot), no rake on hands that end preflop ("no flop,
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

#### How the zk shuffle actually works (scheme 2, the production target)

The goal stated precisely: every player must be convinced the deck is a
honest random permutation of 52 known cards, while no party — players,
dealer, us — learns ANY card before its legitimate reveal, and hole cards
are learnable only by their owner. The construction (this is the
zkShuffle / mental poker lineage: Barnett–Smart style protocols with modern
SNARK shuffle proofs):

**1. Setup — the table key.**
At table start the seated players (plus optionally the dealer service) run a
distributed key generation: each party i picks a secret `sk_i` and publishes
`pk_i = g^sk_i`. The aggregate public key is `PK = Π pk_i`. Anything
encrypted to `PK` can only be decrypted with ALL parties cooperating —
no single party (including us) can peek.

**2. Encode and encrypt the deck.**
The 52 cards are fixed public group elements `m_1..m_52`. Each is encrypted
under ElGamal to the table key: `c_j = (g^r_j, m_j · PK^r_j)`. At this point
the ciphertext order is known, so nothing is hidden yet.

**3. Shuffle with a zero knowledge proof.**
Each shuffling party in turn (players sequentially, or the dealer service
once) takes the ciphertext list and outputs a new list where every
ciphertext is RE-ENCRYPTED (re-randomized — same plaintext, unlinkable new
ciphertext) and PERMUTED with a secret permutation. Alongside it they submit
a zk proof (Groth16/PLONK over a shuffle circuit, or a Bayer–Groth shuffle
argument) attesting: "the output list is a valid permutation re-encryption
of the input list" — without revealing the permutation. The contract (or a
verifier contract) checks the proof onchain. After the last shuffler, NOBODY
knows where any card sits, yet everybody KNOWS it is a fair deck. Chained
shuffles mean one honest shuffler suffices for full security — even if every
other party colludes.

**4. Dealing = selective threshold decryption.**
A card is "dealt to seat k" by index (deck position deterministic per hand:
positions 1–2 to seat 1, etc. — standard dealing order, public). To let ONLY
seat k read card `c_j`:
- every OTHER party publishes a partial decryption share
  `d_i = (c_j[0])^sk_i` with a Chaum–Pedersen proof the share is consistent
  with their `pk_i` (so nobody can poison a card),
- seat k combines all shares with their own secret and recovers `m_j`
  locally. To everyone else the card stays an opaque ciphertext.
Community cards (flop/turn/river) are the same except ALL parties publish
shares, so the decryption completes publicly onchain.

**5. Showdown.**
Players who reach showdown publish their own final shares for their hole
cards — the contract completes the decryption, verifies the cards against
the committed deck, and evaluates the hands. Mucked/folded hands are simply
never decrypted: folded cards remain secret forever, exactly like a real
card room.

**6. Liveness — the failure cases.**
- A party that refuses to publish a decryption share when the protocol
  requires it (stalling the hand) is timed out by the action clock and
  **forfeits their stack in play**, identical to a fold plus penalty; the
  hand completes without them (their shares for OTHER players' cards are the
  sensitive part — this is why the dealer service co holds a key share: it
  guarantees there is always a live share provider for hole card deals even
  if a player rage quits mid hand).
- The dealer service refusing to cooperate voids the hand → full refunds and
  its bond is slashable. The dealer can never CHEAT (it holds one share of
  many and all its messages carry proofs) — the only power it has is to
  stall, and stalling costs it money.

**Engineering notes.**
- Per hand cost: one shuffle proof (~52 card circuit, proven client/dealer
  side in seconds on commodity hardware in 2026 tooling) + cheap
  Chaum–Pedersen share proofs per dealt card. Onchain we only VERIFY:
  Groth16 verify ≈ 300k gas per shuffle — pennies on Monad, per hand not
  per action.
- Heads up first is not just product sequencing: with 2 players + dealer the
  DKG and share flows are trivial (3 parties), and table join/leave (which
  forces a key refresh — the table key is per lineup) is rare. 6 max adds
  key refresh churn on every sit/stand, which is the main complexity tax.
- Libraries exist; do not roll the crypto from scratch: Geometry's zk-shuffle
  (Barnett–Smart implementation), kobigurk/poseidon based shuffle circuits,
  or the zkHoldem published circuits as reference. Audit whatever is chosen
  — this layer IS the casino's reputation.
- The Seat NFT, Vault escrow, betting state machine and rake logic are
  IDENTICAL across schemes 1–3 — the dealing scheme is a swappable module
  behind one interface (`IDealer`), which is what makes the bonded dealer →
  zk migration a swap, not a rewrite.

### Wave 8 — Degen Classics (PvP remakes of casino/party games)

Eight well-known games, re-skinned with trench names and rebuilt PvP so the
house only rakes. Each maps to an existing engine or a tight standalone.

| Trench name | Based on | Engine | How it resolves |
|-------------|----------|--------|-----------------|
| **Capper** | Liar's Dice | Standalone duel | Both roll 5 hidden dice (commit-reveal), alternate raising bids on the 10-dice total ("≥ N show face F"), or `callCap` to challenge. Reveal both hands: bid holds → caller loses; it was cap → bidder loses. Winner takes the pot. Stall/no-reveal = forfeit. |
| **Alpha Call** | Number Nuke | DuelEngine | Both secretly call 0–999. Closest to the hidden entropy target wins. Call the SAME number → both nuke, house takes the pot. Equal distance, different calls → push. |
| **Diamond Hands** | Chicken | Standalone duel | Equal stakes; a multiplier climbs every block. First to `paperHand` (tap out) loses the pot to the one who held. Neither folds before the crash block → both held too long, house takes it. |
| **Gas War** | Blind Auction | Standalone lobby | All-pay sealed auction. Everyone escrows a fixed MAX_BID and commits a secret bid. Highest bid wins the pot of all bids (minus rake); unbid portions refunded; everyone pays their bid win or lose. Ties split. |
| **Chamber** | Russian Roulette | LobbyEngine (6) | 6 equal stakes, entropy picks the bullet. That seat loses; the pot (minus rake) splits among the 5 survivors — each walks up ~1 buy-in. |
| **Exit Scam** | The Heist (split/steal) | Standalone lobby | 4 equal stakes, each secretly votes HOLD or DUMP (commit-reveal). All hold → even split. Exactly one dumps → lone rugger takes the bag. Two+ dump → they cancel, house takes it. No-reveal counts as DUMP. |
| **Whale Throne** | King of the Hill | Standalone | Pay the (rising) price to `seize` the throne; your MON joins the pot, each takeover extends the window (anti-snipe). Whoever holds the throne when the window closes takes the whole pot — funded by everyone they dethroned. |
| **Knife Catcher** | Musical Chairs | LobbyEngine (8) | 8 equal stakes. UI animates round-by-round eliminations; the contract draws one fair winner (equal 1/N odds) who takes the whole pot. |

All eight obey the same invariants: 10% rake on every settled pot, house takes
the pool when a game busts to nobody (Alpha Call collision, Diamond Hands
double-hold, Exit Scam multi-dump), pull-payment claims, burn-on-resolve
tickets, block-height timing with permissionless settlement.

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
  client side automatically and auto revealed by the app. Closing the tab
  before revealing forfeits the duel (the contract enforces it) — the UI
  must warn loudly if a reveal is pending.

---

## 6. Nothing Offchain — The Contracts Run Everything

There is NO bot, server or operator the casino depends on. Smart contracts
handle 100% of game state, randomness, settlement, refunds and burns (see
"Self driving rounds" in §3):

- Betting windows are block heights; nothing needs to "close" them.
- Settlement, duel expiry and sweep burns are permissionless functions folded
  into normal player actions (the poke pattern) and incentivized by a small
  caller bounty from rake. The players are the keeper.
- Duel randomness is player vs player commit reveal; pool randomness is
  blockhash plus accumulated bet salt. No one holds a seed.

The only offchain things that exist are pure conveniences with ZERO trust or
liveness role:

- The frontend auto reveals duel secrets stored in the player's own browser.
- The trench bot MAY poke transitions for lower latency and push settle
  events into the Gun ticker/notifications. If it dies, nothing stops.

---

## 7. Security Checklist (non negotiable before real TVL)

- [ ] Pull payments only (claimable balances), never push loops.
- [ ] Reentrancy guards on deposit/claim/refund.
- [ ] Checks effects interactions everywhere; settle is idempotent.
- [ ] No round can be settled twice; no ticket claimed twice (burn on claim).
- [ ] `voidRound()` path tested: a round that misses its entropy blockhash
      window (>256 blocks of zero interactions) = everyone refunded.
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
| Rake | 1000 bps (10%) |
| Match tolerance (unequal stake duels) | 3500 bps (35%) |
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
