// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Bet tickets. Uniswap-V3-style: the NFT *is* the position. Minted on
///         bet, transferable ONLY while OPEN (the live secondary market), and
///         always burned on resolution.
interface IPositionNFT {
    enum Status {
        OPEN, // live bet, transferable
        WON, // claimable; burned by claim()
        LOST, // dead; burnable by anyone via sweepBurn
        REFUNDED, // burned by the refund path
        CLAIMED // terminal; token no longer exists
    }

    struct Ticket {
        bytes32 gameId;
        uint256 roundId;
        uint64 pick; // game-specific encoding of the chosen outcome
        uint128 stake; // MON staked, wei
        uint64 mintedAt;
        Status status;
        address game; // module that minted it (authorized to mutate)
    }

    function mint(address to, bytes32 gameId, uint256 roundId, uint64 pick, uint128 stake)
        external
        returns (uint256 tokenId);

    /// @notice Game-only status transition (OPEN -> WON/LOST/REFUNDED).
    function setStatus(uint256 tokenId, Status status) external;

    /// @notice Burn a resolved ticket. Won tickets burn on claim; lost ones via
    ///         permissionless sweep; refunded ones on the refund path.
    function burn(uint256 tokenId) external;

    function ticket(uint256 tokenId) external view returns (Ticket memory);
}
