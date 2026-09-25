import { readFileSync } from 'node:fs';
import { readiness } from '../packages/client/src/market';
import type { Deployment } from '../packages/client/src/chain';
import { RpcClient, readIdentity } from '../packages/client/src/index';

const app = process.argv.includes('--app');
const manifest = app
  ? (JSON.parse(readFileSync('app/public/deployment.json', 'utf8')) as Deployment)
  : undefined;
const url = manifest?.rpcUrl ?? process.env.HIMITSU_RPC_URL ?? 'http://127.0.0.1:8545';
try {
  const identity = await readIdentity(new RpcClient(url));
  const expectedChain = BigInt(manifest?.chainId ?? process.env.HIMITSU_CHAIN_ID ?? '9');
  if (identity.chainId !== expectedChain)
    throw new Error(`Expected chain ${expectedChain}, received ${identity.chainId}`);
  const genesis = manifest?.genesisHash ?? process.env.HIMITSU_GENESIS_HASH;
  if (genesis && genesis.toLowerCase() !== identity.genesisHash.toLowerCase())
    throw new Error('Genesis hash mismatch');
  const health = manifest ? await readiness(new RpcClient(url), manifest) : undefined;
  if (health && [...health.depositIssues, ...health.swapIssues, ...health.withdrawalIssues].length)
    process.exitCode = 1;
  console.log(
    JSON.stringify(
      {
        ...identity,
        chainId: identity.chainId.toString(),
        verifiedDeployment: Boolean(manifest),
        verifiedGenesis: Boolean(genesis),
        ...(health ? { readiness: health } : {}),
        note: manifest
          ? 'App readiness checked against the published deployment; this does not reserve liquidity or funding.'
          : 'RPC identity only: native frame execution and contract deployment are not established.',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    'Himitsu network check failed:',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
}
