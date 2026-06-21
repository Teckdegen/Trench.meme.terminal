// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IGame} from "../interfaces/IGame.sol";
import {IVault} from "../interfaces/IVault.sol";
import {IPositionNFT} from "../interfaces/IPositionNFT.sol";

/// @notice Gas War (Blind Auction). A sealed-bid, ALL-PAY auction — the trap
///         everyone falls for. Each degen escrows a fixed `MAX_BID` and commits
///         a SECRET bid up to that max (commit-reveal, so nobody sees the room).
///         When the bids reveal:
///           - the HIGHEST bid wins the whole pot of everyone's bids (minus rake)
///           - every player is refunded the part of MAX_BID they did NOT bid
///           - everyone PAYS their bid whether they win or lose (all-pay)
///         Bid too low and you lose for nothing; bid too high and you torch MON
///         to win a pot barely bigger than your own bid. Ties split the pot.
contract GasWar is IGame, ReentrancyGuard {
    IVault public immutable vault;
    IPositionNFT public immutable tickets;

    uint16 public constant RAKE_BPS = 600; // 6%
    uint8 public constant CAP = 4;
    uint64 public constant FILL_EXPIRY = 10 minutes;
    uint64 public constant REVEAL_WINDOW = 5 minutes;
    uint128 public immutable maxBid;

    enum Phase {
        FILLING,
        REVEALING,
        SETTLED,
        VOID
    }

    struct Seat {
        address who;
        bytes32 commit; // keccak(bid, salt)
        uint128 bid;
        bool revealed;
        uint256 ticketId;
    }

    struct Round {
        uint64 createdAt;
        uint64 revealDeadline;
        Phase phase;
        Seat[] seats;
    }

    uint256 public nextRound = 1;
    mapping(uint256 => Round) internal _rounds;

    event Created(uint256 indexed id);
    event Joined(uint256 indexed id, address indexed who, uint8 filled);
    event Revealed(uint256 indexed id, address indexed who, uint128 bid);
    event Settled(uint256 indexed id, address indexed winner, uint256 pot);
    event Voided(uint256 indexed id);

    constructor(address vault_, address tickets_, uint128 maxBid_) {
        vault = IVault(vault_);
        tickets = IPositionNFT(tickets_);
        maxBid = maxBid_;
    }

    function gameId() public pure returns (bytes32) {
        return "gaswar";
    }

    function _roundKey(uint256 id) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(gameId(), id));
    }

    // ── Join: escrow the uniform MAX_BID, commit your secret bid ────────
    function create(bytes32 commit) external payable nonReentrant returns (uint256 id) {
        require(msg.value == maxBid, "escrow max bid");
        id = nextRound++;
        Round storage r = _rounds[id];
        r.createdAt = uint64(block.timestamp);
        r.phase = Phase.FILLING;
        emit Created(id);
        _seat(id, msg.sender, commit);
    }

    function join(uint256 id, bytes32 commit) external payable nonReentrant {
        Round storage r = _rounds[id];
        require(r.phase == Phase.FILLING, "not open");
        require(r.seats.length < CAP, "full");
        require(msg.value == maxBid, "escrow max bid");
        _seat(id, msg.sender, commit);
        if (_rounds[id].seats.length == CAP) {
            r.phase = Phase.REVEALING;
            r.revealDeadline = uint64(block.timestamp) + REVEAL_WINDOW;
        }
    }

    function _seat(uint256 id, address who, bytes32 commit) internal {
        Round storage r = _rounds[id];
        uint256 ticketId = tickets.mint(who, gameId(), id, 0, maxBid);
        r.seats.push(Seat({who: who, commit: commit, bid: 0, revealed: false, ticketId: ticketId}));
        vault.deposit{value: maxBid}(_roundKey(id));
        emit Joined(id, who, uint8(r.seats.length));
    }

    // ── Reveal your bid ─────────────────────────────────────────────────
    function reveal(uint256 id, uint128 bid, bytes32 salt) external nonReentrant {
        Round storage r = _rounds[id];
        require(r.phase == Phase.REVEALING, "not revealing");
        require(bid <= maxBid, "over max");
        uint256 idx = _seatOf(r, msg.sender);
        Seat storage s = r.seats[idx];
        require(!s.revealed, "done");
        require(keccak256(abi.encodePacked(bid, salt)) == s.commit, "bad reveal");
        s.bid = bid;
        s.revealed = true;
        emit Revealed(id, msg.sender, bid);
        if (_allRevealed(r)) _settle(id);
    }

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

        // A no-reveal forfeits the full escrow as a max bid (anti-grief) so it
        // can't dodge the all-pay cost.
        uint128 topBid;
        uint256 winnerIdx;
        uint256 bidsSum;
        for (uint256 i; i < n; ++i) {
            Seat storage s = r.seats[i];
            uint128 eff = s.revealed ? s.bid : maxBid;
            bidsSum += eff;
            if (eff > topBid) {
                topBid = eff;
                winnerIdx = i;
            }
        }

        // Count ties at the top (split the pot among them).
        uint256 winners;
        for (uint256 i; i < n; ++i) {
            uint128 eff = r.seats[i].revealed ? r.seats[i].bid : maxBid;
            if (eff == topBid) winners++;
        }

        uint256 pot = bidsSum; // sum of everyone's effective bids
        uint256 rake = (pot * RAKE_BPS) / 10_000;
        uint256 prizeEach = (pot - rake) / winners;

        // Payees: every player gets their unbid refund (maxBid - eff); winners
        // additionally split the prize. One settle call; Vault rakes the pot.
        address[] memory ps = new address[](n);
        uint256[] memory ams = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            Seat storage s = r.seats[i];
            uint128 eff = s.revealed ? s.bid : maxBid;
            uint256 refund = uint256(maxBid) - eff; // unbid portion back
            bool isWinner = eff == topBid;
            ps[i] = s.who;
            ams[i] = refund + (isWinner ? prizeEach : 0);
            tickets.setStatus(s.ticketId, isWinner ? IPositionNFT.Status.WON : IPositionNFT.Status.LOST);
        }
        vault.settle(_roundKey(id), ps, ams, RAKE_BPS);
        r.phase = Phase.SETTLED;
        emit Settled(id, r.seats[winnerIdx].who, pot - rake);
    }

    function _void(uint256 id) internal {
        Round storage r = _rounds[id];
        uint256 n = r.seats.length;
        if (n > 0) {
            address[] memory ps = new address[](n);
            uint256[] memory ams = new uint256[](n);
            for (uint256 i; i < n; ++i) {
                ps[i] = r.seats[i].who;
                ams[i] = maxBid;
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
