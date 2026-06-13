// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IGame} from "../interfaces/IGame.sol";

/// @notice Governance-controlled list of authorized game modules. The Vault and
///         PositionNFT trust calls only from registered games. Adding a game is
///         a registry write — the core never redeploys. This is what lets us
///         ship a new game every week.
contract GameRegistry is Ownable {
    mapping(address => bool) public isGame;
    mapping(bytes32 => address) public gameById;
    address[] public games;

    event GameAdded(bytes32 indexed id, address indexed game);
    event GameRemoved(bytes32 indexed id, address indexed game);

    constructor(address owner_) Ownable(owner_) {}

    function addGame(address game) external onlyOwner {
        require(!isGame[game], "exists");
        bytes32 id = IGame(game).gameId();
        require(gameById[id] == address(0), "id taken");
        isGame[game] = true;
        gameById[id] = game;
        games.push(game);
        emit GameAdded(id, game);
    }

    /// @dev Removing a game stops NEW rounds. In-flight rounds still settle and
    ///      claim because the Vault keys settlement to the specific module that
    ///      created the round (see Vault) — but to be safe, only disable a game
    ///      after its open rounds have drained.
    function removeGame(address game) external onlyOwner {
        require(isGame[game], "unknown");
        bytes32 id = IGame(game).gameId();
        isGame[game] = false;
        delete gameById[id];
        emit GameRemoved(id, game);
    }

    function allGames() external view returns (address[] memory) {
        return games;
    }
}
