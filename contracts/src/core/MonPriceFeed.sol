// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Bot-pushed MON price feed for the Up/Down market.
///
///         WHY A BOT, NOT A DEX ORACLE: a two-block TWAP refreshes far too
///         slowly for a 5-minute up/down game — the "line" and the "close"
///         would barely move, and players could see the TWAP lag. Instead an
///         authorized off-chain price bot pushes the live MON/USD price every
///         block (or faster), so the contract always has a fresh number to
///         anchor the line and settle the round.
///
///         TRUST MODEL: the bot is trusted ONLY for the price number, nothing
///         else. It cannot touch funds, cannot pick winners, cannot change the
///         rules — it only writes `price`. The contract records the exact price
///         + block used for every round so any settlement is publicly auditable
///         and disputable. Use multiple independent pushers + median for
///         production hardening (see `setPusher`).
contract MonPriceFeed is Ownable {
    struct Observation {
        uint192 price; // MON price, 1e18-scaled (e.g. USD per MON)
        uint64 updatedAt; // block.timestamp of the push
    }

    Observation public latest;
    mapping(address => bool) public isPusher;
    uint64 public maxStaleness = 30; // seconds; reads revert if older

    event Pushed(uint192 price, uint64 at, address indexed pusher);
    event PusherSet(address indexed pusher, bool allowed);

    constructor(address owner_, address pusher_) Ownable(owner_) {
        isPusher[pusher_] = true;
        emit PusherSet(pusher_, true);
    }

    modifier onlyPusher() {
        require(isPusher[msg.sender], "not a pusher");
        _;
    }

    /// @notice Bot writes the current MON price. Cheap — meant to be called
    ///         every block.
    function push(uint192 price) external onlyPusher {
        require(price > 0, "zero price");
        latest = Observation({price: price, updatedAt: uint64(block.timestamp)});
        emit Pushed(price, uint64(block.timestamp), msg.sender);
    }

    /// @notice Fresh price for anchoring/settling a round. Reverts if the bot
    ///         has gone stale, so a dead bot can never settle a round on an old
    ///         number — the round simply waits (and can be voided + refunded by
    ///         the game if staleness persists).
    function freshPrice() external view returns (uint192 price, uint64 at) {
        Observation memory o = latest;
        require(o.price > 0, "no price");
        require(block.timestamp <= o.updatedAt + maxStaleness, "stale");
        return (o.price, o.updatedAt);
    }

    function isFresh() external view returns (bool) {
        Observation memory o = latest;
        return o.price > 0 && block.timestamp <= o.updatedAt + maxStaleness;
    }

    function setPusher(address pusher, bool allowed) external onlyOwner {
        isPusher[pusher] = allowed;
        emit PusherSet(pusher, allowed);
    }

    function setMaxStaleness(uint64 secs) external onlyOwner {
        require(secs > 0, "zero");
        maxStaleness = secs;
    }
}
