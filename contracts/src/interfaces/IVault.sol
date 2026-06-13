// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The escrow + accounting hub. Games never hold MON; they instruct
///         the Vault. All payouts are pull-based (claimable balances).
interface IVault {
    /// @notice Escrow MON into a round's pool. Called by a registered game,
    ///         forwarding the player's stake. roundKey = keccak(game, roundId).
    function deposit(bytes32 roundKey) external payable;

    /// @notice Settle a round: credit winners, skim rake to the fee wallet.
    ///         The game passes explicit amounts; the Vault enforces
    ///         `sum(amounts) + rake == pool` so no MON is conjured or lost.
    function settle(
        bytes32 roundKey,
        address[] calldata winners,
        uint256[] calldata amounts,
        uint16 rakeBps
    ) external;

    /// @notice Whole pool to the house, minus nothing (the "nobody won" case).
    function houseWin(bytes32 roundKey) external;

    /// @notice Return stakes to players with no rake (unmatched / voided).
    function refund(bytes32 roundKey, address[] calldata players, uint256[] calldata amounts)
        external;

    /// @notice Pull your winnings/refunds.
    function claim() external;

    function poolOf(bytes32 roundKey) external view returns (uint256);
    function claimableOf(address who) external view returns (uint256);
}
