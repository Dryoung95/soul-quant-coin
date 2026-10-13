import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider, isAddress } from 'ethers';
import { compile, root } from './compile.mjs';

export const publicRpc = 'https://ethereum-sepolia-rpc.publicnode.com';
const faucetUrl = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';
export async function exportPublic() {
  const docs = path.join(root, 'docs');
  const deploymentPath = path.join(root, 'deployments/sepolia.json');
  let deployment = null;
  try { deployment = JSON.parse(await fs.readFile(deploymentPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const artifact = compile();
  if (deployment) {
    if (deployment.chainId !== 11155111 || !isAddress(deployment.address)) throw new Error('公开部署记录不是有效的 Sepolia 合约。');
    const provider = new JsonRpcProvider(publicRpc);
    try {
      const network = await provider.getNetwork();
      const code = await provider.getCode(deployment.address);
      if (network.chainId !== 11155111n || code === '0x') throw new Error('Sepolia 尚无记录中的合约代码，不能导出已部署页面。');
    } finally { provider.destroy(); }
  }
  let deployerAddress = deployment?.deployer || null;
  if (!deployerAddress) {
    try {
      const publicRecord = JSON.parse(await fs.readFile(path.join(root, 'runtime/deployer-public.json'), 'utf8'));
      if (isAddress(publicRecord.address)) deployerAddress = publicRecord.address;
    } catch {}
  }
  const config = {
    publicTestnet: true, deploymentPending: !deployment,
    chainId: 11155111, networkName: 'Sepolia', name: 'Soul Quant Coin', symbol: 'SQC',
    address: deployment?.address || null, abi: deployment?.abi || artifact.abi,
    rpcUrl: publicRpc, profile: deployment?.profile || 'public-demo',
    miningInterval: deployment?.minimumInterval || 60, difficultyBits: deployment?.difficultyBits || 12,
    deploymentBlock: deployment?.deploymentBlock ?? null, deployedAt: deployment?.deployedAt || null,
    deployerAddress, faucetUrl, explorerUrl: 'https://sepolia.etherscan.io',
    exportedAt: new Date().toISOString()
  };
  await fs.mkdir(path.join(docs, 'api'), { recursive: true });
  await fs.mkdir(path.join(docs, 'vendor'), { recursive: true });
  // An explicit file list prevents private files, logs, and node_modules entering the public site.
  for (const filename of ['index.html', 'style.css', 'app.js', 'icon.svg']) {
    await fs.copyFile(path.join(root, 'web', filename), path.join(docs, filename));
  }
  await fs.copyFile(path.join(root, 'node_modules/ethers/dist/ethers.umd.min.js'), path.join(docs, 'vendor/ethers.js'));
  await fs.writeFile(path.join(docs, 'api/config.json'), JSON.stringify(config, null, 2));
  await fs.writeFile(path.join(docs, '.nojekyll'), '');
  console.log(`公开网页已导出到 docs/，状态：${deployment ? 'Sepolia 已部署' : '等待 Sepolia 部署'}。`);
  return config;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  exportPublic().catch(() => { console.error('公开导出未完成。请检查编译及 Sepolia 部署记录。'); process.exitCode = 1; });
}
