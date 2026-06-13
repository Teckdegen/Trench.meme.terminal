// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DuelEngine} from "./DuelEngine.sol";

/// @notice Coinflip duel. pick = 0 (heads) or 1 (tails) — players must pick
///         opposite sides to match (enforced here).
///
///         STAKE-WEIGHTED FAIRNESS: with unequal stakes a plain 50/50 coin
///         would be -EV for the larger staker. Instead a player's win
///         probability equals their share of the pot:
///             P(A wins) = stakeA / (stakeA + stakeB)
///         Risking 50 to win 40 then wins 55.6% of the time — fair EV for both
///         at ANY stake combo, which is exactly what makes tolerance matching
///         honest. Equal stakes collapse to a true 50/50.
contract Coinflip is DuelEngine {
    constructor(address vault_, address tickets_) DuelEngine(vault_, tickets_) {}

    function gameId() public pure override returns (bytes32) {
        return "coinflip";
    }

    function _resolve(Duel storage d, uint256 e) internal view override returns (uint8) {
        require(d.pickA != d.pickB, "same side"); // must be opposite calls
        uint256 pot = uint256(d.stakeA) + d.stakeB;
        // Uniform draw in [0, pot). A wins the lower stakeA-wide slice.
        uint256 roll = e % pot;
        return roll < d.stakeA ? 0 : 1;
    }
}
