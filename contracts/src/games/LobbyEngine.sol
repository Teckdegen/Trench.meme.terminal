// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IGame} from "../interfaces/IGame.sol";
import {IVault} from "../interfaces/IVault.sol";
import {IPositionNFT} from "../interfaces/IPositionNFT.sol";
import {Entropy} from "../lib/Entropy.sol";

/// @notice Generic equal-stake lobby engine for games with no per-player input
///         (Chamber, Knife Catcher). First player `create{value}` sets the
///         buy-in; others `join{value}` matching it until the table fills, then
///         anyone pokes to settle from the post-fill blockhash. Concrete games
///         implement `_resolveLobby` (who wins, how much). Under-filled tables
///         auto-void + refund after a timeout.
abstract contract LobbyEngine is IGame, ReentrancyGuard {
    IVault public immutable vault;
    IPositionNFT public immutable tickets;

    uint16 public constant RAKE_BPS = 1000; // 10%
    uint64 public constant FILL_EXPIRY = 10 minutes;

    enum Phase {
        FILLING,
        SETTLED,
        VOID
    }

    struct Seat {
        address who;
        uint256 ticketId;
    }

    struct Table {
        uint128 buyIn;
        uint8 cap;
        uint64 createdAt;
        uint64 lockBlock; // set when full
        Phase phase;
        Seat[] seats;
    }

    uint256 public nextTable = 1;
    mapping(uint256 => Table) internal _tables;

    event TableCreated(uint256 indexed id, address indexed host, uint128 buyIn, uint8 cap);
    event Joined(uint256 indexed id, address indexed who, uint8 filled);
    event Settled(uint256 indexed id, uint256 paidOut);
    event Voided(uint256 indexed id);

    constructor(address vault_, address tickets_) {
        vault = IVault(vault_);
        tickets = IPositionNFT(tickets_);
    }

    /// @return The number of seats this game's tables hold.
    function capacity() public pure virtual returns (uint8);

    function _roundKey(uint256 id) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(gameId(), id));
    }

    // ── Create / join ───────────────────────────────────────────────────
    function create() external payable nonReentrant returns (uint256 id) {
        require(msg.value > 0, "no stake");
        id = nextTable++;
        Table storage t = _tables[id];
        t.buyIn = uint128(msg.value);
        t.cap = capacity();
        t.createdAt = uint64(block.timestamp);
        t.phase = Phase.FILLING;
        emit TableCreated(id, msg.sender, uint128(msg.value), t.cap);
        _seat(id, msg.sender);
    }

    function join(uint256 id) external payable nonReentrant {
        Table storage t = _tables[id];
        require(t.phase == Phase.FILLING, "not open");
        require(t.seats.length < t.cap, "full");
        require(msg.value == t.buyIn, "wrong buy-in");
        _seat(id, msg.sender);
        if (_tables[id].seats.length == t.cap) {
            t.lockBlock = uint64(block.number);
        }
    }

    function _seat(uint256 id, address who) internal {
        Table storage t = _tables[id];
        uint256 ticketId =
            tickets.mint(who, gameId(), id, uint64(t.seats.length), t.buyIn);
        t.seats.push(Seat({who: who, ticketId: ticketId}));
        vault.deposit{value: t.buyIn}(_roundKey(id));
        emit Joined(id, who, uint8(t.seats.length));
    }

    // ── Settle (permissionless) ─────────────────────────────────────────
    function poke(uint256 hint) external override nonReentrant {
        if (hint != 0) _trySettle(hint);
    }

    function settle(uint256 id) external nonReentrant {
        _trySettle(id);
    }

    function _trySettle(uint256 id) internal {
        Table storage t = _tables[id];
        if (t.phase != Phase.FILLING) return;

        if (t.seats.length < t.cap) {
            if (block.timestamp > t.createdAt + FILL_EXPIRY) _void(id);
            return;
        }
        if (!Entropy.poolDrawable(t.lockBlock)) {
            if (block.number > uint256(t.lockBlock) + 256) _void(id);
            return;
        }

        uint256 e = Entropy.poolEntropy(t.lockBlock, id, bytes32(id));
        (address[] memory winners, uint256[] memory amounts) = _resolveLobby(id, e);
        bytes32 rk = _roundKey(id);

        if (winners.length == 0) {
            vault.houseWin(rk);
            for (uint256 i; i < t.seats.length; ++i) {
                tickets.setStatus(t.seats[i].ticketId, IPositionNFT.Status.LOST);
            }
            emit Settled(id, 0);
        } else {
            vault.settle(rk, winners, amounts, RAKE_BPS);
            // Mark winners WON, everyone else LOST.
            for (uint256 i; i < t.seats.length; ++i) {
                Seat storage s = t.seats[i];
                bool won;
                for (uint256 j; j < winners.length; ++j) {
                    if (winners[j] == s.who) {
                        won = true;
                        break;
                    }
                }
                tickets.setStatus(
                    s.ticketId, won ? IPositionNFT.Status.WON : IPositionNFT.Status.LOST
                );
            }
            uint256 paid;
            for (uint256 j; j < amounts.length; ++j) paid += amounts[j];
            emit Settled(id, paid);
        }
        t.phase = Phase.SETTLED;
    }

    function _void(uint256 id) internal {
        Table storage t = _tables[id];
        uint256 n = t.seats.length;
        if (n > 0) {
            address[] memory ps = new address[](n);
            uint256[] memory ams = new uint256[](n);
            for (uint256 i; i < n; ++i) {
                ps[i] = t.seats[i].who;
                ams[i] = t.buyIn;
                tickets.setStatus(t.seats[i].ticketId, IPositionNFT.Status.REFUNDED);
            }
            vault.refund(_roundKey(id), ps, ams);
        }
        t.phase = Phase.VOID;
        emit Voided(id);
    }

    function claimTicket(uint256 tokenId) external nonReentrant {
        IPositionNFT.Ticket memory tk = tickets.ticket(tokenId);
        require(tk.status == IPositionNFT.Status.WON, "not won");
        tickets.setStatus(tokenId, IPositionNFT.Status.CLAIMED);
        tickets.burn(tokenId);
    }

    /// @dev Game-specific resolution. Read seats via `_tables[id].seats`.
    ///      Return winners + their payouts (stake back + winnings). An empty
    ///      winners array means the house takes the whole pool.
    function _resolveLobby(uint256 id, uint256 entropy)
        internal
        view
        virtual
        returns (address[] memory winners, uint256[] memory amounts);

    function tableInfo(uint256 id)
        external
        view
        returns (uint128 buyIn, uint8 cap, uint8 filled, Phase phase)
    {
        Table storage t = _tables[id];
        return (t.buyIn, t.cap, uint8(t.seats.length), t.phase);
    }
}
