import fs from 'node:fs';
import path from 'node:path';
import { compile, root } from './compile.mjs';
import { startChain, deploy, requireFreePort } from './chain.mjs';
import { createServer } from './server.mjs';

let child, provider, server, log;
const runtimePath = path.join(root, 'runtime');
fs.mkdirSync(runtimePath, { recursive: true });
async function shutdown() {
  if (server) server.close();
  provider?.destroy();
  child?.kill();
  log?.end();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await shutdown(); process.exit(0); });
process.on('exit', () => child?.kill());
try {
  await requireFreePort(8787);
  await requireFreePort(8545);
  log = fs.createWriteStream(path.join(runtimePath, 'chain.log'), { flags: 'w' });
  const artifact = compile();
  ({ child, provider } = await startChain(8545, log));
  const profile = process.argv.includes('--bitcoin-paced') ? 'bitcoin-paced' : 'local-fast';
  const miningInterval = profile === 'bitcoin-paced' ? 600 : 10;
  const difficultyBits = profile === 'bitcoin-paced' ? 24 : 12;
  const contract = await deploy(provider, artifact, difficultyBits, miningInterval);
  const config = {
    chainId: 31337, rpcUrl: 'http://127.0.0.1:8545', name: 'Soul Quant Coin', symbol: 'SQC',
    address: await contract.getAddress(), abi: artifact.abi, profile, miningInterval, difficultyBits
  };
  fs.writeFileSync(path.join(runtimePath, 'config.json'), JSON.stringify(config, null, 2));
  fs.writeFileSync(path.join(runtimePath, 'process.json'), JSON.stringify({
    appPid: process.pid, chainPid: child.pid,
    processCreatedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    startedAt: new Date().toISOString()
  }, null, 2));
  server = await createServer(config);
  child.once('exit', async code => {
    console.error(`测试链已结束（${code}），实验室服务停止。`);
    await shutdown(); process.exit(1);
  });
  console.log(`Soul Quant Coin实验室已启动\n钱包： http://127.0.0.1:8787\nRPC： http://127.0.0.1:8545\n合约： ${config.address}\n配置： ${profile}，${miningInterval}秒间隔，${difficultyBits} bits\n仅本地测试。重启会清空本地链。按 Ctrl+C 停止。`);
} catch (error) {
  console.error(error.message);
  await shutdown(); process.exit(1);
}
