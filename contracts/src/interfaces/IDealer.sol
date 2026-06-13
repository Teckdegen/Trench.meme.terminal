// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Swappable card-dealing backend for the poker tables. The PokerTable
///         state machine (seats, blinds, betting, side pots, rake) is identical
///         no matter which dealer is plugged in — only HOW cards stay secret
///         differs. This is what makes the bonded-dealer -> zk migration a
///         module swap, not a rewrite.
///
///         Implementations:
///           - BondedDealer  (v1): commit a shuffled deck hash, reveal at end,
///             dealer posts a slashable bond. Weakest trust, ships first.
///           - ZkDealer (prod): encrypted deck + zk shuffle proof + threshold
///             decryption. No party ever learns a card early.
interface IDealer {
    /// @notice Begin a hand at a table. The dealer prepares a fresh deck for
    ///         the given seated players and returns a handId the table uses to
    ///         reference deal/reveal operations.
    function startHand(uint256 tableId, address[] calldata players)
        external
        returns (uint256 handId);

    /// @notice Request that `count` cards be dealt to seat `seatIdx` (hole
    ///         cards) or to the board (seatIdx = type(uint8).max). For zk this
    ///         opens the threshold-decryption window; for bonded it just marks
    ///         positions. Returns the deck indices assigned.
    function deal(uint256 handId, uint8 seatIdx, uint8 count)
        external
        returns (uint8[] memory deckIndices);

    /// @notice Reveal a player's hole cards at showdown (or board cards). For
    ///         zk this completes decryption from posted shares; for bonded it
    ///         checks the revealed deck against the commitment. Reverts if the
    ///         revealed card does not match what was committed/proven.
    /// @return cards 0..51 card codes for the requested deck indices.
    function reveal(uint256 handId, uint8[] calldata deckIndices)
        external
        returns (uint8[] memory cards);

    /// @notice True once every card needed for settlement is revealable.
    function handResolvable(uint256 handId) external view returns (bool);

    /// @notice If the dealer stalled past its window, the table voids the hand
    ///         and may slash. Returns the slashable bond amount (0 if none).
    function faulted(uint256 handId) external view returns (bool, uint256 slashable);
}
