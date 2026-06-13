// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DuelEngine} from "./DuelEngine.sol";

/// @notice Alpha Call (Number Nuke). Both players secretly call a number 0..999
///         (their `pick` at post/accept time). The entropy draws a hidden
///         target; whoever called CLOSEST to it wins the pot. The twist: if you
///         both call the SAME number, you both nuke yourselves and the house
///         takes the pot — so copying the obvious answer is suicide.
///
///         Stake-weighting note: closeness is the only criterion, so unequal
///         stakes within the match band just change the pot. Equal distance
///         (different calls) is a push.
contract AlphaCall is DuelEngine {
    constructor(address vault_, address tickets_) DuelEngine(vault_, tickets_) {}

    function gameId() public pure override returns (bytes32) {
        return "alphacall";
    }

    function _resolve(Duel storage d, uint256 e) internal view override returns (uint8) {
        uint256 a = uint256(d.pickA) % 1000;
        uint256 b = uint256(d.pickB) % 1000;
        if (a == b) return 3; // collision → both bust, house wins
        uint256 target = e % 1000;
        uint256 da = a > target ? a - target : target - a;
        uint256 db = b > target ? b - target : target - b;
        if (da < db) return 0;
        if (db < da) return 1;
        return 2; // equal distance, different calls → push
    }
}
