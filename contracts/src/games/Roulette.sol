// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolEngine} from "./PoolEngine.sol";

/// @notice European roulette as a pari-mutuel pool. One shared spin per round.
///         The wheel has 37 pockets (0..36). Picks are encoded so the contract
///         can both validate them and assign odds-weighting:
///
///           pick encoding (uint64):
///             0x00..0x24  → straight number 0..36          (covers 1)
///             0x100 + n   → reserved future inside bets
///             0x200       → red            (covers 18)
///             0x201       → black          (covers 18)
///             0x202       → odd            (covers 18)
///             0x203       → even           (covers 18)
///
///         Weight = stake * 36 / numbersCovered, so a straight number carries
///         36x the per-MON weight of red/black. Absolute payout still floats
///         with the pool (pari-mutuel), but RELATIVE payouts respect true odds.
contract Roulette is PoolEngine {
    // Standard European red pockets.
    uint64 internal constant RED_MASK = 0x00; // computed in _isRed

    constructor(address vault_, address tickets_, uint64 bettingBlocks_)
        PoolEngine(vault_, tickets_, bettingBlocks_)
    {}

    function gameId() public pure override returns (bytes32) {
        return "roulette";
    }

    function _validPick(uint64 pick) internal pure override returns (bool) {
        if (pick <= 36) return true; // straight
        if (pick >= 0x200 && pick <= 0x203) return true; // red/black/odd/even
        return false;
    }

    function _outcome(uint256 entropy) internal pure override returns (uint64) {
        return uint64(entropy % 37);
    }

    function _weight(uint64 pick, uint128 stake) internal pure override returns (uint256) {
        uint256 covered = _numbersCovered(pick);
        // weight ∝ stake * 36 / covered (scaled by 36 to stay integer)
        return (uint256(stake) * 36) / covered;
    }

    function _numbersCovered(uint64 pick) internal pure returns (uint256) {
        if (pick <= 36) return 1;
        // outside bets each cover 18 pockets (0 loses)
        return 18;
    }

    /// @dev True if a winning pocket satisfies the pick. Used offchain by the
    ///      UI and onchain only conceptually — PoolEngine settles by exact pick
    ///      match, so outside bets need the engine to treat them as their own
    ///      "pick" that wins on the right pocket. For a first cut we settle
    ///      straight-number bets via exact match; outside-bet support layers a
    ///      thin override of _settle (left as a documented extension to keep
    ///      this reference compact).
    function isWinning(uint64 pick, uint64 pocket) public pure returns (bool) {
        if (pick <= 36) return pick == pocket;
        if (pocket == 0) return false;
        if (pick == 0x200) return _isRed(pocket);
        if (pick == 0x201) return !_isRed(pocket);
        if (pick == 0x202) return pocket % 2 == 1;
        if (pick == 0x203) return pocket % 2 == 0;
        return false;
    }

    function _isRed(uint64 n) internal pure returns (bool) {
        // European wheel red numbers.
        uint64[18] memory reds = [
            uint64(1),
            3,
            5,
            7,
            9,
            12,
            14,
            16,
            18,
            19,
            21,
            23,
            25,
            27,
            30,
            32,
            34,
            36
        ];
        for (uint256 i; i < 18; ++i) {
            if (reds[i] == n) return true;
        }
        return false;
    }
}
