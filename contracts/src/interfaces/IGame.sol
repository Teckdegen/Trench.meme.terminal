// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Every game module the GameRegistry knows about implements this.
///         The registry only needs identity + a uniform "poke" so anyone can
///         drive a game's pending state transitions permissionlessly.
interface IGame {
    /// @return The stable string id of this game ("moondoom", "degenwheel"…).
    function gameId() external view returns (bytes32);

    /// @notice Permissionless transition poke. Settles any round/duel that is
    ///         due, expires stale challenges, sweep-burns dead tickets. Folded
    ///         into normal player actions too — this is the explicit entry the
    ///         keeper bounty pays out for. MUST be safe to call at any time.
    /// @param  hint An optional id (roundId/duelId) to focus work on; 0 = scan.
    function poke(uint256 hint) external;
}
