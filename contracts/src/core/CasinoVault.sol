// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IVault} from "../interfaces/IVault.sol";
import {GameRegistry} from "./GameRegistry.sol";

/// @notice The money hub. Holds every escrowed MON; games instruct it but never
///         touch funds directly. Conservation is enforced: a round cannot pay
///         out more than it took in, and the house ALWAYS takes its rake on any
///         settlement (pure refunds excepted — there is no pot to rake there).
///
///         Payouts are pull-based: settle()/refund()/houseWin() only update
///         `claimable` balances and the fee accrual; recipients withdraw via
///         claim(). One reverting recipient can never block a round.
contract CasinoVault is IVault, ReentrancyGuard, Ownable {
    GameRegistry public immutable registry;
    address public feeWallet;

    mapping(bytes32 => uint256) public pool; // roundKey => escrowed total
    mapping(bytes32 => bool) public resolved; // roundKey => settled/refunded
    mapping(address => uint256) public claimable; // pull payments
    uint256 public houseAccrued; // rake + house wins awaiting sweep

    event Deposited(bytes32 indexed roundKey, address indexed from, uint256 amount);
    event Settled(bytes32 indexed roundKey, uint256 paidOut, uint256 rake);
    event HouseWon(bytes32 indexed roundKey, uint256 amount);
    event Refunded(bytes32 indexed roundKey, uint256 amount);
    event Claimed(address indexed who, uint256 amount);
    event HouseSwept(address indexed to, uint256 amount);

    modifier onlyGame() {
        require(registry.isGame(msg.sender), "not a game");
        _;
    }

    constructor(address registry_, address feeWallet_, address owner_) Ownable(owner_) {
        registry = GameRegistry(registry_);
        feeWallet = feeWallet_;
    }

    // ── Escrow ──────────────────────────────────────────────────────────
    function deposit(bytes32 roundKey) external payable onlyGame {
        require(!resolved[roundKey], "round resolved");
        require(msg.value > 0, "zero");
        pool[roundKey] += msg.value;
        emit Deposited(roundKey, tx.origin, msg.value);
    }

    // ── Settlement ──────────────────────────────────────────────────────
    /// @inheritdoc IVault
    function settle(
        bytes32 roundKey,
        address[] calldata winners,
        uint256[] calldata amounts,
        uint16 rakeBps
    ) external onlyGame nonReentrant {
        require(!resolved[roundKey], "resolved");
        require(winners.length == amounts.length, "len");
        uint256 p = pool[roundKey];
        require(p > 0, "empty");

        uint256 rake = (p * rakeBps) / 10_000;
        uint256 payout;
        for (uint256 i; i < winners.length; ++i) {
            claimable[winners[i]] += amounts[i];
            payout += amounts[i];
        }
        // Conservation: nothing conjured, nothing lost. Rounding dust (if any)
        // stays as rake to the house, never the other way.
        require(payout + rake <= p, "overpay");
        uint256 dust = p - payout - rake;
        houseAccrued += rake + dust;

        resolved[roundKey] = true;
        pool[roundKey] = 0;
        emit Settled(roundKey, payout, rake + dust);
    }

    /// @inheritdoc IVault
    function houseWin(bytes32 roundKey) external onlyGame {
        require(!resolved[roundKey], "resolved");
        uint256 p = pool[roundKey];
        require(p > 0, "empty");
        houseAccrued += p;
        resolved[roundKey] = true;
        pool[roundKey] = 0;
        emit HouseWon(roundKey, p);
    }

    /// @inheritdoc IVault
    function refund(bytes32 roundKey, address[] calldata players, uint256[] calldata amounts)
        external
        onlyGame
        nonReentrant
    {
        require(!resolved[roundKey], "resolved");
        require(players.length == amounts.length, "len");
        uint256 p = pool[roundKey];
        uint256 total;
        for (uint256 i; i < players.length; ++i) {
            claimable[players[i]] += amounts[i];
            total += amounts[i];
        }
        require(total <= p, "over-refund");
        resolved[roundKey] = true;
        pool[roundKey] = 0;
        // Any rounding remainder on a refund (should be 0) sticks to the house.
        if (p > total) houseAccrued += p - total;
        emit Refunded(roundKey, total);
    }

    // ── Withdrawals ─────────────────────────────────────────────────────
    function claim() external nonReentrant {
        uint256 amt = claimable[msg.sender];
        require(amt > 0, "nothing");
        claimable[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amt}("");
        require(ok, "send failed");
        emit Claimed(msg.sender, amt);
    }

    /// @notice Anyone can push accrued house revenue to the fee wallet.
    function sweepHouse() external nonReentrant {
        uint256 amt = houseAccrued;
        require(amt > 0, "nothing");
        houseAccrued = 0;
        (bool ok,) = feeWallet.call{value: amt}("");
        require(ok, "send failed");
        emit HouseSwept(feeWallet, amt);
    }

    function setFeeWallet(address w) external onlyOwner {
        require(w != address(0), "zero");
        feeWallet = w;
    }

    function poolOf(bytes32 roundKey) external view returns (uint256) {
        return pool[roundKey];
    }

    function claimableOf(address who) external view returns (uint256) {
        return claimable[who];
    }
}
