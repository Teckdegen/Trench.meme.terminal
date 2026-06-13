// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IGame} from "../interfaces/IGame.sol";
import {IVault} from "../interfaces/IVault.sol";
import {IPositionNFT} from "../interfaces/IPositionNFT.sol";
import {MonPriceFeed} from "../core/MonPriceFeed.sol";

/// @notice MON Up / Down — the ONE token game. Deliberately rigid:
///           - only asset: MON
///           - only market: the 5-minute round, back to back forever
///           - exactly 5 stake tiers: 5 / 10 / 25 / 50 / 100 MON
///
///         Bets are matched 1:1 by TIER and opposite direction (FIFO). Every
///         winner is funded by exactly one loser at the same stake, so the pot
///         covers the bills by construction with zero house exposure. The house
///         takes its rake on each settled pair. Unmatched bets auto-refund at
///         lock. "The line" is a TWAP snapshot at lock; the close is read the
///         same way 5 minutes later. Fully onchain, verifiable, no operator.
contract UpDown is IGame, ReentrancyGuard {
    IVault public immutable vault;
    IPositionNFT public immutable tickets;
    MonPriceFeed public immutable feed; // bot-pushed MON price

    uint16 public constant RAKE_BPS = 1000; // 10%
    uint64 public constant BET_BLOCKS = 30; // ~60s betting window on 400ms blocks
    uint64 public constant ROUND_BLOCKS = 750; // ~5 min on 400ms blocks

    // The only allowed stakes (wei). Index = tier.
    uint128[5] public TIERS = [
        uint128(5 ether),
        uint128(10 ether),
        uint128(25 ether),
        uint128(50 ether),
        uint128(100 ether)
    ];

    enum Dir {
        UP,
        DOWN
    }

    enum Phase {
        BETTING,
        LOCKED,
        SETTLED
    }

    struct Entry {
        address player;
        uint8 tier;
        Dir dir;
        uint256 ticketId;
        uint256 matchId; // index of opposing entry, or type(uint256).max if open
    }

    struct Round {
        uint64 openBlock;
        uint64 lockBlock;
        uint64 closeBlock;
        uint192 linePrice; // MON price snapshotted at lock (the line)
        uint192 closePrice; // MON price snapshotted at settle
        Phase phase;
        Entry[] entries;
        // FIFO queues of OPEN entry indices, per tier per direction.
        mapping(uint8 => uint256[]) openUp;
        mapping(uint8 => uint256[]) openDown;
    }

    uint256 public currentRound;
    mapping(uint256 => Round) internal _rounds;

    event RoundOpened(uint256 indexed id, uint64 lockBlock, uint64 closeBlock);
    event Bet(uint256 indexed id, address indexed player, uint8 tier, Dir dir, bool matched);
    event Locked(uint256 indexed id, uint192 linePrice);
    event Settled(uint256 indexed id, bool up, uint192 linePrice, uint192 closePrice, uint256 pairs);

    constructor(address vault_, address tickets_, address feed_) {
        vault = IVault(vault_);
        tickets = IPositionNFT(tickets_);
        feed = MonPriceFeed(feed_);
        _open();
    }

    function gameId() public pure returns (bytes32) {
        return "updown";
    }

    function _roundKey(uint256 id) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(gameId(), id));
    }

    function _tierOf(uint256 value) internal view returns (int256) {
        for (uint8 i; i < 5; ++i) {
            if (value == TIERS[i]) return int256(uint256(i));
        }
        return -1;
    }

    function _open() internal {
        uint256 id = ++currentRound;
        Round storage r = _rounds[id];
        r.openBlock = uint64(block.number);
        r.lockBlock = uint64(block.number) + BET_BLOCKS;
        r.closeBlock = r.lockBlock + ROUND_BLOCKS;
        r.phase = Phase.BETTING;
        emit RoundOpened(id, r.lockBlock, r.closeBlock);
    }

    // ── Bet: pick direction + one of the 5 tiers ────────────────────────
    function bet(Dir dir) external payable nonReentrant {
        _advance();
        Round storage r = _rounds[currentRound];
        require(r.phase == Phase.BETTING && block.number < r.lockBlock, "closed");
        int256 ti = _tierOf(msg.value);
        require(ti >= 0, "bad tier");
        uint8 tier = uint8(uint256(ti));

        uint256 myIdx = r.entries.length;
        uint256 ticketId =
            tickets.mint(msg.sender, gameId(), currentRound, uint64(dir), uint128(msg.value));

        // Try to match the oldest opposing OPEN entry at this tier.
        uint256[] storage opp = dir == Dir.UP ? r.openDown[tier] : r.openUp[tier];
        uint256 matchId = type(uint256).max;
        if (opp.length > 0) {
            matchId = opp[opp.length - 1];
            opp.pop();
            r.entries[matchId].matchId = myIdx;
        } else {
            (dir == Dir.UP ? r.openUp[tier] : r.openDown[tier]).push(myIdx);
        }

        r.entries.push(
            Entry({
                player: msg.sender,
                tier: tier,
                dir: dir,
                ticketId: ticketId,
                matchId: matchId
            })
        );

        vault.deposit{value: msg.value}(_roundKey(currentRound));
        emit Bet(currentRound, msg.sender, tier, dir, matchId != type(uint256).max);
    }

    // ── Permissionless driver ───────────────────────────────────────────
    function poke(uint256) external override nonReentrant {
        _advance();
    }

    function _advance() internal {
        uint256 id = currentRound;
        Round storage r = _rounds[id];

        if (r.phase == Phase.BETTING && block.number >= r.lockBlock) {
            // Anchor the line from the bot's fresh price. If the bot is stale,
            // do nothing yet — we wait for a fresh push rather than locking on a
            // bad number. (A persistently stale feed can be voided below.)
            if (!feed.isFresh()) return;
            (uint192 price,) = feed.freshPrice();
            r.linePrice = price;
            r.phase = Phase.LOCKED;
            _refundUnmatched(id);
            emit Locked(id, price);
        }

        if (r.phase == Phase.LOCKED && block.number >= r.closeBlock) {
            if (!feed.isFresh()) return; // wait for a fresh close price
            _settle(id);
            _open();
        }
    }

    function _refundUnmatched(uint256 id) internal {
        Round storage r = _rounds[id];
        // Count + collect open entries across tiers/dirs.
        uint256 n;
        for (uint256 i; i < r.entries.length; ++i) {
            if (r.entries[i].matchId == type(uint256).max) n++;
        }
        if (n == 0) return;
        address[] memory ps = new address[](n);
        uint256[] memory ams = new uint256[](n);
        uint256 j;
        for (uint256 i; i < r.entries.length; ++i) {
            Entry storage e = r.entries[i];
            if (e.matchId == type(uint256).max) {
                ps[j] = e.player;
                ams[j] = TIERS[e.tier];
                tickets.setStatus(e.ticketId, IPositionNFT.Status.REFUNDED);
                j++;
            }
        }
        vault.refund(_roundKey(id), ps, ams);
    }

    function _settle(uint256 id) internal {
        Round storage r = _rounds[id];
        (uint192 closePrice,) = feed.freshPrice();
        r.closePrice = closePrice;
        // The line was snapshotted from the same bot feed at lock. Close vs line
        // decides the round. Both prices are stored on the round, so any
        // settlement is publicly verifiable against the feed's Pushed events.
        bool up = closePrice > r.linePrice;
        bool push = closePrice == r.linePrice;

        // Pay matched pairs. Each pair pot = 2 * tier; winner gets pot - rake.
        // Build winner arrays. Each matched pair contributes one settle row set
        // via a single batched settle over the whole round pool.
        uint256 pairs;
        // First pass: count winners (one per matched pair) or 2 per push pair.
        uint256 rows;
        for (uint256 i; i < r.entries.length; ++i) {
            Entry storage e = r.entries[i];
            if (e.matchId == type(uint256).max) continue;
            if (i > e.matchId) continue; // process each pair once (lower index)
            rows += push ? 2 : 1;
            pairs++;
        }

        address[] memory ws = new address[](rows);
        uint256[] memory ams = new uint256[](rows);
        uint256 k;
        for (uint256 i; i < r.entries.length; ++i) {
            Entry storage e = r.entries[i];
            if (e.matchId == type(uint256).max || i > e.matchId) continue;
            Entry storage opp = r.entries[e.matchId];
            uint256 tierAmt = TIERS[e.tier];
            uint256 pot = tierAmt * 2;
            uint256 rake = (pot * RAKE_BPS) / 10_000;

            if (push) {
                uint256 rem = pot - rake;
                ws[k] = e.player;
                ams[k] = rem / 2;
                k++;
                ws[k] = opp.player;
                ams[k] = rem - (rem / 2);
                k++;
                tickets.setStatus(e.ticketId, IPositionNFT.Status.REFUNDED);
                tickets.setStatus(opp.ticketId, IPositionNFT.Status.REFUNDED);
            } else {
                bool eWins = (e.dir == Dir.UP) == up;
                (Entry storage win, Entry storage lose) = eWins ? (e, opp) : (opp, e);
                ws[k] = win.player;
                ams[k] = pot - rake;
                k++;
                tickets.setStatus(win.ticketId, IPositionNFT.Status.WON);
                tickets.setStatus(lose.ticketId, IPositionNFT.Status.LOST);
            }
        }

        if (rows > 0) vault.settle(_roundKey(id), ws, ams, RAKE_BPS);
        r.phase = Phase.SETTLED;
        emit Settled(id, up, r.linePrice, closePrice, pairs);
    }

    function claimTicket(uint256 tokenId) external nonReentrant {
        IPositionNFT.Ticket memory t = tickets.ticket(tokenId);
        require(t.status == IPositionNFT.Status.WON, "not won");
        tickets.setStatus(tokenId, IPositionNFT.Status.CLAIMED);
        tickets.burn(tokenId);
    }
}
