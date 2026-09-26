// Derive verification artifacts from the existing proving key; never rerun the ceremony here.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const cli = fileURLToPath(new URL('./node_modules/snarkjs/cli.js', import.meta.url));
const run = (args) => execFileSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'pipe' });
run(['zkey', 'export', 'verificationkey', 'circuits/v2/spend-v2.zkey', 'circuits/v2/verification_key.json']);
run(['zkey', 'export', 'solidityverifier', 'circuits/v2/spend-v2.zkey', 'circuits/v2/SpendVerifierV2.sol']);
const stock = readFileSync(root + 'circuits/v2/SpendVerifierV2.sol', 'utf8');
const gas = { 7: 20000, 6: 1000, 8: 250000 };
const patched = stock.replace(/staticcall\(sub\(gas\(\), 2000\), (\d)/g, (_, p) => {
  if (!gas[p]) throw new Error('Unexpected verifier precompile');
  return `staticcall(${gas[p]}, ${p}`;
}).replace('contract Groth16Verifier', 'contract SpendVerifierV2');
if (patched.includes('gas()')) throw new Error('Unpatched verifier GAS site');
writeFileSync(root + 'contracts/src/SpendVerifierV2.sol', patched);
console.log('V2 verification artifacts now derive from the shipped proving key.');
