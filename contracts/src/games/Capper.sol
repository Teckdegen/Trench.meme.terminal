// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IGame} from "../interfaces/IGame.sol";
import {IVault} from "../interfaces/IVault.sol";
import {IPositionNFT} from "../interfaces/IPositionNFT.sol";

/// @notice Capper (Liar's Dice). Two degens each roll 5 HIDDEN dice
///         (commit-reveal). They alternate BIDS on the total across both hands
///         ("at least N dice show face F", 10 dice total), each bid raising the
///         last. Instead of bidding you can "callCap" — challenge the last bid
///         as a lie. Both hands reveal: if the board actually holds the bid,
///         the caller loses; if it was cap, the bidder loses. Loser's bag goes
///         to the winner (minus rake). Pure read-your-opponent bluff. Stall on
///         your turn or dodge the reveal and you forfeit.
contract Capper is IGame, ReentrancyGuard {
    IVault public immutable vault;
    IPositionNFT public immutable tickets;

    uint16 public constant RAKE_BPS = 1000; // 10%
    uint64 public constant ACCEPT_EXPIRY = 10 minutes;
    uint64 public constant ACTION_CLOCK = 3 minutes;
    uint64 public constant REVEAL_WINDOW = 5 minutes;
    uint8 public constant DICE = 5; // per player

    enum Phase {
        OPEN,
        BIDDING,
        REVEAL,
        SETTLED,
        EXPIRED
    }

    struct Bid {
        uint8 quantity;
        uint8 face;
        bool exists;
    }

    struct Game {
        address a;
        address b;
        uint128 stake;
        bytes32 commitA;
        bytes32 commitB;
        uint8[5] diceA;
        uint8[5] diceB;
        bool revealedA;
        bool revealedB;
        Bid last;
        address turn; // whose turn to bid or call
        address challenger; // who called cap (REVEAL phase)
        uint64 createdAt;
        uint64 deadline;
        uint256 ticketA;
        uint256 ticketB;
        Phase phase;
    }

    uint256 public nextGame = 1;
    mapping(uint256 => Game) public games;

    event Posted(uint256 indexed id, address indexed a, uint128 stake);
    event Matched(uint256 indexed id, address indexed b);
    event BidMade(uint256 indexed id, address indexed who, uint8 quantity, uint8 face);
    event Called(uint256 indexed id, address indexed challenger);
    event Resolved(uint256 indexed id, address indexed winner, uint8 actualCount);

    constructor(address vault_, address tickets_) {
        vault = IVault(vault_);
        tickets = IPositionNFT(tickets_);
    }

    function gameId() public pure returns (bytes32) {
        return "capper";
    }

    function _roundKey(uint256 id) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(gameId(), id));
    }

    // ── Post / accept (commit your hidden dice) ─────────────────────────
    function post(bytes32 diceCommit) external payable nonReentrant returns (uint256 id) {
        require(msg.value > 0, "no stake");
        id = nextGame++;
        Game storage g = games[id];
        g.a = msg.sender;
        g.stake = uint128(msg.value);
        g.commitA = diceCommit;
        g.createdAt = uint64(block.timestamp);
        g.phase = Phase.OPEN;
        g.ticketA = tickets.mint(msg.sender, gameId(), id, 0, uint128(msg.value));
        vault.deposit{value: msg.value}(_roundKey(id));
        emit Posted(id, msg.sender, uint128(msg.value));
    }

    function accept(uint256 id, bytes32 diceCommit) external payable nonReentrant {
        Game storage g = games[id];
        require(g.phase == Phase.OPEN, "not open");
        require(msg.sender != g.a, "self");
        require(msg.value == g.stake, "match the stake");
        g.b = msg.sender;
        g.commitB = diceCommit;
        g.turn = g.a; // poster bids first
        g.deadline = uint64(block.timestamp) + ACTION_CLOCK;
        g.phase = Phase.BIDDING;
        g.ticketB = tickets.mint(msg.sender, gameId(), id, 1, uint128(msg.value));
        vault.deposit{value: msg.value}(_roundKey(id));
        emit Matched(id, msg.sender);
    }

    // ── Bidding ─────────────────────────────────────────────────────────
    function bid(uint256 id, uint8 quantity, uint8 face) external nonReentrant {
        Game storage g = games[id];
        require(g.phase == Phase.BIDDING, "not bidding");
        require(msg.sender == g.turn, "not your turn");
        require(face >= 1 && face <= 6, "bad face");
        require(quantity >= 1 && quantity <= 2 * DICE, "bad quantity");
        if (g.last.exists) {
            // Must strictly raise: more dice, or same count of a higher face.
            require(
                quantity > g.last.quantity
                    || (quantity == g.last.quantity && face > g.last.face),
                "must raise"
            );
        }
        g.last = Bid({quantity: quantity, face: face, exists: true});
        g.turn = msg.sender == g.a ? g.b : g.a;
        g.deadline = uint64(block.timestamp) + ACTION_CLOCK;
        emit BidMade(id, msg.sender, quantity, face);
    }

    /// @notice Challenge the standing bid as cap. Moves to reveal.
    function callCap(uint256 id) external nonReentrant {
        Game storage g = games[id];
        require(g.phase == Phase.BIDDING, "not bidding");
        require(msg.sender == g.turn, "not your turn");
        require(g.last.exists, "no bid to call");
        g.challenger = msg.sender;
        g.phase = Phase.REVEAL;
        g.deadline = uint64(block.timestamp) + REVEAL_WINDOW;
        emit Called(id, msg.sender);
    }

    // ── Reveal ──────────────────────────────────────────────────────────
    function reveal(uint256 id, uint8[5] calldata dice, bytes32 salt) external nonReentrant {
        Game storage g = games[id];
        require(g.phase == Phase.REVEAL, "not reveal");
        for (uint256 i; i < DICE; ++i) require(dice[i] >= 1 && dice[i] <= 6, "bad die");
        bytes32 commit = keccak256(abi.encodePacked(dice, salt));
        if (msg.sender == g.a) {
            require(!g.revealedA, "done");
            require(commit == g.commitA, "bad reveal");
            g.diceA = dice;
            g.revealedA = true;
        } else if (msg.sender == g.b) {
            require(!g.revealedB, "done");
            require(commit == g.commitB, "bad reveal");
            g.diceB = dice;
            g.revealedB = true;
        } else {
            revert("not a player");
        }
        if (g.revealedA && g.revealedB) _resolve(id);
    }

    function _resolve(uint256 id) internal {
        Game storage g = games[id];
        uint8 count;
        for (uint256 i; i < DICE; ++i) {
            if (g.diceA[i] == g.last.face) count++;
            if (g.diceB[i] == g.last.face) count++;
        }
        // Bid holds if the board has at least `quantity` of the face.
        bool bidHolds = count >= g.last.quantity;
        // The bidder is the opponent of the challenger.
        address bidder = g.challenger == g.a ? g.b : g.a;
        address winner = bidHolds ? bidder : g.challenger;
        _payWinner(id, winner);
        emit Resolved(id, winner, count);
    }

    // ── Stall / expiry handling (permissionless) ────────────────────────
    function poke(uint256 id) external override nonReentrant {
        if (id == 0) return;
        Game storage g = games[id];
        if (g.phase == Phase.OPEN && block.timestamp > g.createdAt + ACCEPT_EXPIRY) {
            address[] memory ps = new address[](1);
            uint256[] memory ams = new uint256[](1);
            ps[0] = g.a;
            ams[0] = g.stake;
            vault.refund(_roundKey(id), ps, ams);
            tickets.setStatus(g.ticketA, IPositionNFT.Status.REFUNDED);
            g.phase = Phase.EXPIRED;
        } else if (g.phase == Phase.BIDDING && block.timestamp > g.deadline) {
            // The player on the clock stalled → they forfeit.
            address winner = g.turn == g.a ? g.b : g.a;
            _payWinner(id, winner);
            emit Resolved(id, winner, 0);
        } else if (g.phase == Phase.REVEAL && block.timestamp > g.deadline) {
            // Whoever didn't reveal forfeits; both silent → house.
            if (g.revealedA && !g.revealedB) _payWinner(id, g.a);
            else if (g.revealedB && !g.revealedA) _payWinner(id, g.b);
            else {
                vault.houseWin(_roundKey(id));
                tickets.setStatus(g.ticketA, IPositionNFT.Status.LOST);
                tickets.setStatus(g.ticketB, IPositionNFT.Status.LOST);
                g.phase = Phase.SETTLED;
            }
        }
    }

    function _payWinner(uint256 id, address winner) internal {
        Game storage g = games[id];
        uint256 pot = uint256(g.stake) * 2;
        uint256 rake = (pot * RAKE_BPS) / 10_000;
        address[] memory ws = new address[](1);
        uint256[] memory ams = new uint256[](1);
        ws[0] = winner;
        ams[0] = pot - rake;
        vault.settle(_roundKey(id), ws, ams, RAKE_BPS);
        (uint256 wTicket, uint256 lTicket) =
            winner == g.a ? (g.ticketA, g.ticketB) : (g.ticketB, g.ticketA);
        tickets.setStatus(wTicket, IPositionNFT.Status.WON);
        tickets.setStatus(lTicket, IPositionNFT.Status.LOST);
        g.phase = Phase.SETTLED;
    }

    function claimTicket(uint256 tokenId) external nonReentrant {
        IPositionNFT.Ticket memory tk = tickets.ticket(tokenId);
        require(tk.status == IPositionNFT.Status.WON, "not won");
        tickets.setStatus(tokenId, IPositionNFT.Status.CLAIMED);
        tickets.burn(tokenId);
    }
}
