// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IGame} from "../interfaces/IGame.sol";
import {IVault} from "../interfaces/IVault.sol";
import {IPositionNFT} from "../interfaces/IPositionNFT.sol";

/// @notice Pump or Dump — MON Up/Down, the ONE token game. Deliberately rigid:
///           - only asset: MON
///           - only market: the 5-minute round, back to back forever
///           - exactly 5 stake tiers: 5 / 10 / 25 / 50 / 100 MON
///
///         DESIGN: this game is FULLY OFFCHAIN except for the money. The
///         contract is just escrow + payout (a thin shell over CasinoVault).
///         All the heavy lifting — matching UP vs DOWN bets into winner/loser
///         pairs, drawing the line, and the win math — happens in the trench
///         bot offchain, so a single round can hold a MILLION players without
///         any onchain matching loops.
///
///         FLOW:
///           1. Players `bet(dir)` with one of the 5 tier amounts → escrowed.
///           2. After 5 minutes the bot reads the live MON price and computes,
///              offchain, the full winner/loser pairing and each winner's
///              payout (every winner funded by exactly one equal-tier loser).
///           3. The bot calls `resolve(roundId, winners, amounts, monPrice)`.
///              The contract pays out via the Vault, which enforces
///              conservation (cannot pay more than the round escrowed) and
///              skims the 6% house rake. The `monPrice` and the open/close
///              are recorded in events so every settlement is auditable.
///
///         TRUST: the bot is trusted to compute the pairing + price correctly,
///         exactly like the Up/Down price bot. It CANNOT over-pay (the Vault
///         caps payout at the escrowed pool) and cannot touch funds outside a
///         round. Players who were left unmatched are included in the resolve
///         as full refunds. A round the bot never resolves can be reclaimed by
///         players after a timeout (see `reclaim`).
contract PumpOrDump is IGame, ReentrancyGuard, Ownable {
    IVault public immutable vault;
    IPositionNFT public immutable tickets;
    address public resolver; // the trench bot

    uint16 public constant RAKE_BPS = 600; // 6%
    uint64 public constant ROUND_SECONDS = 5 minutes;
    uint64 public constant RECLAIM_AFTER = 1 hours; // bot-down safety net

    uint128[5] public TIERS =
        [uint128(5 ether), uint128(10 ether), uint128(25 ether), uint128(50 ether), uint128(100 ether)];

    enum Dir {
        UP,
        DOWN
    }

    enum Phase {
        BETTING,
        RESOLVED,
        VOID
    }

    struct Entry {
        address player;
        uint8 tier;
        Dir dir;
        uint256 ticketId;
        bool paid;
    }

    struct Round {
        uint64 openedAt;
        uint64 closesAt; // betting + price window end
        Phase phase;
        Entry[] entries;
    }

    uint256 public currentRound;
    mapping(uint256 => Round) internal _rounds;

    event RoundOpened(uint256 indexed id, uint64 closesAt);
    event Bet(uint256 indexed id, address indexed player, uint8 tier, Dir dir, uint256 ticketId);
    event Resolved(uint256 indexed id, uint192 monPrice, uint256 winnersPaid);
    event Voided(uint256 indexed id);

    modifier onlyResolver() {
        require(msg.sender == resolver, "not resolver");
        _;
    }

    constructor(address vault_, address tickets_, address resolver_, address owner_)
        Ownable(owner_)
    {
        vault = IVault(vault_);
        tickets = IPositionNFT(tickets_);
        resolver = resolver_;
        _open();
    }

    function gameId() public pure returns (bytes32) {
        return "pumpdump";
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
        r.openedAt = uint64(block.timestamp);
        r.closesAt = uint64(block.timestamp) + ROUND_SECONDS;
        r.phase = Phase.BETTING;
        emit RoundOpened(id, r.closesAt);
    }

    // ── Bet: pick direction + one of the 5 tiers ────────────────────────
    function bet(Dir dir) external payable nonReentrant {
        // Open the next round if the current one's window has elapsed. (The
        // bot resolves the previous one separately; opening is permissionless.)
        if (block.timestamp >= _rounds[currentRound].closesAt) _open();

        Round storage r = _rounds[currentRound];
        require(r.phase == Phase.BETTING, "closed");
        int256 ti = _tierOf(msg.value);
        require(ti >= 0, "bad tier");

        uint256 ticketId =
            tickets.mint(msg.sender, gameId(), currentRound, uint64(dir), uint128(msg.value));
        r.entries.push(
            Entry({
                player: msg.sender,
                tier: uint8(uint256(ti)),
                dir: dir,
                ticketId: ticketId,
                paid: false
            })
        );

        vault.deposit{value: msg.value}(_roundKey(currentRound));
        emit Bet(currentRound, msg.sender, uint8(uint256(ti)), dir, ticketId);
    }

    // ── Resolve: bot pushes the offchain-computed result ────────────────
    /// @param id        the round to settle
    /// @param winners   winner addresses (offchain-paired against equal-tier
    ///                   losers; UNMATCHED players included here at their stake
    ///                   = full refund)
    /// @param amounts   payout per winner (stake back + winnings, or just stake
    ///                   for unmatched refunds); the Vault enforces
    ///                   sum(amounts) + rake <= pool
    /// @param winTicketIds tickets to mark WON (parallel to a status pass)
    /// @param loseTicketIds tickets to mark LOST
    /// @param monPrice  the MON price the bot settled on (recorded for audit)
    function resolve(
        uint256 id,
        address[] calldata winners,
        uint256[] calldata amounts,
        uint256[] calldata winTicketIds,
        uint256[] calldata loseTicketIds,
        uint192 monPrice
    ) external onlyResolver nonReentrant {
        Round storage r = _rounds[id];
        require(r.phase == Phase.BETTING, "not open");
        require(block.timestamp >= r.closesAt, "too early");
        require(winners.length == amounts.length, "len");

        // Pay out. Vault caps total at the escrowed pool and skims rake — the
        // bot can never over-pay even if it computes wrong.
        vault.settle(_roundKey(id), winners, amounts, RAKE_BPS);

        for (uint256 i; i < winTicketIds.length; ++i) {
            tickets.setStatus(winTicketIds[i], IPositionNFT.Status.WON);
        }
        for (uint256 i; i < loseTicketIds.length; ++i) {
            tickets.setStatus(loseTicketIds[i], IPositionNFT.Status.LOST);
        }

        r.phase = Phase.RESOLVED;
        emit Resolved(id, monPrice, winners.length);
    }

    function claimTicket(uint256 tokenId) external nonReentrant {
        IPositionNFT.Ticket memory t = tickets.ticket(tokenId);
        require(t.status == IPositionNFT.Status.WON, "not won");
        tickets.setStatus(tokenId, IPositionNFT.Status.CLAIMED);
        tickets.burn(tokenId);
    }

    // ── Safety net: bot down → players reclaim their stake ──────────────
    /// @notice If the bot never resolves a round within RECLAIM_AFTER, anyone
    ///         can void it and every player is refunded their stake (no rake).
    function reclaim(uint256 id) external nonReentrant {
        Round storage r = _rounds[id];
        require(r.phase == Phase.BETTING, "resolved");
        require(block.timestamp >= r.closesAt + RECLAIM_AFTER, "wait");

        uint256 n = r.entries.length;
        address[] memory ps = new address[](n);
        uint256[] memory ams = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            ps[i] = r.entries[i].player;
            ams[i] = TIERS[r.entries[i].tier];
            tickets.setStatus(r.entries[i].ticketId, IPositionNFT.Status.REFUNDED);
        }
        if (n > 0) vault.refund(_roundKey(id), ps, ams);
        r.phase = Phase.VOID;
        emit Voided(id);
    }

    // ── Permissionless round rollover ───────────────────────────────────
    function poke(uint256) external override nonReentrant {
        if (block.timestamp >= _rounds[currentRound].closesAt) _open();
    }

    function setResolver(address r) external onlyOwner {
        require(r != address(0), "zero");
        resolver = r;
    }

    function entryCount(uint256 id) external view returns (uint256) {
        return _rounds[id].entries.length;
    }

    function roundInfo(uint256 id)
        external
        view
        returns (uint64 openedAt, uint64 closesAt, Phase phase, uint256 entries)
    {
        Round storage r = _rounds[id];
        return (r.openedAt, r.closesAt, r.phase, r.entries.length);
    }
}
