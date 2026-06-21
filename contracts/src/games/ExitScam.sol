// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IGame} from "../interfaces/IGame.sol";
import {IVault} from "../interfaces/IVault.sol";
import {IPositionNFT} from "../interfaces/IPositionNFT.sol";

/// @notice Exit Scam (The Heist / split-or-steal). N degens put equal stakes in
///         the bag, then each SECRETLY votes HOLD or DUMP (commit-reveal):
///           - everyone HOLDS        → the bag splits evenly, everyone profits
///                                     nothing but keeps their stake (minus rake)
///           - exactly ONE DUMPS     → the rugger takes the whole bag (minus rake)
///           - TWO OR MORE DUMP      → they cancel out, the house takes it all
///         Trust nobody. Commit-reveal hides votes until everyone is locked.
///         A no-reveal counts as DUMP (you don't get to grief by going silent).
contract ExitScam is IGame, ReentrancyGuard {
    IVault public immutable vault;
    IPositionNFT public immutable tickets;

    uint16 public constant RAKE_BPS = 600; // 6%
    uint8 public constant CAP = 4;
    uint64 public constant FILL_EXPIRY = 10 minutes;
    uint64 public constant REVEAL_WINDOW = 5 minutes;

    enum Vote {
        HOLD,
        DUMP
    }

    enum Phase {
        FILLING,
        REVEALING,
        SETTLED,
        VOID
    }

    struct Seat {
        address who;
        bytes32 commit; // keccak(vote, salt)
        Vote vote;
        bool revealed;
        uint256 ticketId;
    }

    struct Round {
        uint128 buyIn;
        uint64 createdAt;
        uint64 revealDeadline;
        Phase phase;
        Seat[] seats;
    }

    uint256 public nextRound = 1;
    mapping(uint256 => Round) internal _rounds;

    event Created(uint256 indexed id, uint128 buyIn);
    event Joined(uint256 indexed id, address indexed who, uint8 filled);
    event Revealed(uint256 indexed id, address indexed who, Vote vote);
    event Settled(uint256 indexed id, uint8 dumpers, uint256 paidOut);
    event Voided(uint256 indexed id);

    constructor(address vault_, address tickets_) {
        vault = IVault(vault_);
        tickets = IPositionNFT(tickets_);
    }

    function gameId() public pure returns (bytes32) {
        return "exitscam";
    }

    function _roundKey(uint256 id) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(gameId(), id));
    }

    // ── Create / join (commit your vote at join time) ───────────────────
    function create(bytes32 commit) external payable nonReentrant returns (uint256 id) {
        require(msg.value > 0, "no stake");
        id = nextRound++;
        Round storage r = _rounds[id];
        r.buyIn = uint128(msg.value);
        r.createdAt = uint64(block.timestamp);
        r.phase = Phase.FILLING;
        emit Created(id, uint128(msg.value));
        _seat(id, msg.sender, commit);
    }

    function join(uint256 id, bytes32 commit) external payable nonReentrant {
        Round storage r = _rounds[id];
        require(r.phase == Phase.FILLING, "not open");
        require(r.seats.length < CAP, "full");
        require(msg.value == r.buyIn, "wrong buy-in");
        _seat(id, msg.sender, commit);
        if (_rounds[id].seats.length == CAP) {
            r.phase = Phase.REVEALING;
            r.revealDeadline = uint64(block.timestamp) + REVEAL_WINDOW;
        }
    }

    function _seat(uint256 id, address who, bytes32 commit) internal {
        Round storage r = _rounds[id];
        uint256 ticketId = tickets.mint(who, gameId(), id, 0, r.buyIn);
        r.seats.push(Seat({who: who, commit: commit, vote: Vote.HOLD, revealed: false, ticketId: ticketId}));
        vault.deposit{value: r.buyIn}(_roundKey(id));
        emit Joined(id, who, uint8(r.seats.length));
    }

    // ── Reveal ──────────────────────────────────────────────────────────
    function reveal(uint256 id, Vote vote, bytes32 salt) external nonReentrant {
        Round storage r = _rounds[id];
        require(r.phase == Phase.REVEALING, "not revealing");
        uint256 idx = _seatOf(r, msg.sender);
        Seat storage s = r.seats[idx];
        require(!s.revealed, "done");
        require(keccak256(abi.encodePacked(uint8(vote), salt)) == s.commit, "bad reveal");
        s.vote = vote;
        s.revealed = true;
        emit Revealed(id, msg.sender, vote);
        if (_allRevealed(r)) _settle(id);
    }

    // ── Settle ──────────────────────────────────────────────────────────
    function poke(uint256 hint) external override nonReentrant {
        if (hint != 0) _maybe(hint);
    }

    function settle(uint256 id) external nonReentrant {
        _maybe(id);
    }

    function _maybe(uint256 id) internal {
        Round storage r = _rounds[id];
        if (r.phase == Phase.FILLING) {
            if (block.timestamp > r.createdAt + FILL_EXPIRY) _void(id);
        } else if (r.phase == Phase.REVEALING) {
            if (_allRevealed(r) || block.timestamp > r.revealDeadline) _settle(id);
        }
    }

    function _settle(uint256 id) internal {
        Round storage r = _rounds[id];
        uint256 n = r.seats.length;
        uint256 pool = uint256(r.buyIn) * n;
        uint256 rake = (pool * RAKE_BPS) / 10_000;
        uint256 dist = pool - rake;
        bytes32 rk = _roundKey(id);

        // No-reveal counts as DUMP — silence can't be a safe grief.
        uint256 dumpers;
        uint256 lastDumper;
        for (uint256 i; i < n; ++i) {
            Seat storage s = r.seats[i];
            bool dumped = !s.revealed || s.vote == Vote.DUMP;
            if (dumped) {
                dumpers++;
                lastDumper = i;
            }
        }

        if (dumpers >= 2) {
            // They cancel out → house takes the bag.
            vault.houseWin(rk);
            for (uint256 i; i < n; ++i) {
                tickets.setStatus(r.seats[i].ticketId, IPositionNFT.Status.LOST);
            }
            emit Settled(id, uint8(dumpers), 0);
        } else if (dumpers == 1) {
            // Lone rugger takes it all.
            address[] memory ws = new address[](1);
            uint256[] memory ams = new uint256[](1);
            ws[0] = r.seats[lastDumper].who;
            ams[0] = dist;
            vault.settle(rk, ws, ams, RAKE_BPS);
            for (uint256 i; i < n; ++i) {
                tickets.setStatus(
                    r.seats[i].ticketId,
                    i == lastDumper ? IPositionNFT.Status.WON : IPositionNFT.Status.LOST
                );
            }
            emit Settled(id, 1, dist);
        } else {
            // Everyone held → even split.
            address[] memory ws = new address[](n);
            uint256[] memory ams = new uint256[](n);
            uint256 each = dist / n;
            for (uint256 i; i < n; ++i) {
                ws[i] = r.seats[i].who;
                ams[i] = each;
                tickets.setStatus(r.seats[i].ticketId, IPositionNFT.Status.WON);
            }
            vault.settle(rk, ws, ams, RAKE_BPS);
            emit Settled(id, 0, each * n);
        }
        r.phase = Phase.SETTLED;
    }

    function _void(uint256 id) internal {
        Round storage r = _rounds[id];
        uint256 n = r.seats.length;
        if (n > 0) {
            address[] memory ps = new address[](n);
            uint256[] memory ams = new uint256[](n);
            for (uint256 i; i < n; ++i) {
                ps[i] = r.seats[i].who;
                ams[i] = r.buyIn;
                tickets.setStatus(r.seats[i].ticketId, IPositionNFT.Status.REFUNDED);
            }
            vault.refund(_roundKey(id), ps, ams);
        }
        r.phase = Phase.VOID;
        emit Voided(id);
    }

    function claimTicket(uint256 tokenId) external nonReentrant {
        IPositionNFT.Ticket memory tk = tickets.ticket(tokenId);
        require(tk.status == IPositionNFT.Status.WON, "not won");
        tickets.setStatus(tokenId, IPositionNFT.Status.CLAIMED);
        tickets.burn(tokenId);
    }

    function _seatOf(Round storage r, address who) internal view returns (uint256) {
        for (uint256 i; i < r.seats.length; ++i) {
            if (r.seats[i].who == who) return i;
        }
        revert("not seated");
    }

    function _allRevealed(Round storage r) internal view returns (bool) {
        for (uint256 i; i < r.seats.length; ++i) {
            if (!r.seats[i].revealed) return false;
        }
        return true;
    }
}
