// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IGame} from "../interfaces/IGame.sol";
import {IVault} from "../interfaces/IVault.sol";
import {IPositionNFT} from "../interfaces/IPositionNFT.sol";
import {Entropy} from "../lib/Entropy.sol";

/// @notice Generic 1v1 duel engine. Concrete games (Moon or Doom, Send It,
///         Alpha Call…) only
///         implement `_resolve` — the matching, escrow, commit-reveal, payout,
///         rake, expiry and ticket lifecycle all live here.
///
///         Stakes need NOT be equal: an open challenge matches any acceptor
///         whose stake is within MATCH_TOLERANCE_BPS. Unequal stakes ARE the
///         odds — the resolver receives both stakes and decides the winner with
///         stake-weighted fairness (see Moon or Doom). Winner takes the pot minus
///         rake; the house always takes its cut on a settled duel.
abstract contract DuelEngine is IGame, ReentrancyGuard {
    IVault public immutable vault;
    IPositionNFT public immutable tickets;

    uint16 public constant RAKE_BPS = 600; // 6% house cut
    uint16 public constant MATCH_TOLERANCE_BPS = 1000; // ±10% stake match band
    uint64 public constant ACCEPT_EXPIRY = 10 minutes;
    uint64 public constant REVEAL_WINDOW = 5 minutes;

    enum Phase {
        NONE,
        OPEN, // posted, awaiting an acceptor
        MATCHED, // both staked, awaiting reveals
        SETTLED,
        EXPIRED
    }

    struct Duel {
        address a;
        address b;
        uint128 stakeA;
        uint128 stakeB;
        uint64 pickA; // game-specific (e.g. heads/tails)
        uint64 pickB;
        bytes32 commitA;
        bytes32 commitB;
        bytes32 secretA;
        bytes32 secretB;
        bool revealedA;
        bool revealedB;
        uint64 createdAt;
        uint64 matchedAt;
        uint256 ticketA;
        uint256 ticketB;
        Phase phase;
    }

    uint256 public nextDuel = 1;
    mapping(uint256 => Duel) public duels;

    event Posted(uint256 indexed id, address indexed a, uint128 stake, uint64 pick);
    event Matched(uint256 indexed id, address indexed b, uint128 stake, uint64 pick);
    event Revealed(uint256 indexed id, address indexed who);
    event Resolved(uint256 indexed id, address indexed winner, uint256 payout);
    event Expired(uint256 indexed id);

    constructor(address vault_, address tickets_) {
        vault = IVault(vault_);
        tickets = IPositionNFT(tickets_);
    }

    function _roundKey(uint256 id) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(gameId(), id));
    }

    // ── Post a challenge ────────────────────────────────────────────────
    function post(uint64 pick, bytes32 commit) external payable nonReentrant returns (uint256 id) {
        require(msg.value > 0, "no stake");
        id = nextDuel++;
        Duel storage d = duels[id];
        d.a = msg.sender;
        d.stakeA = uint128(msg.value);
        d.pickA = pick;
        d.commitA = commit;
        d.createdAt = uint64(block.timestamp);
        d.phase = Phase.OPEN;
        d.ticketA = tickets.mint(msg.sender, gameId(), id, pick, uint128(msg.value));

        vault.deposit{value: msg.value}(_roundKey(id));
        emit Posted(id, msg.sender, uint128(msg.value), pick);
    }

    // ── Accept a challenge ──────────────────────────────────────────────
    function accept(uint256 id, uint64 pick, bytes32 commit) external payable nonReentrant {
        Duel storage d = duels[id];
        require(d.phase == Phase.OPEN, "not open");
        require(msg.sender != d.a, "self");
        require(block.timestamp <= d.createdAt + ACCEPT_EXPIRY, "expired");
        _requireWithinTolerance(d.stakeA, uint128(msg.value));

        d.b = msg.sender;
        d.stakeB = uint128(msg.value);
        d.pickB = pick;
        d.commitB = commit;
        d.matchedAt = uint64(block.timestamp);
        d.phase = Phase.MATCHED;
        d.ticketB = tickets.mint(msg.sender, gameId(), id, pick, uint128(msg.value));

        vault.deposit{value: msg.value}(_roundKey(id));
        emit Matched(id, msg.sender, uint128(msg.value), pick);
    }

    function _requireWithinTolerance(uint128 base, uint128 other) internal pure {
        uint128 hi = uint128((uint256(base) * (10_000 + MATCH_TOLERANCE_BPS)) / 10_000);
        uint128 lo = uint128((uint256(base) * (10_000 - MATCH_TOLERANCE_BPS)) / 10_000);
        require(other >= lo && other <= hi, "stake out of band");
    }

    // ── Reveal ──────────────────────────────────────────────────────────
    function reveal(uint256 id, bytes32 secret) external nonReentrant {
        Duel storage d = duels[id];
        require(d.phase == Phase.MATCHED, "not matched");
        if (msg.sender == d.a) {
            require(!d.revealedA, "done");
            require(Entropy.commit(secret) == d.commitA, "bad secret");
            d.secretA = secret;
            d.revealedA = true;
        } else if (msg.sender == d.b) {
            require(!d.revealedB, "done");
            require(Entropy.commit(secret) == d.commitB, "bad secret");
            d.secretB = secret;
            d.revealedB = true;
        } else {
            revert("not a player");
        }
        emit Revealed(id, msg.sender);
        if (d.revealedA && d.revealedB) _settle(id);
    }

    // ── Settlement ──────────────────────────────────────────────────────
    function _settle(uint256 id) internal {
        Duel storage d = duels[id];
        uint256 e = Entropy.duelEntropy(d.secretA, d.secretB, id);
        // Concrete game decides the winner. Returns:
        //   0 = A wins, 1 = B wins, 2 = push/tie, 3 = both bust → house wins.
        uint8 outcome = _resolve(d, e);

        uint256 pot = uint256(d.stakeA) + d.stakeB;
        bytes32 rk = _roundKey(id);

        if (outcome == 3) {
            // Both bust (e.g. Alpha Call collision) → house takes the pot.
            vault.houseWin(rk);
            tickets.setStatus(d.ticketA, IPositionNFT.Status.LOST);
            tickets.setStatus(d.ticketB, IPositionNFT.Status.LOST);
            emit Resolved(id, address(0), 0);
        } else if (outcome == 2) {
            // Push: house still rakes; remainder returns pro-rata to stakes.
            uint256 rake = (pot * RAKE_BPS) / 10_000;
            uint256 rem = pot - rake;
            uint256 toA = (rem * d.stakeA) / pot;
            uint256 toB = rem - toA;
            address[] memory ws = new address[](2);
            uint256[] memory ams = new uint256[](2);
            ws[0] = d.a;
            ws[1] = d.b;
            ams[0] = toA;
            ams[1] = toB;
            vault.settle(rk, ws, ams, RAKE_BPS);
            tickets.setStatus(d.ticketA, IPositionNFT.Status.REFUNDED);
            tickets.setStatus(d.ticketB, IPositionNFT.Status.REFUNDED);
            emit Resolved(id, address(0), rem);
        } else {
            address winner = outcome == 0 ? d.a : d.b;
            uint256 rake = (pot * RAKE_BPS) / 10_000;
            uint256 payout = pot - rake;
            address[] memory ws = new address[](1);
            uint256[] memory ams = new uint256[](1);
            ws[0] = winner;
            ams[0] = payout;
            vault.settle(rk, ws, ams, RAKE_BPS);
            (uint256 wTicket, uint256 lTicket) =
                outcome == 0 ? (d.ticketA, d.ticketB) : (d.ticketB, d.ticketA);
            tickets.setStatus(wTicket, IPositionNFT.Status.WON);
            tickets.setStatus(lTicket, IPositionNFT.Status.LOST);
            emit Resolved(id, winner, payout);
        }
        d.phase = Phase.SETTLED;
    }

    /// @dev Concrete games implement the win rule. e = duel entropy.
    ///      Return 0 (A wins), 1 (B wins), 2 (push), or 3 (both bust → house).
    function _resolve(Duel storage d, uint256 e) internal virtual returns (uint8);

    // ── Claim a win (burn-on-claim) ─────────────────────────────────────
    function claimTicket(uint256 tokenId) external nonReentrant {
        IPositionNFT.Ticket memory t = tickets.ticket(tokenId);
        require(t.status == IPositionNFT.Status.WON, "not won");
        // Payout was already credited in _settle; here we just retire the NFT
        // and the holder pulls from the Vault separately. Mark CLAIMED + burn.
        tickets.setStatus(tokenId, IPositionNFT.Status.CLAIMED);
        tickets.burn(tokenId);
    }

    // ── Permissionless poke: expire stale challenges, sweep dead tickets ─
    function poke(uint256 hint) external override nonReentrant {
        if (hint != 0) _maybeExpire(hint);
    }

    function expire(uint256 id) external nonReentrant {
        _maybeExpire(id);
    }

    function _maybeExpire(uint256 id) internal {
        Duel storage d = duels[id];
        if (d.phase == Phase.OPEN && block.timestamp > d.createdAt + ACCEPT_EXPIRY) {
            // Nobody accepted → refund the poster, no rake.
            address[] memory ps = new address[](1);
            uint256[] memory ams = new uint256[](1);
            ps[0] = d.a;
            ams[0] = d.stakeA;
            vault.refund(_roundKey(id), ps, ams);
            tickets.setStatus(d.ticketA, IPositionNFT.Status.REFUNDED);
            d.phase = Phase.EXPIRED;
            emit Expired(id);
        } else if (d.phase == Phase.MATCHED && block.timestamp > d.matchedAt + REVEAL_WINDOW) {
            // A no-reveal forfeits. If exactly one side revealed, they win the
            // pot minus rake. If neither revealed, push (rake taken).
            _forfeit(id);
        }
    }

    function _forfeit(uint256 id) internal {
        Duel storage d = duels[id];
        uint256 pot = uint256(d.stakeA) + d.stakeB;
        bytes32 rk = _roundKey(id);
        uint256 rake = (pot * RAKE_BPS) / 10_000;

        if (d.revealedA && !d.revealedB) {
            address[] memory ws = new address[](1);
            uint256[] memory ams = new uint256[](1);
            ws[0] = d.a;
            ams[0] = pot - rake;
            vault.settle(rk, ws, ams, RAKE_BPS);
            tickets.setStatus(d.ticketA, IPositionNFT.Status.WON);
            tickets.setStatus(d.ticketB, IPositionNFT.Status.LOST);
            emit Resolved(id, d.a, pot - rake);
        } else if (d.revealedB && !d.revealedA) {
            address[] memory ws = new address[](1);
            uint256[] memory ams = new uint256[](1);
            ws[0] = d.b;
            ams[0] = pot - rake;
            vault.settle(rk, ws, ams, RAKE_BPS);
            tickets.setStatus(d.ticketB, IPositionNFT.Status.WON);
            tickets.setStatus(d.ticketA, IPositionNFT.Status.LOST);
            emit Resolved(id, d.b, pot - rake);
        } else {
            // Neither revealed: push, rake taken, remainder pro-rata.
            uint256 rem = pot - rake;
            uint256 toA = (rem * d.stakeA) / pot;
            address[] memory ws = new address[](2);
            uint256[] memory ams = new uint256[](2);
            ws[0] = d.a;
            ws[1] = d.b;
            ams[0] = toA;
            ams[1] = rem - toA;
            vault.settle(rk, ws, ams, RAKE_BPS);
            tickets.setStatus(d.ticketA, IPositionNFT.Status.REFUNDED);
            tickets.setStatus(d.ticketB, IPositionNFT.Status.REFUNDED);
            emit Resolved(id, address(0), rem);
        }
        d.phase = Phase.SETTLED;
    }
}
