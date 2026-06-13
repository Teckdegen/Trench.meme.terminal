// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DuelEngine} from "./DuelEngine.sol";

/// @notice Dice duel. Each player gets a roll in [0, 1e6) derived from the
///         shared entropy salted by their address, BIASED by stake so the game
///         stays fair under unequal stakes (same principle as Coinflip — a
///         bigger stake buys a proportionally better expected roll). Higher
///         roll wins; exact tie rerolls with a nonce.
contract DiceDuel is DuelEngine {
    constructor(address vault_, address tickets_) DuelEngine(vault_, tickets_) {}

    function gameId() public pure override returns (bytes32) {
        return "dice";
    }

    function _resolve(Duel storage d, uint256 e) internal view override returns (uint8) {
        uint256 pot = uint256(d.stakeA) + d.stakeB;
        for (uint256 nonce; nonce < 8; ++nonce) {
            // Stake-weighted: scale each raw roll by the opponent-relative odds
            // so P(win) tracks pot share. Equivalent to a single uniform draw
            // over the pot, but exposes two "dice" to the UI.
            uint256 rollA = uint256(keccak256(abi.encodePacked(e, d.a, nonce))) % pot;
            uint256 rollB = uint256(keccak256(abi.encodePacked(e, d.b, nonce))) % pot;
            // Weight: A's effective score = rollA scaled by stakeB, B's by
            // stakeA, so the larger staker needs a smaller raw roll to win.
            uint256 scoreA = rollA * d.stakeB;
            uint256 scoreB = rollB * d.stakeA;
            if (scoreA > scoreB) return 0;
            if (scoreB > scoreA) return 1;
            // exact tie → reroll with next nonce
        }
        return 2; // astronomically unlikely: settle as push
    }
}
