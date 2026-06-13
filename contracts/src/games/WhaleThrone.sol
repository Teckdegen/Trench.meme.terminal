// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IGame} from "../interfaces/IGame.sol";
import {IVault} from "../interfaces/IVault.sol";
import {IPositionNFT} from "../interfaces/IPositionNFT.sol";

/// @notice Whale Throne (King of the Hill). A round runs for a fixed block
///         window. Anyone can `seize{value}` the throne by paying the current
///         price (which steps up with each takeover); their MON goes into the
///         pot and they become the whale on top. Every takeover EXTENDS the
///         window slightly (anti-snipe). When the dust settles, whoever holds
///         the throne takes the ENTIRE pot (minus rake) — funded by every degen
///         they dethroned. Hold the top or fund the winner.
contract WhaleThrone is IGame, ReentrancyGuard {
    IVault public immutable vault;
    IPositionNFT public immutable tickets;

    uint16 public constant RAKE_BPS = 1000; // 10%
    uint64 public constant WINDOW_BLOCKS = 300; // ~2 min base
    uint64 public constant EXTEND_BLOCKS = 30; // anti-snipe bump per seize
    uint16 public constant STEP_BPS = 2000; // each seize costs 20% more

    enum Phase {
        OPEN,
        SETTLED
    }

    struct Round {
        uint128 price; // current cost to seize
        uint128 pot;
        address king;
        uint256 kingTicket;
        uint64 endBlock;
        Phase phase;
    }

    uint256 public currentRound;
    mapping(uint256 => Round) public rounds;
    uint128 public immutable basePrice;

    event Opened(uint256 indexed id, uint128 basePrice, uint64 endBlock);
    event Seized(uint256 indexed id, address indexed king, uint128 paid, uint128 pot, uint64 endBlock);
    event Crowned(uint256 indexed id, address indexed king, uint256 payout);

    constructor(address vault_, address tickets_, uint128 basePrice_) {
        vault = IVault(vault_);
        tickets = IPositionNFT(tickets_);
        basePrice = basePrice_;
        _open();
    }

    function gameId() public pure returns (bytes32) {
        return "whalethrone";
    }

    function _roundKey(uint256 id) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(gameId(), id));
    }

    function _open() internal {
        uint256 id = ++currentRound;
        Round storage r = rounds[id];
        r.price = basePrice;
        r.endBlock = uint64(block.number) + WINDOW_BLOCKS;
        r.phase = Phase.OPEN;
        emit Opened(id, basePrice, r.endBlock);
    }

    /// @notice Take the throne by paying the current price.
    function seize() external payable nonReentrant {
        _maybeSettle();
        Round storage r = rounds[currentRound];
        require(r.phase == Phase.OPEN, "closed");
        require(block.number < r.endBlock, "window over");
        require(msg.value == r.price, "wrong price");

        // The dethroned king's ticket becomes a dead ticket.
        if (r.king != address(0)) {
            tickets.setStatus(r.kingTicket, IPositionNFT.Status.LOST);
        }

        r.pot += uint128(msg.value);
        r.king = msg.sender;
        // The throne itself is a position NFT held by the current king.
        r.kingTicket = tickets.mint(msg.sender, gameId(), currentRound, 0, uint128(msg.value));
        r.price = uint128((uint256(r.price) * (10_000 + STEP_BPS)) / 10_000);
        r.endBlock = uint64(block.number) + EXTEND_BLOCKS > r.endBlock
            ? uint64(block.number) + EXTEND_BLOCKS
            : r.endBlock;

        vault.deposit{value: msg.value}(_roundKey(currentRound));
        emit Seized(currentRound, msg.sender, uint128(msg.value), r.pot, r.endBlock);
    }

    function poke(uint256) external override nonReentrant {
        _maybeSettle();
    }

    function _maybeSettle() internal {
        Round storage r = rounds[currentRound];
        if (r.phase != Phase.OPEN || block.number < r.endBlock) return;

        if (r.king == address(0)) {
            // Nobody ever seized → nothing to settle, just roll over.
            r.phase = Phase.SETTLED;
        } else {
            uint256 pot = r.pot;
            uint256 rake = (pot * RAKE_BPS) / 10_000;
            address[] memory ws = new address[](1);
            uint256[] memory ams = new uint256[](1);
            ws[0] = r.king;
            ams[0] = pot - rake;
            vault.settle(_roundKey(currentRound), ws, ams, RAKE_BPS);
            tickets.setStatus(r.kingTicket, IPositionNFT.Status.WON);
            r.phase = Phase.SETTLED;
            emit Crowned(currentRound, r.king, pot - rake);
        }
        _open();
    }

    function claimTicket(uint256 tokenId) external nonReentrant {
        IPositionNFT.Ticket memory tk = tickets.ticket(tokenId);
        require(tk.status == IPositionNFT.Status.WON, "not won");
        tickets.setStatus(tokenId, IPositionNFT.Status.CLAIMED);
        tickets.burn(tokenId);
    }
}
