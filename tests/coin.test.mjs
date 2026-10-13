import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import { ContractFactory, MaxUint256 } from 'ethers';
import { compile, root } from '../scripts/compile.mjs';
import { deploy, startChain } from '../scripts/chain.mjs';
import { digestFor, findProof } from '../scripts/proof.mjs';

const UNIT = 10n ** 8n;
const REWARD = 50n * UNIT;
const CAP = 21_000_000n * UNIT;
const HALVING = 210_000n;
const PORT = 18545;
const GAS_LIMIT = 500_000;

let child, provider, coin, harness, artifact, snapshot;
let owner, other, spender, ownerAddress, otherAddress, spenderAddress;

function compileHarness() {
  const input = {
    language: 'Solidity',
    sources: {
      'tests/SoulQuantCoinHarness.sol': { content: fs.readFileSync(path.join(root, 'tests/SoulQuantCoinHarness.sol'), 'utf8') },
      'contracts/SoulQuantCoin.sol': { content: fs.readFileSync(path.join(root, 'contracts/SoulQuantCoin.sol'), 'utf8') }
    },
    settings: {
      optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
    }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), {
    import: name => {
      const resolved = path.resolve(root, 'node_modules', name);
      if (!resolved.startsWith(path.join(root, 'node_modules') + path.sep)) return { error: 'Invalid import' };
      try { return { contents: fs.readFileSync(resolved, 'utf8') }; }
      catch { return { error: `Import not found: ${name}` }; }
    }
  }));
  assert.deepEqual((output.errors || []).filter(item => item.severity === 'error'), []);
  const built = output.contracts['tests/SoulQuantCoinHarness.sol'].SoulQuantCoinHarness;
  return { abi: built.abi, bytecode: `0x${built.evm.bytecode.object}` };
}

before(async () => {
  artifact = compile();
  const harnessArtifact = compileHarness();
  ({ child, provider } = await startChain(PORT));
  [owner, other, spender] = await Promise.all([0, 1, 2].map(index => provider.getSigner(index)));
  [ownerAddress, otherAddress, spenderAddress] = await Promise.all([owner, other, spender].map(signer => signer.getAddress()));
  coin = await deploy(provider, artifact, 4, 10);
  harness = await deploy(provider, harnessArtifact, 4, 10);
});

beforeEach(async () => { snapshot = await provider.send('evm_snapshot', []); });
afterEach(async () => {
  if (snapshot !== undefined) assert.equal(await provider.send('evm_revert', [snapshot]), true);
});

after(async () => {
  provider?.destroy();
  if (!child || child.exitCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 5_000);
    timer.unref();
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill();
  });
});

async function state(contract = coin) {
  const values = await Promise.all([
    contract.totalSupply(), contract.miningRound(), contract.challenge(), contract.nextMiningAt(),
    contract.balanceOf(ownerAddress), contract.balanceOf(otherAddress),
    contract.allowance(ownerAddress, spenderAddress)
  ]);
  return values;
}

function isCustomError(contract, name, error) {
  const candidates = [error.data, error.info?.error?.data, error.info?.error?.data?.data, error.error?.data];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    try { if (contract.interface.parseError(candidate)?.name === name) return true; }
    catch { /* Some RPC errors omit ABI data; inspect the message below. */ }
  }
  return String(error.message).includes(name);
}

async function expectAtomicRevert(contract, method, args, errorName) {
  const beforeState = await state(contract);
  await assert.rejects(() => contract[method].staticCall(...args), error => isCustomError(contract, errorName, error));
  await assert.rejects(async () => {
    const transaction = await contract[method](...args, { gasLimit: GAS_LIMIT });
    await transaction.wait();
  }, /revert|CALL_EXCEPTION/i);
  assert.deepEqual(await state(contract), beforeState);
}

async function mine(contract = coin, signer = owner) {
  const address = await signer.getAddress();
  const proof = await findProof(contract, address);
  const receipt = await (await contract.connect(signer).mine(proof.round, proof.nonce)).wait();
  return { proof, receipt };
}

async function advance(seconds = 10) {
  await provider.send('evm_increaseTime', [seconds]);
  await provider.send('evm_mine', []);
}

async function selectNonce(contract, matches) {
  const [address, round, challenge, target] = await Promise.all([
    contract.getAddress(), contract.miningRound(), contract.challenge(), contract.miningTarget()
  ]);
  for (let nonce = 0n; ; nonce++) {
    const forMiner = miner => BigInt(digestFor(31337, address, round, challenge, miner, nonce));
    if (matches(forMiner, target)) return { round, nonce };
  }
}

