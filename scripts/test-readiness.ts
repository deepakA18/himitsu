import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RpcClient } from '../packages/client/src/index';
import { readiness } from '../packages/client/src/market';
import type { Deployment } from '../packages/client/src/chain';
const d = JSON.parse(readFileSync('app/public/deployment.json', 'utf8')) as Deployment;
const rpc = new RpcClient(d.rpcUrl),
  original = rpc.request.bind(rpc);
assert.equal((await readiness(rpc, d)).swapIssues.length, 0);
rpc.request = async function <T>(method: string, params: unknown[] = []): Promise<T> {
  if (method === 'eth_getBalance') return '0x0' as T;
  return original<T>(method, params);
};
assert.ok((await readiness(rpc, d)).swapIssues.includes('Paymaster needs more test ETH'));
rpc.request = async function <T>(method: string, params: unknown[] = []): Promise<T> {
  if (method === 'eth_getCode') return '0x' as T;
  return original<T>(method, params);
};
await assert.rejects(readiness(rpc, d), /Contract code/);
rpc.request = async function <T>(method: string, params: unknown[] = []): Promise<T> {
  if (method === 'eth_chainId') return '0x1' as T;
  return original<T>(method, params);
};
await assert.rejects(readiness(rpc, d), /identity mismatch/);
rpc.request = async function <T>(method: string, params: unknown[] = []): Promise<T> {
  const value = await original<T>(method, params);
  if (method === 'eth_getBlockByNumber' && params[0] === 'latest')
    return { ...value, timestamp: '0x1' };
  return value;
};
await assert.rejects(readiness(rpc, d), /recent blocks/);
rpc.request = original;
await assert.rejects(readiness(rpc, { ...d, wethIsToken0: !d.wethIsToken0 }), /pair tokens/);
console.log(
  'Readiness: healthy, unfunded, wrong code, wrong chain, stalled node and wrong pair checks passed.',
);
