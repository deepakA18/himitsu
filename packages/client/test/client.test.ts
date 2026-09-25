import { expect, test } from 'bun:test';
import { keccak256 } from 'viem';
import { RpcClient, submitPrepared, verifyDeployment, type PendingTransaction } from '../src/index';
const genesis = `0x${'11'.repeat(32)}` as const;
test('rejects same chain ID with different genesis', async () => {
  const transport = (async (_url: unknown, init: RequestInit) => {
    const req = JSON.parse(init.body as string);
    const result =
      req.method === 'eth_chainId'
        ? '0x9'
        : req.method === 'eth_getBlockByNumber'
          ? { hash: genesis }
          : 'ethrex';
    return Response.json({ jsonrpc: '2.0', id: req.id, result });
  }) as typeof fetch;
  await expect(
    verifyDeployment(new RpcClient('http://localhost', transport), {
      chainId: 9n,
      genesisHash: `0x${'22'.repeat(32)}`,
    }),
  ).rejects.toThrow('identity mismatch');
});
test('does not submit if durable persistence fails', async () => {
  let calls = 0;
  const transport = (async () => {
    calls++;
    throw new Error('unexpected');
  }) as unknown as typeof fetch;
  await expect(
    submitPrepared(
      new RpcClient('http://localhost', transport),
      { raw: '0x06', hash: keccak256('0x06'), state: 'prepared' },
      async () => {
        throw new Error('disk full');
      },
    ),
  ).rejects.toThrow('disk full');
  expect(calls).toBe(0);
});
test('timeout preserves unknown state without automatic rebroadcast', async () => {
  const saved: PendingTransaction[] = [];
  let calls = 0;
  const transport = (async () => {
    calls++;
    throw new Error('timeout');
  }) as unknown as typeof fetch;
  const rpc = new RpcClient('http://localhost', transport);
  const result = await submitPrepared(
    rpc,
    { raw: '0x06', hash: keccak256('0x06'), state: 'prepared' },
    async (record) => {
      saved.push(record);
    },
  );
  expect(saved.map((r) => r.state)).toEqual(['broadcasting', 'unknown']);
  expect(calls).toBe(1);
  await expect(submitPrepared(rpc, result, async () => {})).rejects.toThrow('Reconcile');
});
test('default transport calls fetch with the global receiver required by browsers', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = function (this: unknown, _input: RequestInfo | URL, init?: RequestInit) {
    if (this !== globalThis) throw new Error('Illegal invocation');
    const body = JSON.parse(init!.body as string);
    return Promise.resolve(Response.json({ jsonrpc: '2.0', id: body.id, result: '0x9' }));
  } as typeof fetch;
  try {
    expect(await new RpcClient('http://localhost').request<string>('eth_chainId')).toBe('0x9');
  } finally {
    globalThis.fetch = original;
  }
});