test('deployment starts with zero supply, eight decimals, and fixed issuance parameters', async () => {
  assert.equal(await coin.name(), 'Soul Quant Coin');
  assert.equal(await coin.symbol(), 'SQC');
  assert.equal(await coin.decimals(), 8n);
  assert.equal(await coin.totalSupply(), 0n);
  assert.equal(await coin.balanceOf(ownerAddress), 0n);
  assert.equal(await coin.balanceOf(otherAddress), 0n);
  assert.equal(await coin.MAX_SUPPLY(), CAP);
  assert.equal(await coin.INITIAL_REWARD(), REWARD);
  assert.equal(await coin.HALVING_INTERVAL(), HALVING);
  assert.equal(await coin.miningRound(), 0n);
  assert.equal(await coin.currentReward(), REWARD);
  assert.equal(await coin.minimumInterval(), 10n);
  assert.equal(await coin.miningTarget(), MaxUint256 >> 4n);
  assert.notEqual(await coin.challenge(), `0x${'0'.repeat(64)}`);
});

test('constructor rejects zero or excessive difficulty and zero interval', async () => {
  for (const [bits, interval] of [[0, 10], [65, 10], [4, 0]]) {
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, owner);
    await assert.rejects(() => factory.deploy(bits, interval), error => isCustomError(coin, 'InvalidParameters', error));
  }
  for (const bits of [1, 64]) {
    const candidate = await deploy(provider, artifact, bits, 1);
    assert.equal(await candidate.miningTarget(), MaxUint256 >> BigInt(bits));
  }
});

test('rewards halve exactly at round boundaries and become zero permanently', async () => {
  assert.equal(await coin.rewardAt(209_999), REWARD);
  assert.equal(await coin.rewardAt(210_000), REWARD / 2n);
  assert.equal(await coin.rewardAt(419_999), REWARD / 2n);
  assert.equal(await coin.rewardAt(420_000), REWARD / 4n);
  for (let era = 0n; era <= 33n; era++) {
    assert.equal(await coin.rewardAt(era * HALVING), REWARD >> era);
    assert.equal(await coin.rewardAt((era + 1n) * HALVING - 1n), REWARD >> era);
  }
  assert.equal(await coin.rewardAt(32n * HALVING), 1n);
  assert.equal(await coin.rewardAt(33n * HALVING), 0n);
  assert.equal(await coin.rewardAt(256n * HALVING), 0n);
  assert.equal(await coin.rewardAt(MaxUint256), 0n);
});

test('successful mining credits its sender and advances the round, challenge, and cooldown', async () => {
  const priorChallenge = await coin.challenge();
  const { proof, receipt } = await mine(coin, other);
  assert.equal(receipt.status, 1);
  assert.equal(await coin.totalSupply(), REWARD);
  assert.equal(await coin.balanceOf(otherAddress), REWARD);
  assert.equal(await coin.balanceOf(ownerAddress), 0n);
  assert.equal(await coin.miningRound(), 1n);
  assert.notEqual(await coin.challenge(), priorChallenge);
  const block = await provider.getBlock(receipt.blockNumber);
  assert.equal(await coin.nextMiningAt(), BigInt(block.timestamp) + 10n);
  const event = receipt.logs.map(log => { try { return coin.interface.parseLog(log); } catch { return null; } })
    .find(log => log?.name === 'Mined');
  assert.ok(event);
  assert.equal(event.args.miner, otherAddress);
  assert.equal(event.args.round, 0n);
  assert.equal(event.args.reward, REWARD);
  assert.equal(event.args.nonce, proof.nonce);
  assert.equal(event.args.digest, proof.digest);
  assert.ok(BigInt(proof.digest) <= await coin.miningTarget());
});

test('invalid proof reverts without changing token or mining state', async () => {
  const proof = await selectNonce(coin, (digest, target) => digest(ownerAddress) > target);
  await expectAtomicRevert(coin, 'mine', [proof.round, proof.nonce], 'InvalidProof');
});

test('a valid proof is bound to its miner account', async () => {
  const proof = await selectNonce(coin, (digest, target) => digest(ownerAddress) <= target && digest(otherAddress) > target);
  await expectAtomicRevert(coin.connect(other), 'mine', [proof.round, proof.nonce], 'InvalidProof');
  await (await coin.mine(proof.round, proof.nonce)).wait();
  assert.equal(await coin.balanceOf(ownerAddress), REWARD);
});

test('proofs for the wrong chain or contract address cannot mine', async () => {
  const [address, round, challenge, target] = await Promise.all([
    coin.getAddress(), coin.miningRound(), coin.challenge(), coin.miningTarget()
  ]);
  for (const [chainId, boundAddress] of [[1, address], [31337, await harness.getAddress()]]) {
    let nonce = 0n;
    while (BigInt(digestFor(chainId, boundAddress, round, challenge, ownerAddress, nonce)) > target
      || BigInt(digestFor(31337, address, round, challenge, ownerAddress, nonce)) <= target) nonce++;
    await expectAtomicRevert(coin, 'mine', [round, nonce], 'InvalidProof');
  }
});

