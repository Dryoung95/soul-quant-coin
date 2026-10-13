import fs from 'node:fs';
import path from 'node:path';
import { JsonRpcProvider, Wallet, ContractFactory, parseEther, formatEther, isAddress } from 'ethers';
import { compile, root } from './compile.mjs';
import { exportPublic } from './export-public.mjs';

// Explicitly invoked by the user; no mainnet fallback and no key in arguments or logs.
async function main() {
  const url = process.env.SEPOLIA_RPC_URL;
  const keyFile = process.env.DEPLOYER_KEY_FILE;
  if (!url || !keyFile) throw new Error('请配置 SEPOLIA_RPC_URL 和 DEPLOYER_KEY_FILE（只含测试钱包私钥的本机文件）。');
  const key = fs.readFileSync(path.resolve(keyFile), 'utf8').trim();
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key)) throw new Error('测试钱包密钥文件格式无效。');
  const provider = new JsonRpcProvider(url);
  try {
    const network = await provider.getNetwork();
    if (network.chainId !== 11155111n) throw new Error('仅允许 Sepolia 测试网（chainId 11155111）。');
    const recordPath = path.join(root, 'deployments/sepolia.json');
    if (fs.existsSync(recordPath) && process.env.SQC_REDEPLOY !== 'true') {
      const existing = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
      if (existing.chainId !== 11155111 || !isAddress(existing.address) || await provider.getCode(existing.address) === '0x') {
        throw new Error('测试网部署记录无效，请核对后再重试。');
      }
      console.log(`已有 Sepolia 合约 ${existing.address}，保留该实例并更新公开页面。`);
      await exportPublic();
      return;
    }
    const wallet = new Wallet(key, provider);
    const balance = await provider.getBalance(wallet.address);
    if (balance === 0n) throw new Error('测试钱包缺少 Sepolia ETH，无法支付测试网部署费。');
    const artifact = compile();
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
    const profile = process.env.SEPOLIA_PROFILE || 'public-demo';
    if (!['public-demo', 'bitcoin-paced'].includes(profile)) throw new Error('测试网配置仅允许 public-demo 或 bitcoin-paced。');
    const bits = profile === 'bitcoin-paced' ? 24 : 12;
    const interval = profile === 'bitcoin-paced' ? 600 : 60;
    const txRequest = await factory.getDeployTransaction(bits, interval);
    const gas = await provider.estimateGas({ ...txRequest, from: wallet.address });
    const fees = await provider.getFeeData();
    const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
    if (!maxFeePerGas) throw new Error('无法获取测试网费率。');
    const gasLimit = gas * 120n / 100n;
    const feeCeiling = gasLimit * maxFeePerGas;
    const budget = parseEther(process.env.SEPOLIA_MAX_FEE_ETH || '0.02');
    if (feeCeiling > budget || feeCeiling > balance) throw new Error('测试网费率超过设定预算或钱包余额，尚未发送交易。');
    console.log(`Sepolia 测试部署，钱包 ${wallet.address}，估算费率上限 ${formatEther(feeCeiling)} 测试 ETH。`);
    const contract = await factory.deploy(bits, interval, {
      gasLimit, maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n
    });
    await contract.waitForDeployment();
    const receipt = await contract.deploymentTransaction().wait();
    const record = {
      network: 'sepolia', chainId: 11155111, address: await contract.getAddress(),
      transactionHash: contract.deploymentTransaction().hash, deployer: wallet.address,
      difficultyBits: bits, minimumInterval: interval, profile,
      deploymentBlock: receipt.blockNumber, abi: artifact.abi, deployedAt: new Date().toISOString()
    };
    fs.mkdirSync(path.join(root, 'deployments'), { recursive: true });
    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
    console.log(`已部署测试合约：${record.address}\nhttps://sepolia.etherscan.io/address/${record.address}`);
    try { await exportPublic(); }
    catch { console.error('合约部署已成功，但公开页面导出未完成。请运行 npm run export:public，不必再次部署。'); }
  } finally { provider.destroy(); }
}
main().catch(error => {
  // RPC errors can echo provider URLs or request details. Do not print them.
  const ownMessages = /^(请配置|测试钱包|仅允许|无法获取|测试网)/;
  console.error(ownMessages.test(error.message) ? error.message : '测试网部署未完成。请检查 RPC 连接、钱包测试 ETH 和交易状态；没有输出密钥或 RPC 凭据。');
  process.exitCode = 1;
});
