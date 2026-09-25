import solc from 'solc';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), 'contracts');
const sources = Object.fromEntries(readdirSync(join(root, 'src')).filter(n => n.endsWith('.sol')).map(n => [n, { content: readFileSync(join(root, 'src', n), 'utf8') }]));
const settings = { optimizer: { enabled: true, runs: 200 }, evmVersion: 'prague', outputSelection: { '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode'] } } };
const result = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings })));
for (const error of result.errors ?? []) if (error.severity === 'error') throw new Error(error.formattedMessage);
for (const [file, contracts] of Object.entries(result.contracts)) {
  const out = join(root, 'out', file); mkdirSync(out, { recursive: true });
  for (const [name, c] of Object.entries(contracts)) {
    const artifact = { abi: c.abi, bytecode: { ...c.evm.bytecode, object: '0x' + c.evm.bytecode.object }, deployedBytecode: { ...c.evm.deployedBytecode, object: '0x' + c.evm.deployedBytecode.object }, compiler: solc.version(), settings };
    writeFileSync(join(out, name + '.json'), JSON.stringify(artifact, null, 2) + '\n');
  }
}
console.log('Compiled protocol contracts with', solc.version());
