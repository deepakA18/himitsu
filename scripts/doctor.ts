import { RpcClient, readIdentity } from '../packages/client/src/index';

const url = process.env.HIMITSU_RPC_URL ?? 'http://127.0.0.1:8545';
try {
  const identity = await readIdentity(new RpcClient(url));
  const expectedChain = BigInt(process.env.HIMITSU_CHAIN_ID ?? '9');
  if (identity.chainId !== expectedChain) throw new Error(`Expected chain ${expectedChain}, received ${identity.chainId}`);
  const genesis = process.env.HIMITSU_GENESIS_HASH;
  if (genesis && genesis.toLowerCase() !== identity.genesisHash.toLowerCase()) throw new Error('Genesis hash mismatch');
  console.log(JSON.stringify({ ...identity, chainId: identity.chainId.toString(),
    verifiedDeployment: Boolean(genesis),
    note: 'RPC identity only: native frame execution and contract deployment are not established.' }, null, 2));
} catch (error) {
  console.error('Himitsu network check failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
