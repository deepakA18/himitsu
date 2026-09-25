import { assertHex } from '../../frame-codec/src/index';
import type { Hex } from 'viem';

export class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
  }
}
/** Transport failures on eth_sendRawTransaction leave submission status UNKNOWN. */
export class RpcClient {
  private id = 0;
  constructor(
    readonly url: string,
    private readonly transport: (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<Response> = (input, init) => globalThis.fetch(input, init),
  ) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('HTTP(S) RPC required');
  }
  async request<T>(method: string, params: unknown[] = []): Promise<T> {
    const id = ++this.id;
    const response = await this.transport(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const body = (await response.json()) as {
      id?: unknown;
      jsonrpc?: unknown;
      result?: T;
      error?: { code: number; message: string };
    };
    if (body.jsonrpc !== '2.0' || body.id !== id) throw new Error('Invalid RPC response envelope');
    if (body.error) throw new RpcError(body.error.code, body.error.message);
    if (!Object.hasOwn(body, 'result')) throw new Error('Missing RPC result');
    return body.result as T;
  }
}
export interface DeploymentIdentity {
  chainId: bigint;
  genesisHash: Hex;
}
export async function readIdentity(rpc: RpcClient) {
  const [chainId, genesis, clientVersion] = await Promise.all([
    rpc.request<Hex>('eth_chainId'),
    rpc.request<{ hash: Hex } | null>('eth_getBlockByNumber', ['0x0', false]),
    rpc.request<string>('web3_clientVersion'),
  ]);
  if (!genesis) throw new Error('Genesis block unavailable');
  assertHex(genesis.hash, 32);
  return { chainId: BigInt(chainId), genesisHash: genesis.hash, clientVersion };
}
export async function verifyDeployment(rpc: RpcClient, expected: DeploymentIdentity) {
  const actual = await readIdentity(rpc);
  assertHex(expected.genesisHash, 32);
  if (
    actual.chainId !== expected.chainId ||
    actual.genesisHash.toLowerCase() !== expected.genesisHash.toLowerCase()
  ) {
    throw new Error('Deployment identity mismatch: chain reset or wrong network');
  }
  return actual;
}

export type SubmissionState = 'prepared' | 'broadcasting' | 'submitted' | 'unknown' | 'rejected';
export interface PendingTransaction {
  hash: Hex;
  raw: Hex;
  state: SubmissionState;
}
/** Storage must durably save encrypted output-note secrets BEFORE this is called. */
export async function submitPrepared(
  rpc: RpcClient,
  transaction: PendingTransaction,
  persist: (record: PendingTransaction) => Promise<void>,
): Promise<PendingTransaction> {
  if (transaction.state !== 'prepared')
    throw new Error('Reconcile existing submission before retrying');
  const { keccak256 } = await import('viem');
  assertHex(transaction.raw);
  assertHex(transaction.hash, 32);
  if (keccak256(transaction.raw) !== transaction.hash) throw new Error('Transaction hash mismatch');
  const broadcasting = { ...transaction, state: 'broadcasting' as const };
  // If saving fails, nothing is broadcast. A crash after this point must trigger reconciliation.
  await persist(broadcasting);
  let next: PendingTransaction;
  try {
    const hash = await rpc.request<Hex>('eth_sendRawTransaction', [transaction.raw]);
    if (hash.toLowerCase() !== transaction.hash.toLowerCase())
      throw new Error('Unexpected submitted hash');
    next = { ...transaction, state: 'submitted' };
  } catch {
    // Even JSON-RPC errors such as "already known" or "nonce too low" can follow prior
    // acceptance. Never automatically reprove/replace based on this response alone.
    next = { ...transaction, state: 'unknown' };
  }
  await persist(next);
  return next;
}
