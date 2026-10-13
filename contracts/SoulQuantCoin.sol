// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Educational ERC-20. Proof of work controls issuance, not network consensus.
contract SoulQuantCoin is ERC20 {
    uint256 public constant MAX_SUPPLY = 21_000_000 * 10 ** 8;
    uint256 public constant INITIAL_REWARD = 50 * 10 ** 8;
    uint256 public constant HALVING_INTERVAL = 210_000;

    uint256 public immutable difficultyBits;
    uint256 public immutable minimumInterval;
    uint256 public miningRound;
    bytes32 public challenge;
    uint256 public nextMiningAt;

    error InvalidParameters();
    error StaleRound(uint256 expected, uint256 actual);
    error MiningTooEarly(uint256 availableAt);
    error InvalidProof();
    error MiningEnded();

    event Mined(address indexed miner, uint256 indexed round, uint256 reward, uint256 nonce, bytes32 digest);

    constructor(uint256 bits, uint256 intervalSeconds) ERC20("Soul Quant Coin", "SQC") {
        if (bits == 0 || bits > 64 || intervalSeconds == 0) revert InvalidParameters();
        difficultyBits = bits;
        minimumInterval = intervalSeconds;
        challenge = keccak256(abi.encode(block.chainid, address(this), block.prevrandao, block.timestamp));
        nextMiningAt = block.timestamp;
    }

    function decimals() public pure override returns (uint8) { return 8; }

    function miningTarget() public view returns (uint256) {
        return type(uint256).max >> difficultyBits;
    }

    function rewardAt(uint256 round) public pure returns (uint256) {
        uint256 halvings = round / HALVING_INTERVAL;
        return halvings >= 256 ? 0 : INITIAL_REWARD >> halvings;
    }

    function currentReward() public view returns (uint256) {
        uint256 remaining = MAX_SUPPLY - totalSupply();
        uint256 reward = rewardAt(miningRound);
        return reward < remaining ? reward : remaining;
    }

    function mine(uint256 expectedRound, uint256 nonce) external {
        if (expectedRound != miningRound) revert StaleRound(expectedRound, miningRound);
        uint256 reward = currentReward();
        if (reward == 0) revert MiningEnded();
        if (block.timestamp < nextMiningAt) revert MiningTooEarly(nextMiningAt);

        bytes32 digest = keccak256(abi.encodePacked(
            uint256(block.chainid), address(this), miningRound, challenge, msg.sender, nonce
        ));
        if (uint256(digest) > miningTarget()) revert InvalidProof();

        uint256 completedRound = miningRound;
        miningRound = completedRound + 1;
        nextMiningAt = block.timestamp + minimumInterval;
        challenge = keccak256(abi.encode(challenge, digest, miningRound, block.prevrandao));
        _mint(msg.sender, reward);
        emit Mined(msg.sender, completedRound, reward, nonce, digest);
    }
}
