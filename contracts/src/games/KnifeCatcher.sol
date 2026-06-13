// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LobbyEngine} from "./LobbyEngine.sol";

/// @notice Knife Catcher (Musical Chairs). 8 degens, equal stakes. The UI
///         animates round-by-round eliminations as the knife falls, but the
///         math is one fair draw: every seat has an equal 1/N shot and the last
///         degen still holding takes the whole pot (minus rake). Last hand on
///         the falling knife wins.
contract KnifeCatcher is LobbyEngine {
    constructor(address vault_, address tickets_) LobbyEngine(vault_, tickets_) {}

    function gameId() public pure override returns (bytes32) {
        return "knifecatcher";
    }

    function capacity() public pure override returns (uint8) {
        return 8;
    }

    function _resolveLobby(uint256 id, uint256 entropy)
        internal
        view
        override
        returns (address[] memory winners, uint256[] memory amounts)
    {
        Table storage t = _tables[id];
        uint256 n = t.seats.length;
        uint256 win = entropy % n;

        uint256 pool = uint256(t.buyIn) * n;
        uint256 rake = (pool * RAKE_BPS) / 10_000;

        winners = new address[](1);
        amounts = new uint256[](1);
        winners[0] = t.seats[win].who;
        amounts[0] = pool - rake;
    }
}
