import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function compile() {
  const input = {
    language: 'Solidity',
    sources: { 'SoulQuantCoin.sol': { content: fs.readFileSync(path.join(root, 'contracts/SoulQuantCoin.sol'), 'utf8') } },
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
  const errors = (output.errors || []).filter(item => item.severity === 'error');
  if (errors.length) throw new Error(errors.map(item => item.formattedMessage).join('\n'));
  const built = output.contracts['SoulQuantCoin.sol'].SoulQuantCoin;
  const artifact = { contractName: 'SoulQuantCoin', abi: built.abi, bytecode: `0x${built.evm.bytecode.object}`, compiler: solc.version() };
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts/SoulQuantCoin.json'), JSON.stringify(artifact, null, 2));
  return artifact;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = compile();
  console.log(`Compiled ${result.contractName} with ${result.compiler}`);
}
