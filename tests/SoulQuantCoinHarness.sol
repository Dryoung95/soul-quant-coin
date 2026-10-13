// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SoulQuantCoin} from "../contracts/SoulQuantCoin.sol";

/// @dev Test-only state setters; never compile this harness into deployment artifacts.
contract SoulQuantCoinHarness is SoulQuantCoin {
    constructor(uint256 bits, uint256 intervalSeconds) SoulQuantCoin(bits, intervalSeconds) {}

    function setMiningRound(uint256 round) external {
        miningRound = round;
    }

    function seedSupply(address receiver, uint256 amount) external {
        _mint(receiver, amount);
    }
}
