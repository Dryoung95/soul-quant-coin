import { solidityPackedKeccak256 } from 'ethers';

export function digestFor(chainId, address, round, challenge, miner, nonce) {
  return solidityPackedKeccak256(['uint256', 'address', 'uint256', 'bytes32', 'address', 'uint256'], [chainId, address, round, challenge, miner, nonce]);
}

export async function findProof(contract, miner, chainId = 31337) {
  const [address, round, challenge, target] = await Promise.all([
    contract.getAddress(), contract.miningRound(), contract.challenge(), contract.miningTarget()
  ]);
  for (let nonce = 0n; ; nonce++) {
    const digest = digestFor(chainId, address, round, challenge, miner, nonce);
    if (BigInt(digest) <= target) return { round, nonce, digest };
    if (nonce % 1024n === 0n) await new Promise(resolve => setImmediate(resolve));
  }
}
