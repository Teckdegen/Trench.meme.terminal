// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IGame} from "../interfaces/IGame.sol";
import {IVault} from "../interfaces/IVault.sol";
import {IPositionNFT} from "../interfaces/IPositionNFT.sol";
import {Entropy} from "../lib/Entropy.sol";

/// @notice Generic pari-mutuel pool engine. Rounds run on block-height windows,
///         entropy is drawn from the post-lock blockhash + accumulated bet salt
///         (no operator). Winners split the LOSERS' stakes, weighted by the
///         odds of what they hit; the house always rakes, and when NOBODY backs
///         the winning outcome the whole pool goes to the house.
///
///         Concrete games implement `_outcome` (draw the winning result) and
///         `_weight` (how much weight a pick carries — encodes the odds).
abstract contract PoolEngine is IGame, ReentrancyGuard {
    IVault public immutable vault;
    IPositionNFT public immutable tickets;

    uint16 public constant RAKE_BPS = 1000; // 10%

    enum Phase {
        BETTING,
        SETTLED,
        VOID
    }

    struct Bet {
        address player;
        uint128 stake;
        uint64 pick;
        uint256 ticketId;
    }

    struct Round {
        uint64 openBlock;
        uint64 lockBlock; // betting closes at this height
        bytes32 betSalt;
        uint256 totalPool;
        uint8 distinctOutcomes; // # of different picks seen (needs >=2 to fire)
        Phase phase;
        Bet[] bets;
    }

    uint256 public currentRound;
    mapping(uint256 => Round) internal _rounds;
    mapping(uint256 => mapping(uint64 => bool)) internal _seenPick;
    mapping(uint256 => mapping(uint64 => uint256)) internal _stakeOnPick;

    uint64 public immutable bettingBlocks; // window length in blocks

    event RoundOpened(uint256 indexed id, uint64 lockBlock);
    event BetPlaced(uint256 indexed id, address indexed player, uint64 pick, uint128 stake);
    event RoundSettled(uint256 indexed id, uint64 result, uint256 paidOut, uint256 toHouse);
    event RoundVoided(uint256 indexed id);

    constructor(address vault_, address tickets_, uint64 bettingBlocks_) {
        vault = IVault(vault_);
        tickets = IPositionNFT(tickets_);
        bettingBlocks = bettingBlocks_;
        _open();
    }

    function _roundKey(uint256 id) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(gameId(), id));
    }

    function _open() internal {
        uint256 id = ++currentRound;
        Round storage r = _rounds[id];
        r.openBlock = uint64(block.number);
        r.lockBlock = uint64(block.number) + bettingBlocks;
        r.phase = Phase.BETTING;
        emit RoundOpened(id, r.lockBlock);
    }

    // ── Bet ─────────────────────────────────────────────────────────────
    function bet(uint64 pick) external payable nonReentrant {
        _settleDueThenMaybeOpen();
        Round storage r = _rounds[currentRound];
        require(r.phase == Phase.BETTING, "closed");
        require(block.number < r.lockBlock, "locked");
        require(msg.value > 0, "no stake");
        require(_validPick(pick), "bad pick");

        if (!_seenPick[currentRound][pick]) {
            _seenPick[currentRound][pick] = true;
            r.distinctOutcomes += 1;
        }
        _stakeOnPick[currentRound][pick] += msg.value;
        r.totalPool += msg.value;
        r.betSalt = Entropy.addBet(r.betSalt, msg.sender, msg.value, pick);

        uint256 ticketId = tickets.mint(msg.sender, gameId(), currentRound, pick, uint128(msg.value));
        r.bets.push(
            Bet({player: msg.sender, stake: uint128(msg.value), pick: pick, ticketId: ticketId})
        );

        vault.deposit{value: msg.value}(_roundKey(currentRound));
        emit BetPlaced(currentRound, msg.sender, pick, uint128(msg.value));
    }

    // ── Poke: the player-driven keeper ──────────────────────────────────
    function poke(uint256) external override nonReentrant {
        _settleDueThenMaybeOpen();
    }

    function _settleDueThenMaybeOpen() internal {
        uint256 id = currentRound;
        Round storage r = _rounds[id];
        if (r.phase != Phase.BETTING) return;
        if (block.number < r.lockBlock) return;

        // Window closed. Need >=2 distinct outcomes AND a drawable entropy
        // block, else void+refund.
        if (r.distinctOutcomes < 2) {
            _void(id);
        } else if (!Entropy.poolDrawable(r.lockBlock)) {
            // Too early (need lockBlock+1 mined) → wait; or expired → void.
            if (block.number > uint256(r.lockBlock) + 256) _void(id);
            else return; // come back once lockBlock+1 exists
        } else {
            _settle(id);
        }
        _open();
    }

    function _settle(uint256 id) internal {
        Round storage r = _rounds[id];
        uint256 e = Entropy.poolEntropy(r.lockBlock, id, r.betSalt);
        uint64 result = _outcome(e);

        uint256 winStake = _stakeOnPick[id][result]; // total staked on winner
        bytes32 rk = _roundKey(id);

        if (winStake == 0) {
            // Nobody backed the winning outcome → house takes the whole pool.
            vault.houseWin(rk);
            _markAllLost(r);
            emit RoundSettled(id, result, 0, r.totalPool);
            r.phase = Phase.SETTLED;
            return;
        }

        // Pari-mutuel: winners get their stake back + a weighted share of the
        // losing pool, minus rake on the whole pot.
        uint256 pot = r.totalPool;
        uint256 rake = (pot * RAKE_BPS) / 10_000;
        uint256 losingPool = pot - winStake; // everything not on the winner
        uint256 distributable = losingPool > rake ? losingPool - rake : 0;

        // Weighted denominator over winning bets.
        uint256 totalWeight;
        for (uint256 i; i < r.bets.length; ++i) {
            if (r.bets[i].pick == result) {
                totalWeight += _weight(r.bets[i].pick, r.bets[i].stake);
            }
        }

        uint256 nWin;
        for (uint256 i; i < r.bets.length; ++i) {
            if (r.bets[i].pick == result) nWin++;
        }
        address[] memory ws = new address[](nWin);
        uint256[] memory ams = new uint256[](nWin);
        uint256 j;
        uint256 paid;
        for (uint256 i; i < r.bets.length; ++i) {
            Bet storage b = r.bets[i];
            if (b.pick == result) {
                uint256 share = totalWeight == 0
                    ? 0
                    : (distributable * _weight(b.pick, b.stake)) / totalWeight;
                ws[j] = b.player;
                ams[j] = uint256(b.stake) + share; // stake back + winnings
                paid += ams[j];
                tickets.setStatus(b.ticketId, IPositionNFT.Status.WON);
                j++;
            } else {
                tickets.setStatus(b.ticketId, IPositionNFT.Status.LOST);
            }
        }

        vault.settle(rk, ws, ams, RAKE_BPS);
        emit RoundSettled(id, result, paid, pot - paid);
        r.phase = Phase.SETTLED;
    }

    function _void(uint256 id) internal {
        Round storage r = _rounds[id];
        if (r.bets.length > 0) {
            address[] memory ps = new address[](r.bets.length);
            uint256[] memory ams = new uint256[](r.bets.length);
            for (uint256 i; i < r.bets.length; ++i) {
                ps[i] = r.bets[i].player;
                ams[i] = r.bets[i].stake;
                tickets.setStatus(r.bets[i].ticketId, IPositionNFT.Status.REFUNDED);
            }
            vault.refund(_roundKey(id), ps, ams);
        }
        r.phase = Phase.VOID;
        emit RoundVoided(id);
    }

    function _markAllLost(Round storage r) internal {
        for (uint256 i; i < r.bets.length; ++i) {
            tickets.setStatus(r.bets[i].ticketId, IPositionNFT.Status.LOST);
        }
    }

    function claimTicket(uint256 tokenId) external nonReentrant {
        IPositionNFT.Ticket memory t = tickets.ticket(tokenId);
        require(t.status == IPositionNFT.Status.WON, "not won");
        tickets.setStatus(tokenId, IPositionNFT.Status.CLAIMED);
        tickets.burn(tokenId);
    }

    // ── Game-specific hooks ─────────────────────────────────────────────
    function _validPick(uint64 pick) internal view virtual returns (bool);
    function _outcome(uint256 entropy) internal view virtual returns (uint64);
    function _weight(uint64 pick, uint128 stake) internal view virtual returns (uint256);

    function roundInfo(uint256 id)
        external
        view
        returns (uint64 lockBlock, uint256 pool, uint8 outcomes, Phase phase)
    {
        Round storage r = _rounds[id];
        return (r.lockBlock, r.totalPool, r.distinctOutcomes, r.phase);
    }
}
