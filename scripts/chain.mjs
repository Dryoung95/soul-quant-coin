import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { JsonRpcProvider, ContractFactory } from 'ethers';
import { root } from './compile.mjs';

export async function requireFreePort(port) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error(`端口 ${port} 已占用。请关闭已有实验室，或修改启动端口。`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

export async function startChain(port = 8545, logfile) {
  await requireFreePort(port);
  const child = spawn(process.execPath, [path.join(root, 'node_modules/hardhat/dist/src/cli.js'), 'node', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  let recentOutput = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    recentOutput = (recentOutput + chunk.toString()).slice(-2500);
    if (logfile) logfile.write(chunk);
  });
  const provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, 31337, { staticNetwork: true });
  provider.pollingInterval = 200;
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error(`测试链启动失败：${recentOutput}`);
      try {
        const id = await provider.send('eth_chainId', []);
        if (id !== '0x7a69') throw new Error('Unexpected chain ID');
        return { child, provider };
      } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    throw new Error(`等待测试链超时：${recentOutput}`);
  } catch (error) { child.kill(); provider.destroy(); throw error; }
}

export async function deploy(provider, artifact, bits = 12, interval = 10) {
  const signer = await provider.getSigner(0);
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(bits, interval);
  await contract.waitForDeployment();
  return contract;
}
