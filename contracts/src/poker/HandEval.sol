// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Compact 7-card Texas Hold'em hand evaluator. Returns a single
///         comparable uint score (higher = better) so the table can rank
///         showdown hands with simple > comparisons, including correct
///         kicker resolution.
///
///         Card encoding: 0..51, where rank = card % 13 (0=2 … 12=Ace) and
///         suit = card / 13 (0..3). Score layout (most significant first):
///             [category:4][r1:4][r2:4][r3:4][r4:4][r5:4]
///         category: 8=straight flush, 7=quads, 6=full house, 5=flush,
///                   4=straight, 3=trips, 2=two pair, 1=pair, 0=high card.
library HandEval {
    /// @param cards exactly 7 card codes (2 hole + 5 board).
    function best7(uint8[7] memory cards) internal pure returns (uint256 score) {
        uint256[13] memory rankCount;
        uint256[4] memory suitCount;
        // suit -> rank bitmask, for flush + straight-flush detection
        uint16[4] memory suitRankMask;
        uint16 rankMask;

        for (uint256 i; i < 7; ++i) {
            uint8 c = cards[i];
            uint8 r = c % 13;
            uint8 s = c / 13;
            rankCount[r] += 1;
            suitCount[s] += 1;
            suitRankMask[s] |= uint16(1 << r);
            rankMask |= uint16(1 << r);
        }

        // ── Flush / straight flush ──
        int256 flushSuit = -1;
        for (uint8 s; s < 4; ++s) {
            if (suitCount[s] >= 5) {
                flushSuit = int256(uint256(s));
                break;
            }
        }
        if (flushSuit >= 0) {
            uint16 fmask = suitRankMask[uint256(uint256(flushSuit))];
            uint8 sfHigh = _straightHigh(fmask);
            if (sfHigh != 255) {
                return _score(8, [uint8(sfHigh), 0, 0, 0, 0]);
            }
        }

        // ── Quads / full house / trips / pairs ──
        uint8 quad = 255;
        uint8 trip = 255;
        uint8 pairHi = 255;
        uint8 pairLo = 255;
        for (int256 r = 12; r >= 0; --r) {
            uint256 cnt = rankCount[uint256(r)];
            if (cnt == 4 && quad == 255) quad = uint8(uint256(r));
            else if (cnt == 3) {
                if (trip == 255) trip = uint8(uint256(r));
                else if (pairHi == 255) pairHi = uint8(uint256(r)); // second trip as pair
            } else if (cnt == 2) {
                if (pairHi == 255) pairHi = uint8(uint256(r));
                else if (pairLo == 255) pairLo = uint8(uint256(r));
            }
        }

        if (quad != 255) {
            uint8 kick = _highestExcluding(rankMask, quad, 255, 255, 255, 255);
            return _score(7, [quad, kick, 0, 0, 0]);
        }
        if (trip != 255 && pairHi != 255) {
            return _score(6, [trip, pairHi, 0, 0, 0]);
        }
        if (flushSuit >= 0) {
            uint8[5] memory top = _top5(suitRankMask[uint256(uint256(flushSuit))]);
            return _score(5, top);
        }
        uint8 stHigh = _straightHigh(rankMask);
        if (stHigh != 255) {
            return _score(4, [stHigh, 0, 0, 0, 0]);
        }
        if (trip != 255) {
            uint8 k1 = _highestExcluding(rankMask, trip, 255, 255, 255, 255);
            uint8 k2 = _highestExcluding(rankMask, trip, k1, 255, 255, 255);
            return _score(3, [trip, k1, k2, 0, 0]);
        }
        if (pairHi != 255 && pairLo != 255) {
            uint8 k = _highestExcluding(rankMask, pairHi, pairLo, 255, 255, 255);
            return _score(2, [pairHi, pairLo, k, 0, 0]);
        }
        if (pairHi != 255) {
            uint8 k1 = _highestExcluding(rankMask, pairHi, 255, 255, 255, 255);
            uint8 k2 = _highestExcluding(rankMask, pairHi, k1, 255, 255, 255);
            uint8 k3 = _highestExcluding(rankMask, pairHi, k1, k2, 255, 255);
            return _score(1, [pairHi, k1, k2, k3, 0]);
        }
        return _score(0, _top5(rankMask));
    }

    function _score(uint8 cat, uint8[5] memory rs) private pure returns (uint256) {
        return (uint256(cat) << 20) | (uint256(rs[0]) << 16) | (uint256(rs[1]) << 12)
            | (uint256(rs[2]) << 8) | (uint256(rs[3]) << 4) | uint256(rs[4]);
    }

    /// @dev Highest straight in a 13-bit rank mask. Handles wheel (A-2-3-4-5).
    ///      Returns the straight's high card rank, or 255 if none.
    function _straightHigh(uint16 mask) private pure returns (uint8) {
        // Ace low: treat bit12 (Ace) as also bit "-1" below 2.
        uint16 m = mask;
        // wheel: A,2,3,4,5 → ranks 12,0,1,2,3
        if ((m & 0x100F) == 0x100F) {
            // check 5-high specifically below; continue to find higher first
        }
        for (int256 hi = 12; hi >= 4; --hi) {
            uint16 need = uint16(((1 << 5) - 1) << uint256(hi - 4)); // 5 consecutive
            if ((m & need) == need) return uint8(uint256(hi));
        }
        // wheel
        if ((m & 0x100F) == 0x100F) return 3; // 5-high straight
        return 255;
    }

    function _top5(uint16 mask) private pure returns (uint8[5] memory out) {
        uint256 j;
        for (int256 r = 12; r >= 0 && j < 5; --r) {
            if (mask & uint16(1 << uint256(r)) != 0) {
                out[j++] = uint8(uint256(r));
            }
        }
    }

    function _highestExcluding(uint16 mask, uint8 e1, uint8 e2, uint8 e3, uint8 e4, uint8 e5)
        private
        pure
        returns (uint8)
    {
        for (int256 r = 12; r >= 0; --r) {
            uint8 rr = uint8(uint256(r));
            if (rr == e1 || rr == e2 || rr == e3 || rr == e4 || rr == e5) continue;
            if (mask & uint16(1 << uint256(r)) != 0) return rr;
        }
        return 255;
    }
}
