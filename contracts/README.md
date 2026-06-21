# trench.meme casino — contracts

The fully onchain, PvP, pari-mutuel casino described in
[`../casino.md`](../casino.md). No house bankroll, no operator, no server in the
trust path — smart contracts run everything. The house only ever takes its
**6% rake** and the pool when nobody wins.

## Layout

```
src/
├── interfaces/
│   ├── IGame.sol            game identity + permissionless poke
│   ├── IVault.sol           escrow + pull-payment accounting
│   ├── IPositionNFT.sol     bet tickets (Uniswap-position style)
│   ├── IDealer.sol          swappable poker dealer (bonded -> zk)
│   └── IShuffleVerifier.sol Groth16 shuffle + Chaum–Pedersen share verifiers
├── core/
│   ├── GameRegistry.sol     governance list of authorized game modules
│   ├── CasinoVault.sol      the money hub; conservation + rake enforced here
│   └── PositionNFT.sol      ERC-721 tickets, onchain SVG, burn-on-resolve
├── lib/
│   └── Entropy.sol          duel commit-reveal + pool blockhash randomness
├── games/
│   ├── DuelEngine.sol       generic 1v1 (unequal stakes, ±10% match band)
│   ├── MoonOrDoom.sol       50/50 flip (stake-weighted fair)
│   ├── SendIt.sol           high-roll dice duel (stake-weighted)
│   ├── PoolEngine.sol       generic pari-mutuel rounds
│   ├── DegenWheel.sol       roulette — shared-spin pool game
│   ├── PumpOrDump.sol       MON up/down thin escrow; bot resolves offchain
│   ├── LobbyEngine.sol      generic equal-stake lobby (fill → blockhash draw)
│   ├── AlphaCall.sol        Number Nuke — closest hidden call, collision=house
│   ├── Capper.sol           Liar's Dice — hidden dice + bluff bidding
│   ├── DiamondHands.sol     Chicken — first to paper-hand loses the pot
│   ├── GasWar.sol           Blind Auction — all-pay sealed bid
│   ├── Chamber.sol          Russian Roulette — one loser funds the survivors
│   ├── ExitScam.sol         Split/Steal — hold or dump the bag
│   ├── WhaleThrone.sol      King of the Hill — last on the throne wins
│   └── KnifeCatcher.sol     Musical Chairs — last degen takes the pot
└── poker/
    ├── PokerTable.sol       seats, blinds, betting, side pots, rake (heads-up)
    ├── HandEval.sol         7-card hand evaluator
    ├── BondedDealer.sol     v1: commit-reveal deck + slashable bond
    └── ZkDealer.sol         prod: zk shuffle + threshold decryption
circuits/
└── shuffle/                 the zk shuffle circuit (circom) + build pipeline
```

## Design invariants (enforced in code)

- **House always rakes** on any settled round (wins, ties/pushes). Only pure
  refunds (unmatched/voided) skip rake — there is no pot to rake there.
- **Nobody-wins → house takes the whole pool** (`CasinoVault.houseWin`).
- **Everybody-wins is impossible**: a pool round only fires with ≥2 distinct
  outcomes; one-sided rounds void and refund.
- **Conservation**: `CasinoVault.settle` reverts unless
  `sum(payouts) + rake <= pool`; rounding dust sticks to the house.
- **Pull payments only**: settlement credits `claimable`; users `claim()`. One
  reverting recipient can never block a round.
- **Tickets always burn after use**: won → burned on claim; lost → permissionless
  `sweepBurn`/owner burn; refunded → burned on refund. Transferable only while
  OPEN (the live secondary market).
- **No operator / no keeper**: rounds advance on block height; transitions are
  permissionless and folded into normal player actions (the poke pattern).

## Randomness

- **Duels**: player-vs-player commit-reveal. `H(secretA, secretB, id)`. A
  no-reveal forfeits, so stalling is strictly losing. Trustless, no operator.
- **Pools**: `H(blockhash(lockBlock+1), id, betSalt)`. Entropy block is after
  betting closes; the per-bet salt blunts block-producer influence. If the
  entropy block expires unused (>256 blocks idle), the round voids + refunds.
- Swappable to Chainlink VRF / Pyth Entropy via the beacon interface if/when
  available on Monad — no game changes.

## Poker

`PokerTable` is dealer-agnostic: the seat/blind/betting/side-pot/rake state
machine never changes; only the card-secrecy backend (`IDealer`) swaps.

- **BondedDealer** (ship first): commit deck hash → reveal at end, slashable
  bond > max buy-in. Catches rigging after the fact; ships heads-up tables now.
- **ZkDealer** (production): DKG table key → zk-proven shuffle → threshold
  decryption per card. No party ever learns a card early — rigging is
  mathematically impossible, not a promise. Verifiers are generated from the
  circom circuits in `circuits/`.

Heads-up (2 seats) is the reference and ships first because the dealer crypto is
trivial at 2 parties; the same engine generalizes to 6-max by raising `SEATS`.

## Toolchain: Hardhat

```bash
cd contracts
npm install
npm run build         # hardhat compile
npm test              # hardhat test (test/*.test.ts)
```

## Deploy (launch wave)

```bash
export MONAD_RPC_URL=... PRIVATE_KEY=0x... FEE_WALLET=0x... PRICE_BOT=0x...
npm run deploy:monad  # hardhat run scripts/deploy.ts --network monad
```

Poker needs a dealer + (for zk) the generated verifiers — deploy those once the
dealer/circuits are ready.

## Pump or Dump (MON up/down): offchain game, onchain money

Pump or Dump is FULLY OFFCHAIN except the money. `PumpOrDump.sol` is a thin escrow over
the Vault — it only takes bets and pays out. All the work (matching every UP
bet to an equal-tier DOWN bet, drawing the line from the live MON price, and
the win math) runs in the trench bot offchain, so a single round can hold a
MILLION players with zero onchain matching loops.

Flow: players `bet(dir)` at one of the 5 tiers → escrowed. After 5 minutes the
bot reads the MON price, computes the full winner/loser pairing + payouts
offchain, and calls `resolve(id, winners, amounts, winTickets, loseTickets,
monPrice)`. The Vault caps total payout at the escrowed pool and skims the 6%
rake, so **the bot can never over-pay even if it computes wrong**, and the
`monPrice` is recorded in the `Resolved` event for audit. If the bot ever goes
down, anyone can `reclaim(id)` after 1 hour to refund every player their stake.

Trust model: the bot is trusted only to compute the pairing/price correctly
(same as any price bot). It cannot touch funds outside a round, cannot over-pay,
and cannot rug — the reclaim path guarantees players get their money back if it
disappears.

## Status & honesty

This is a complete, coherent reference architecture. Before real-money size:

- The EC re-encryption gadget + Poseidon deck commitments in `shuffle.circom`
  are specced as TODOs — import audited BabyJubJub libs, do a real phase-2
  ceremony, generate the verifier.
- `DegenWheel` (roulette) settles straight-number bets by exact pick match; outside-bet
  payout (red/black/odd/even) is a documented thin extension of `PoolEngine._settle`.
- `PokerTable._award` rake wiring has a deploy-time choice (per-hand bucket vs
  table bucket) flagged inline.
- **Audit everything before lifting launch bet caps.** These contracts hold
  every player's bags — treat them like a DEX.
```
