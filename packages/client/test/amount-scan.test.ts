import { test, expect } from 'bun:test';
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  keccak256,
  type Hex,
} from 'viem';
import { snapshot, poolAbi, poolV2Abi, type Deployment } from '../src/chain';
import { RpcClient } from '../src/index';
import { createSecretNote, withAmount, NoteTree, hex32 } from '../src/notes';
const pool = '0x1111111111111111111111111111111111111111',
  outputPool = '0x2222222222222222222222222222222222222222';
const hash = ('0x' + '11'.repeat(32)) as Hex;
const d = {
  version: 1,
  noteVersion: 2,
  id: 'scan-test',
  rpcUrl: 'http://localhost',
  chainId: '9',
  genesisHash: hash,
  deploymentBlock: '0',
  deploymentBlockHash: hash,
  anchorBlock: '0',
  anchorBlockHash: hash,
  pool,
  outputPool,
  codeHashes: { [pool]: keccak256('0x60') },
} as unknown as Deployment;
const pending = {
  ...createSecretNote(),
  id: 'candidate',
  deployment: d.id,
  pool: outputPool as Hex,
  createdAt: 0,
};
const actual = withAmount(pending, '197431606879412259770');
const tree = new NoteTree();
tree.insert(BigInt(actual.commitment));
function rpc(tamper = false) {
  const client = new RpcClient('http://localhost');
  client.request = async function <T>(method: string, params: unknown[] = []): Promise<T> {
    let value: unknown;
    if (method === 'eth_chainId') value = '0x9';
    else if (method === 'web3_clientVersion') value = 'fixture';
    else if (method === 'eth_getCode') value = '0x60';
    else if (method === 'eth_getBlockByNumber')
      value = {
        number: params[0] === 'latest' ? '0x3' : params[0],
        hash,
        timestamp: '0x1',
        baseFeePerGas: '0x0',
      };
    else if (method === 'eth_getTransactionCount') value = '0x0';
    else if (method === 'eth_getLogs')
      value =
        (params[0] as { address: string }).address === outputPool
          ? [
              {
                topics: encodeEventTopics({
                  abi: poolV2Abi,
                  eventName: 'DepositV2',
                  args: { commitment: actual.commitment },
                }),
                data: encodeAbiParameters(
                  [
                    { type: 'uint32' },
                    { type: 'bytes32' },
                    { type: 'bytes32' },
                    { type: 'uint256' },
                  ],
                  [
                    0,
                    hex32(tree.root()),
                    pending.commitment,
                    BigInt(actual.amount!) + (tamper ? 1n : 0n),
                  ],
                ),
                blockNumber: '0x1',
                logIndex: '0x0',
                removed: false,
              },
            ]
          : [];
    else if (method === 'eth_call') {
      const call = params[0] as { to: string; data: Hex };
      if (call.data === encodeFunctionData({ abi: poolAbi, functionName: 'getLastRoot' }))
        value = hex32(call.to === outputPool ? tree.root() : new NoteTree().root());
      else value = hex32(0n);
    } else throw new Error('Unexpected ' + method);
    return value as T;
  };
  return client;
}
test('canonical recovery learns a variable output amount from its stable tag', async () => {
  const s = await snapshot(rpc(), d, [pending], []);
  expect(s.pools.get(outputPool)?.recovered?.get(pending.id)).toEqual(actual);
  expect(s.pools.get(outputPool)?.spent.get(pending.id)).toBe(false);
});
test('an RPC cannot substitute a different amount for a commitment', async () => {
  await expect(snapshot(rpc(true), d, [pending], [])).rejects.toThrow('amount commitment mismatch');
});
