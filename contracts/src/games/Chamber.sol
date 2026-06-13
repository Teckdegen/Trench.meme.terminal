// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LobbyEngine} from "./LobbyEngine.sol";

/// @notice Chamber (Russian Roulette). 6 degens load the clip with equal
///         stakes. The entropy spins the cylinder and one seat takes the
///         bullet — the loser. The pot (minus rake) splits among the survivors,
///         so every survivor walks away up by roughly one buy-in. One in six
///         eats the whole table.
contract Chamber is LobbyEngine {
    constructor(address vault_, address tickets_) LobbyEngine(vault_, tickets_) {}

    function gameId() public pure override returns (bytes32) {
        return "chamber";
    }

    function capacity() public pure override returns (uint8) {
        return 6;
    }

    function _resolveLobby(uint256 id, uint256 entropy)
        internal
        view
        override
        returns (address[] memory winners, uint256[] memory amounts)
    {
        Table storage t = _tables[id];
        uint256 n = t.seats.length;
        uint256 loser = entropy % n;

        uint256 pool = uint256(t.buyIn) * n;
        uint256 rake = (pool * RAKE_BPS) / 10_000;
        uint256 each = (pool - rake) / (n - 1); // split among survivors

        winners = new address[](n - 1);
        amounts = new uint256[](n - 1);
        uint256 k;
        for (uint256 i; i < n; ++i) {
            if (i == loser) continue;
            winners[k] = t.seats[i].who;
            amounts[k] = each;
            k++;
        }
    }
}
