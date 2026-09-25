import { mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { keccak256 } from 'viem';
import {
  deploySystem,
  deployTokenPool,
  deployUniswap,
  deployer,
  send,
  cast,
  rpc,
  RPC_URL,
  FUNDER,
  DENOMINATION,
  GUSD_DENOMINATION,
} from './ghost.mjs';
import { deployAutomaticSponsor } from './automatic-sponsor.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
if (BigInt(await rpc('eth_chainId')) !== 9n) throw new Error('Local chain 9 required');
console.log('Deploying hardened pools and automatic sponsor for the test app…');
const start = await rpc('eth_getBlockByNumber', ['latest', false]);
const system = await deploySystem({ withLegacySponsor: false, fundPool: false });
const token = deployer.deploySol('TestToken', {
  args: { signature: 'constructor(uint256)', values: ['1000000000000000000000000'] },
});
const { factory, pair } = deployUniswap(system.weth, token);
send('--value', '10ether', system.weth, 'deposit()');
send(system.weth, 'transfer(address,uint256)', pair, '10000000000000000000');
send(token, 'transfer(address,uint256)', pair, '20000000000000000000000');
send(pair, 'mint(address)', FUNDER);
const outputPool = deployTokenPool(system, token, GUSD_DENOMINATION, { fundPool: false });
const sponsor = await deployAutomaticSponsor([system.pool, outputPool]);
const codeHashes = {};
for (const address of [
  ...Object.values(system).filter((v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)),
  token,
  factory,
  pair,
  outputPool,
  sponsor.sponsor,
])
  codeHashes[address] = keccak256(await rpc('eth_getCode', [address, 'latest']));
const publicDir = join(root, 'app/public');
mkdirSync(join(publicDir, 'proving'), { recursive: true });
const artifacts = {};
for (const [name, source, target] of [
  ['wasm', 'circuits/spend_js/spend.wasm', 'spend.wasm'],
  ['zkey', 'circuits/spend_final.zkey', 'spend.zkey'],
]) {
  const path = join(root, 'packages/protocol', source);
  copyFileSync(path, join(publicDir, 'proving', target));
  artifacts[name] = {
    url: '/proving/' + target,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  };
}
copyFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'node_modules/snarkjs/build/snarkjs.min.js'),
  join(publicDir, 'proving/snarkjs.min.js'),
);
const anchor = await rpc('eth_getBlockByNumber', ['latest', false]);
const config = {
  version: 1,
  id: system.pool.toLowerCase() + ':' + anchor.hash,
  anchorBlock: BigInt(anchor.number).toString(),
  anchorBlockHash: anchor.hash,
  rpcUrl: RPC_URL,
  chainId: '9',
  genesisHash: (await rpc('eth_getBlockByNumber', ['0x0', false])).hash,
  deploymentBlock: BigInt(start.number).toString(),
  deploymentBlockHash: start.hash,
  pool: system.pool,
  outputPool,
  token,
  weth: system.weth,
  pair,
  sponsor: sponsor.sponsor,
  wethIsToken0:
    cast('call', '--rpc-url', RPC_URL, pair, 'token0()(address)').toLowerCase() ===
    system.weth.toLowerCase(),
  denomination: DENOMINATION.toString(),
  outputDenomination: GUSD_DENOMINATION.toString(),
  codeHashes,
  artifacts,
};
writeFileSync(join(publicDir, 'deployment.json'), JSON.stringify(config, null, 2) + '\n');
writeFileSync(join(root, 'deployments/app.local.json'), JSON.stringify(config, null, 2) + '\n');
console.log('Public app deployment saved. RPC:', RPC_URL, 'Pool:', system.pool);
process.exit(0);
