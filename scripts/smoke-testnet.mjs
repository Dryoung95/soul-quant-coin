import fs from 'node:fs';
import path from 'node:path';
import { Contract, JsonRpcProvider, Wallet, NonceManager, parseUnits, formatUnits } from 'ethers';
import { root } from './compile.mjs';
import { findProof } from './proof.mjs';

async function main() {
  const keyFile = process.env.DEPLOYER_KEY_FILE;
  if (!keyFile) throw new Error('请设置 DEPLOYER_KEY_FILE，脚本仅操作 Sepolia 测试资产。');
  const deployment = JSON.parse(fs.readFileSync(path.join(root, 'deployments/sepolia.json'), 'utf8'));
  const provider = new JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
  try {
    if ((await provider.getNetwork()).chainId !== 11155111n || deployment.chainId !== 11155111) throw new Error('仅允许 Sepolia。');
    const wallet = new Wallet(fs.readFileSync(path.resolve(keyFile), 'utf8').trim(), provider);
    const signer = new NonceManager(wallet);
    const coin = new Contract(deployment.address, deployment.abi, signer);
    const proof = await findProof(coin, wallet.address, 11155111);
    const nextAt = await coin.nextMiningAt();
    const block = await provider.getBlock('latest');
    if (BigInt(block.timestamp) < nextAt) throw new Error('申领间隔尚未结束，稍后再运行。');
    const miningTx = await coin.mine(proof.round, proof.nonce);
    console.log(`挖矿申领交易：${miningTx.hash}`);
    const miningReceipt = await miningTx.wait();
    if (miningReceipt.status !== 1) throw new Error('挖矿交易失败。');

    // A fresh recipient never uses publicly known Hardhat development keys on a public chain.
    const recipientKey = path.join(path.dirname(path.resolve(keyFile)), 'sepolia-recipient.key');
    let recipient;
    if (fs.existsSync(recipientKey)) recipient = new Wallet(fs.readFileSync(recipientKey, 'utf8').trim());
    else {
      recipient = Wallet.createRandom();
      fs.writeFileSync(recipientKey, recipient.privateKey, { flag: 'wx' });
    }
    const amount = parseUnits('1.23456789', 8);
    const supplyBefore = await coin.totalSupply();
    const transferTx = await coin.transfer(recipient.address, amount);
    console.log(`转账交易：${transferTx.hash}`);
    const transferReceipt = await transferTx.wait();
    if (transferReceipt.status !== 1) throw new Error('转账交易失败。');
    const [name, symbol, senderBalance, recipientBalance, supplyAfter] = await Promise.all([
      coin.name(), coin.symbol(), coin.balanceOf(wallet.address), coin.balanceOf(recipient.address), coin.totalSupply()
    ]);
    if (supplyBefore !== supplyAfter || recipientBalance < amount || name !== 'Soul Quant Coin' || symbol !== 'SQC') throw new Error('链上验证失败。');
    const result = {
      chainId: 11155111, contract: deployment.address, name, symbol,
      sender: wallet.address, recipient: recipient.address, amount: formatUnits(amount, 8),
      senderBalance: formatUnits(senderBalance, 8), recipientBalance: formatUnits(recipientBalance, 8),
      totalSupply: formatUnits(supplyAfter, 8), miningTransaction: miningTx.hash,
      transferTransaction: transferTx.hash, verifiedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(root, 'deployments/sepolia-smoke.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { provider.destroy(); }
}
main().catch(() => { console.error('Sepolia 验证未完成。请查看已输出的交易状态或稍后重试；密钥未输出。'); process.exitCode = 1; });
