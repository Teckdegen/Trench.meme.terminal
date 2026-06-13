// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Randomness helpers. Two modes, both fully onchain — no operator,
///         no offchain seed.
///
///         DUEL  : player-vs-player commit-reveal. entropy = H(secretA, secretB,
///                 id). Neither side (nor the house) can bias it; a no-reveal
///                 forfeits, so stalling is strictly losing.
///         POOL  : H(blockhash(lockBlock+1), id, betSalt). The entropy block is
///                 AFTER betting closes, so no bettor can position against a
///                 known result. betSalt accumulates every bet so a block
///                 producer alone cannot fully control the draw either.
library Entropy {
    /// @dev Fold one bet into a round's running salt. Call on every placeBet.
    function addBet(bytes32 salt, address who, uint256 amount, uint64 pick)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(salt, who, amount, pick));
    }

    /// @dev Pool-mode draw. Reverts if the entropy block is unavailable
    ///      (>256 blocks since lock with zero interactions) so the caller can
    ///      route to a void+refund instead of drawing from blockhash 0.
    function poolEntropy(uint64 lockBlock, uint256 id, bytes32 betSalt)
        internal
        view
        returns (uint256)
    {
        uint256 entropyBlock = uint256(lockBlock) + 1;
        require(block.number > entropyBlock, "too early");
        bytes32 bh = blockhash(entropyBlock);
        require(bh != bytes32(0), "blockhash expired");
        return uint256(keccak256(abi.encodePacked(bh, id, betSalt)));
    }

    /// @dev Whether the entropy block for a pool round is still drawable.
    function poolDrawable(uint64 lockBlock) internal view returns (bool) {
        uint256 entropyBlock = uint256(lockBlock) + 1;
        return block.number > entropyBlock && blockhash(entropyBlock) != bytes32(0);
    }

    /// @dev Duel-mode draw from both revealed secrets.
    function duelEntropy(bytes32 secretA, bytes32 secretB, uint256 id)
        internal
        pure
        returns (uint256)
    {
        return uint256(keccak256(abi.encodePacked(secretA, secretB, id)));
    }

    function commit(bytes32 secret) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(secret));
    }
}
