// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {GameRegistry} from "./GameRegistry.sol";
import {IPositionNFT} from "../interfaces/IPositionNFT.sol";

/// @notice Bet tickets as ERC-721 (the Uniswap-V3-position pattern). The NFT IS
///         the bet. Onchain SVG art so a live ticket looks like a casino chip
///         in the wallet. Transferable ONLY while OPEN — that restriction is
///         what makes the live secondary market safe (you can flip a live bet,
///         but a resolved ticket is frozen until it is burned).
contract PositionNFT is ERC721, IPositionNFT {
    using Strings for uint256;

    GameRegistry public immutable registry;
    uint256 public nextId = 1;
    mapping(uint256 => Ticket) private _tickets;

    modifier onlyGame() {
        require(registry.isGame(msg.sender), "not a game");
        _;
    }

    constructor(address registry_) ERC721("trench.meme position", "TRENCH-POS") {
        registry = GameRegistry(registry_);
    }

    function mint(address to, bytes32 gameId_, uint256 roundId, uint64 pick, uint128 stake)
        external
        onlyGame
        returns (uint256 tokenId)
    {
        tokenId = nextId++;
        _tickets[tokenId] = Ticket({
            gameId: gameId_,
            roundId: roundId,
            pick: pick,
            stake: stake,
            mintedAt: uint64(block.timestamp),
            status: Status.OPEN,
            game: msg.sender
        });
        _mint(to, tokenId);
    }

    /// @dev Only the minting game may mutate status, and only forward from OPEN.
    function setStatus(uint256 tokenId, Status status) external {
        Ticket storage t = _tickets[tokenId];
        require(msg.sender == t.game, "not minter");
        require(t.status == Status.OPEN, "not open");
        require(status != Status.OPEN && status != Status.CLAIMED, "bad status");
        t.status = status;
    }

    /// @dev Burnable by: the minting game (settlement/refund paths, sweep burns)
    ///      or by the current owner (early self-burn of a dead ticket). A WON
    ///      ticket can only be burned through the game's claim path, which marks
    ///      it CLAIMED — never by a stranger.
    function burn(uint256 tokenId) external {
        Ticket storage t = _tickets[tokenId];
        require(t.status != Status.OPEN, "still open");
        bool byGame = msg.sender == t.game;
        bool byOwner = msg.sender == _ownerOf(tokenId);
        require(byGame || byOwner, "not allowed");
        // Won tickets must be claimed (which the game marks CLAIMED) before any
        // burn; a random owner cannot burn a winning ticket out from a payout.
        require(t.status != Status.WON || byGame, "claim first");
        _burn(tokenId);
        delete _tickets[tokenId];
    }

    function ticket(uint256 tokenId) external view returns (Ticket memory) {
        return _tickets[tokenId];
    }

    // ── Transfer lock: OPEN tickets only ────────────────────────────────
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        // Allow mint (from==0) and burn (to==0); block transfers of non-OPEN.
        if (from != address(0) && to != address(0)) {
            require(_tickets[tokenId].status == Status.OPEN, "locked");
        }
        return super._update(to, tokenId, auth);
    }

    // ── Onchain SVG ticket art ──────────────────────────────────────────
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        Ticket memory t = _tickets[tokenId];
        require(t.mintedAt != 0, "nonexistent");
        string memory status = _statusStr(t.status);
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="260" viewBox="0 0 420 260">',
            '<rect width="420" height="260" rx="20" fill="#0a0511"/>',
            '<rect x="6" y="6" width="408" height="248" rx="16" fill="none" stroke="#a855f7" stroke-width="2"/>',
            '<text x="28" y="54" fill="#c084fc" font-family="monospace" font-size="14">trench.meme</text>',
            '<text x="28" y="110" fill="#fff" font-family="monospace" font-size="30" font-weight="bold">',
            _bytes32ToString(t.gameId),
            "</text>",
            '<text x="28" y="150" fill="#d6d3d1" font-family="monospace" font-size="16">stake ',
            (uint256(t.stake) / 1e18).toString(),
            " MON</text>",
            '<text x="28" y="178" fill="#9ca3af" font-family="monospace" font-size="14">round #',
            t.roundId.toString(),
            "</text>",
            '<text x="28" y="222" fill="#4ade80" font-family="monospace" font-size="18" font-weight="bold">',
            status,
            "</text>",
            "</svg>"
        );
        string memory json = string.concat(
            '{"name":"trench position #',
            tokenId.toString(),
            '","description":"A trench.meme PvP casino bet ticket.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)),
            '","attributes":[{"trait_type":"game","value":"',
            _bytes32ToString(t.gameId),
            '"},{"trait_type":"status","value":"',
            status,
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _statusStr(Status s) internal pure returns (string memory) {
        if (s == Status.OPEN) return "LIVE";
        if (s == Status.WON) return "WON";
        if (s == Status.LOST) return "LOST";
        if (s == Status.REFUNDED) return "REFUNDED";
        return "CLAIMED";
    }

    function _bytes32ToString(bytes32 b) internal pure returns (string memory) {
        uint256 len;
        while (len < 32 && b[len] != 0) len++;
        bytes memory out = new bytes(len);
        for (uint256 i; i < len; ++i) out[i] = b[i];
        return string(out);
    }
}
