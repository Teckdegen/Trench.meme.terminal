// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IGame} from "../interfaces/IGame.sol";
import {IVault} from "../interfaces/IVault.sol";
import {IPositionNFT} from "../interfaces/IPositionNFT.sol";

/// @notice Diamond Hands (Chicken). Two degens stake equal bags. From the match
///         block a multiplier climbs with every block. Either can `paperHand()`
///         to tap out — the FIRST to fold loses the pot to the one who held.
///         Nobody folds before `CRASH_BLOCKS` elapse? Both paper-handed by the
///         market: the position crashes and the house takes the pot. Pure nerve.
contract DiamondHands is IGame, ReentrancyGuard {
    IVault public immutable vault;
    IPositionNFT public immutable tickets;

    uint16 public constant RAKE_BPS = 1000; // 10%
    uint64 public constant ACCEPT_EXPIRY = 10 minutes;
    uint64 public constant CRASH_BLOCKS = 900; // ~6 min on 400ms blocks

    enum Phase {
        OPEN,
        LIVE,
        SETTLED,
        EXPIRED
    }

    struct Game {
        address a;
        address b;
        uint128 stake;
        uint64 createdAt;
        uint64 startBlock;
        uint256 ticketA;
        uint256 ticketB;
        Phase phase;
    }

    uint256 public nextGame = 1;
    mapping(uint256 => Game) public games;

    event Posted(uint256 indexed id, address indexed a, uint128 stake);
    event Matched(uint256 indexed id, address indexed b, uint64 startBlock);
    event Folded(uint256 indexed id, address indexed folder, address indexed winner);
    event Crashed(uint256 indexed id);

    constructor(address vault_, address tickets_) {
        vault = IVault(vault_);
        tickets = IPositionNFT(tickets_);
    }

    function gameId() public pure returns (bytes32) {
        return "diamondhands";
    }

    function _roundKey(uint256 id) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(gameId(), id));
    }

    function post() external payable nonReentrant returns (uint256 id) {
        require(msg.value > 0, "no stake");
        id = nextGame++;
        Game storage g = games[id];
        g.a = msg.sender;
        g.stake = uint128(msg.value);
        g.createdAt = uint64(block.timestamp);
        g.phase = Phase.OPEN;
        g.ticketA = tickets.mint(msg.sender, gameId(), id, 0, uint128(msg.value));
        vault.deposit{value: msg.value}(_roundKey(id));
        emit Posted(id, msg.sender, uint128(msg.value));
    }

    function accept(uint256 id) external payable nonReentrant {
        Game storage g = games[id];
        require(g.phase == Phase.OPEN, "not open");
        require(msg.sender != g.a, "self");
        require(msg.value == g.stake, "match the stake"); // equal-stake nerve game
        g.b = msg.sender;
        g.startBlock = uint64(block.number);
        g.phase = Phase.LIVE;
        g.ticketB = tickets.mint(msg.sender, gameId(), id, 1, uint128(msg.value));
        vault.deposit{value: msg.value}(_roundKey(id));
        emit Matched(id, msg.sender, uint64(block.number));
    }

    /// @notice Tap out. First folder loses the pot to the diamond hand.
    function paperHand(uint256 id) external nonReentrant {
        Game storage g = games[id];
        require(g.phase == Phase.LIVE, "not live");
        require(msg.sender == g.a || msg.sender == g.b, "not a player");
        require(block.number <= uint256(g.startBlock) + CRASH_BLOCKS, "crashed");

        address winner = msg.sender == g.a ? g.b : g.a;
        _payWinner(id, winner, winner == g.a ? g.ticketA : g.ticketB,
            winner == g.a ? g.ticketB : g.ticketA);
        emit Folded(id, msg.sender, winner);
    }

    /// @notice Permissionless: once CRASH_BLOCKS pass with nobody folding, both
    ///         held too long, the position crashes and the house takes the pot.
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
        } else if (g.phase == Phase.LIVE && block.number > uint256(g.startBlock) + CRASH_BLOCKS) {
            vault.houseWin(_roundKey(id));
            tickets.setStatus(g.ticketA, IPositionNFT.Status.LOST);
            tickets.setStatus(g.ticketB, IPositionNFT.Status.LOST);
            g.phase = Phase.SETTLED;
            emit Crashed(id);
        }
    }

    function _payWinner(uint256 id, address winner, uint256 winTicket, uint256 loseTicket) internal {
        Game storage g = games[id];
        uint256 pot = uint256(g.stake) * 2;
        uint256 rake = (pot * RAKE_BPS) / 10_000;
        address[] memory ws = new address[](1);
        uint256[] memory ams = new uint256[](1);
        ws[0] = winner;
        ams[0] = pot - rake;
        vault.settle(_roundKey(id), ws, ams, RAKE_BPS);
        tickets.setStatus(winTicket, IPositionNFT.Status.WON);
        tickets.setStatus(loseTicket, IPositionNFT.Status.LOST);
        g.phase = Phase.SETTLED;
    }

    function claimTicket(uint256 tokenId) external nonReentrant {
        IPositionNFT.Ticket memory tk = tickets.ticket(tokenId);
        require(tk.status == IPositionNFT.Status.WON, "not won");
        tickets.setStatus(tokenId, IPositionNFT.Status.CLAIMED);
        tickets.burn(tokenId);
    }
}
