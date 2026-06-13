// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDealer} from "../interfaces/IDealer.sol";

/// @notice v1 poker dealer: commit-reveal with a slashable bond. The dealer
///         service shuffles a deck offchain, commits keccak(deck ‖ salt) before
///         the hand, and reveals the full deck at hand end. Every dealt card is
///         checked against the committed deck on reveal; any mismatch is
///         provable and slashes the bond, which MUST exceed the table's max
///         buy-in. The dealer can still PEEK during a hand (the trust gap that
///         the zk dealer closes), but it cannot RIG without being caught.
///
///         Ships first because it is simple and lets heads-up tables go live
///         while the zk circuits are built and audited.
contract BondedDealer is IDealer {
    address public immutable operator;
    address public immutable table; // the only caller allowed to drive hands
    uint256 public bond;

    struct Hand {
        bytes32 deckCommit; // keccak(deck[52] ‖ salt)
        bytes32 salt;
        uint8[52] deck; // filled on reveal
        bool revealed;
        uint64 startedAt;
        uint8 dealtCursor; // next free deck index to assign
        mapping(uint8 => bool) assigned;
    }

    uint256 public nextHand = 1;
    mapping(uint256 => Hand) internal _hands;
    uint64 public constant REVEAL_WINDOW = 5 minutes;

    event Committed(uint256 indexed handId, bytes32 commit);
    event Dealt(uint256 indexed handId, uint8 seatIdx, uint8[] deckIndices);
    event Revealed(uint256 indexed handId);
    event Slashed(uint256 indexed handId, uint256 amount);

    modifier onlyTable() {
        require(msg.sender == table, "only table");
        _;
    }

    constructor(address operator_, address table_) payable {
        operator = operator_;
        table = table_;
        bond = msg.value;
    }

    function topUpBond() external payable {
        bond += msg.value;
    }

    /// @notice Operator commits the shuffled deck hash for the next hand. Called
    ///         by the operator immediately before the table starts the hand.
    function commitDeck(bytes32 deckCommit) external returns (uint256 handId) {
        require(msg.sender == operator, "only operator");
        handId = nextHand++;
        Hand storage h = _hands[handId];
        h.deckCommit = deckCommit;
        h.startedAt = uint64(block.timestamp);
        emit Committed(handId, deckCommit);
    }

    // ── IDealer ─────────────────────────────────────────────────────────
    function startHand(uint256, address[] calldata) external view onlyTable returns (uint256) {
        // The operator pre-commits via commitDeck; the table references the
        // latest committed hand. Here we return the most recent committed id.
        return nextHand - 1;
    }

    function deal(uint256 handId, uint8 seatIdx, uint8 count)
        external
        onlyTable
        returns (uint8[] memory deckIndices)
    {
        Hand storage h = _hands[handId];
        require(h.deckCommit != bytes32(0), "no commit");
        deckIndices = new uint8[](count);
        for (uint8 i; i < count; ++i) {
            uint8 idx = h.dealtCursor++;
            h.assigned[idx] = true;
            deckIndices[i] = idx;
        }
        emit Dealt(handId, seatIdx, deckIndices);
    }

    /// @notice Operator reveals the full deck + salt at hand end. Verified
    ///         against the commitment; the table then reads cards via reveal().
    function revealDeck(uint256 handId, uint8[52] calldata deck, bytes32 salt) external {
        require(msg.sender == operator, "only operator");
        Hand storage h = _hands[handId];
        require(!h.revealed, "done");
        require(keccak256(abi.encodePacked(deck, salt)) == h.deckCommit, "commit mismatch");
        // sanity: a real permutation of 0..51
        bool[52] memory seen;
        for (uint256 i; i < 52; ++i) {
            require(!seen[deck[i]], "dup card");
            seen[deck[i]] = true;
            h.deck[i] = deck[i];
        }
        h.salt = salt;
        h.revealed = true;
        emit Revealed(handId);
    }

    function reveal(uint256 handId, uint8[] calldata deckIndices)
        external
        view
        onlyTable
        returns (uint8[] memory cards)
    {
        Hand storage h = _hands[handId];
        require(h.revealed, "not revealed");
        cards = new uint8[](deckIndices.length);
        for (uint256 i; i < deckIndices.length; ++i) {
            require(h.assigned[deckIndices[i]], "not dealt");
            cards[i] = h.deck[deckIndices[i]];
        }
    }

    function handResolvable(uint256 handId) external view returns (bool) {
        return _hands[handId].revealed;
    }

    function faulted(uint256 handId) external view returns (bool, uint256) {
        Hand storage h = _hands[handId];
        bool late = !h.revealed && block.timestamp > h.startedAt + REVEAL_WINDOW;
        return (late, late ? bond : 0);
    }

    /// @notice Anyone can slash a dealer that missed its reveal window; the bond
    ///         goes to the table to refund players whose hand was voided.
    function slash(uint256 handId) external {
        Hand storage h = _hands[handId];
        require(!h.revealed, "revealed");
        require(block.timestamp > h.startedAt + REVEAL_WINDOW, "in window");
        uint256 amt = bond;
        bond = 0;
        (bool ok,) = table.call{value: amt}("");
        require(ok, "send failed");
        emit Slashed(handId, amt);
    }
}