test('replaying a completed round reverts without changing state', async () => {
  const { proof } = await mine();
  await advance();
  await expectAtomicRevert(coin, 'mine', [proof.round, proof.nonce], 'StaleRound');
});

test('a proof with the current round cannot mine during the minimum interval', async () => {
  await mine();
  const proof = await findProof(coin, ownerAddress);
  await expectAtomicRevert(coin, 'mine', [proof.round, proof.nonce], 'MiningTooEarly');
  await advance();
  await (await coin.mine(proof.round, proof.nonce)).wait();
  assert.equal(await coin.totalSupply(), 2n * REWARD);
});

test('transfers move balances without affecting issuance or mining state', async () => {
  await mine();
  const previous = await state();
  const amount = 12n * UNIT + 345n;
  await (await coin.transfer(otherAddress, amount)).wait();
  assert.equal(await coin.balanceOf(ownerAddress), REWARD - amount);
  assert.equal(await coin.balanceOf(otherAddress), amount);
  assert.deepEqual((await state()).slice(0, 4), previous.slice(0, 4));
  await (await coin.connect(other).transfer(ownerAddress, 0)).wait();
  assert.equal(await coin.balanceOf(otherAddress), amount);
});

test('a transfer with insufficient balance reverts atomically', async () => {
  await mine();
  await expectAtomicRevert(coin, 'transfer', [otherAddress, REWARD + 1n], 'ERC20InsufficientBalance');
});

test('approve and transferFrom respect and decrement allowances', async () => {
  await mine();
  const approved = 10n * UNIT;
  const spent = 4n * UNIT;
  await (await coin.approve(spenderAddress, approved)).wait();
  assert.equal(await coin.allowance(ownerAddress, spenderAddress), approved);
  await (await coin.connect(spender).transferFrom(ownerAddress, otherAddress, spent)).wait();
  assert.equal(await coin.balanceOf(ownerAddress), REWARD - spent);
  assert.equal(await coin.balanceOf(otherAddress), spent);
  assert.equal(await coin.allowance(ownerAddress, spenderAddress), approved - spent);
  await expectAtomicRevert(coin.connect(spender), 'transferFrom', [ownerAddress, otherAddress, approved - spent + 1n], 'ERC20InsufficientAllowance');
});

test('transferFrom with enough allowance but insufficient balance is atomic', async () => {
  await (await coin.approve(spenderAddress, UNIT)).wait();
  await expectAtomicRevert(coin.connect(spender), 'transferFrom', [ownerAddress, otherAddress, UNIT], 'ERC20InsufficientBalance');
});

test('mining across the halving boundary uses the old reward then the new reward', async () => {
  await (await harness.setMiningRound(HALVING - 1n)).wait();
  assert.equal(await harness.currentReward(), REWARD);
  await mine(harness);
  assert.equal(await harness.miningRound(), HALVING);
  assert.equal(await harness.currentReward(), REWARD / 2n);
  await advance();
  await mine(harness);
  assert.equal(await harness.totalSupply(), REWARD + REWARD / 2n);
  assert.equal(await harness.balanceOf(ownerAddress), REWARD + REWARD / 2n);
});

test('the supply cap clips the last reward and prevents further mining', async () => {
  await (await harness.seedSupply(otherAddress, CAP - 3n)).wait();
  assert.equal(await harness.currentReward(), 3n);
  const { receipt } = await mine(harness);
  assert.equal(await harness.balanceOf(ownerAddress), 3n);
  assert.equal(await harness.totalSupply(), CAP);
  assert.equal(await harness.currentReward(), 0n);
  const event = receipt.logs.map(log => { try { return harness.interface.parseLog(log); } catch { return null; } })
    .find(log => log?.name === 'Mined');
  assert.equal(event.args.reward, 3n);
  await expectAtomicRevert(harness, 'mine', [1n, 0n], 'MiningEnded');
});

test('the last atomic-unit reward is mineable and the next era permanently ends issuance', async () => {
  await (await harness.setMiningRound(33n * HALVING - 1n)).wait();
  assert.equal(await harness.currentReward(), 1n);
  await mine(harness);
  assert.equal(await harness.totalSupply(), 1n);
  assert.equal(await harness.currentReward(), 0n);
  await expectAtomicRevert(harness, 'mine', [33n * HALVING, 0n], 'MiningEnded');
});
