import {
  decodeEventLog,
  encodeFunctionData,
  decodeFunctionResult,
  keccak256,
  parseAbi,
  type Hex,
} from 'viem';
import { RpcClient, verifyDeployment } from './index';
import { NoteTree, hex32, withAmount, type SavedNote } from './notes';
import { type Attempt, type AttemptState } from './vault';
export const poolAbi = parseAbi([
  'function depositETH(bytes32 commitment) payable returns (uint32)',
  'function depositToken(bytes32 commitment) returns (uint32)',
  'function getLastRoot() view returns (bytes32)',
  'function spent(bytes32) view returns (bool)',
  'function validateSpend(bytes32 root,bytes32 nullifierHash,address recipient)',
  'function spend()',
  'function spendAndSwapToNote(address pair,uint256 amount0Out,uint256 amount1Out,address outPool,bytes32 outCommitment)',
  'event Deposit(bytes32 indexed commitment,uint32 leafIndex,bytes32 root)',
]);
export const poolV2Abi = parseAbi([
  'function depositETH(bytes32 recoveryTag) payable returns (uint32)',
  'function depositTokenAmount(bytes32 recoveryTag,uint256 amount) returns (uint32)',
  'function validateSpend(bytes32 root,bytes32 nullifierHash,address recipient,uint256 amount)',
  'function spendAndSwapQuoted(address pair,uint256 minOut,address outPool,bytes32 recoveryTag)',
  'event DepositV2(bytes32 indexed commitment,uint32 leafIndex,bytes32 root,bytes32 recoveryTag,uint256 amount)',
]);
export interface Deployment {
  noteVersion?: 2;
  name?: string;
  version: 1;
  id: string;
  rpcUrl: string;
  chainId: string;
  genesisHash: Hex;
  deploymentBlock: string;
  deploymentBlockHash: Hex;
  anchorBlock: string;
  anchorBlockHash: Hex;
  pool: Hex;
  outputPool: Hex;
  token: Hex;
  weth: Hex;
  pair: Hex;
  sponsor: Hex;
  wethIsToken0: boolean;
  defaultDepositAmount?: string;
  denomination: string;
  outputDenomination: string;
  codeHashes: Record<Hex, Hex>;
  artifacts: { wasm: { url: string; sha256: string }; zkey: { url: string; sha256: string } };
}
export interface Block {
  number: Hex;
  hash: Hex;
  timestamp: Hex;
  baseFeePerGas: Hex;
}
export interface Receipt {
  blockNumber: Hex;
  blockHash: Hex;
  transactionHash: Hex;
  status: Hex;
  frameReceipts?: { status: Hex }[];
  gasUsed: Hex;
  effectiveGasPrice: Hex;
  payer?: Hex;
}
export interface PoolSnapshot {
  recovered?: Map<string, SavedNote>;
  tree: NoteTree;
  indices: Map<string, number>;
  spent: Map<string, boolean>;
  nonce: bigint;
}
export interface Snapshot {
  safe: Block;
  head: Block;
  pools: Map<string, PoolSnapshot>;
  receipts: Map<string, { receipt: Receipt; confirmed: boolean }>;
}
export async function contractRead(
  rpc: RpcClient,
  to: Hex,
  functionName: 'getLastRoot' | 'spent',
  args: readonly unknown[] = [],
  block: Hex | 'latest' = 'latest',
): Promise<unknown> {
  const data = encodeFunctionData({ abi: poolAbi, functionName, args } as never);
  const result = await rpc.request<Hex>('eth_call', [{ to, data }, block]);
  return decodeFunctionResult({ abi: poolAbi, functionName, data: result });
}
export async function verifyConfig(rpc: RpcClient, d: Deployment) {
  await verifyDeployment(rpc, { chainId: BigInt(d.chainId), genesisHash: d.genesisHash });
  const block = await rpc.request<Block | null>('eth_getBlockByNumber', [
    `0x${BigInt(d.anchorBlock).toString(16)}`,
    false,
  ]);
  if (!block || block.hash.toLowerCase() !== d.anchorBlockHash.toLowerCase())
    throw new Error(
      'Deployment block changed. Select the matching deployment; notes have not been deleted.',
    );
  await Promise.all(
    Object.entries(d.codeHashes).map(async ([address, hash]) => {
      const code = await rpc.request<Hex>('eth_getCode', [address, 'latest']);
      if (keccak256(code) !== hash) throw new Error('Contract code does not match the deployment');
    }),
  );
}
export async function snapshot(
  rpc: RpcClient,
  d: Deployment,
  notes: SavedNote[],
  attempts: Attempt[],
  confirmations = 2,
): Promise<Snapshot> {
  await verifyConfig(rpc, d);
  const head = await rpc.request<Block>('eth_getBlockByNumber', ['latest', false]);
  const height = BigInt(head.number) - BigInt(confirmations);
  if (height < BigInt(d.deploymentBlock)) throw new Error('Waiting for deployment confirmations');
  const tag = `0x${height.toString(16)}` as Hex,
    safe = await rpc.request<Block>('eth_getBlockByNumber', [tag, false]);
  const pools = new Map<string, PoolSnapshot>();
  for (const pool of [d.pool, d.outputPool]) {
    const tree = new NoteTree(),
      indices = new Map<string, number>();
    const tags = new Map<string, { commitment: Hex; amount: string }>();
    for (let from = BigInt(d.deploymentBlock); from <= height; from += 2000n) {
      const to = from + 1999n < height ? from + 1999n : height;
      const logs = await rpc.request<
        { topics: Hex[]; data: Hex; removed?: boolean; blockNumber: Hex; logIndex: Hex }[]
      >('eth_getLogs', [
        {
          address: pool,
          fromBlock: `0x${from.toString(16)}`,
          toBlock: `0x${to.toString(16)}`,
          topics: [
            keccak256(
              new TextEncoder().encode(
                d.noteVersion === 2
                  ? 'DepositV2(bytes32,uint32,bytes32,bytes32,uint256)'
                  : 'Deposit(bytes32,uint32,bytes32)',
              ),
            ),
          ],
        },
      ]);
      logs.sort(
        (a, b) =>
          Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) ||
          Number(BigInt(a.logIndex) - BigInt(b.logIndex)),
      );
      for (const log of logs) {
        if (log.removed) throw new Error('Chain changed during event sync');
        const decoded = decodeEventLog({
          abi: d.noteVersion === 2 ? poolV2Abi : poolAbi,
          eventName: d.noteVersion === 2 ? 'DepositV2' : 'Deposit',
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
        });
        const a = decoded.args as {
          commitment: Hex;
          leafIndex: number;
          root: Hex;
          recoveryTag?: Hex;
          amount?: bigint;
        };
        if (d.noteVersion === 2) {
          if (
            !a.recoveryTag ||
            a.amount === undefined ||
            a.amount <= 0n ||
            a.amount >= 1n << 128n ||
            tags.has(a.recoveryTag.toLowerCase())
          )
            throw new Error('Invalid amount-bound deposit event');
          // Validate the amount/tag binding for ALL events, not just this wallet's matches.
          const { poseidon2 } = await import('poseidon-lite');
          if (hex32(poseidon2([BigInt(a.recoveryTag), a.amount])) !== a.commitment)
            throw new Error('Deposit amount commitment mismatch');
          tags.set(a.recoveryTag.toLowerCase(), {
            commitment: a.commitment,
            amount: String(a.amount),
          });
        }
        if (a.leafIndex !== tree.leaves.length || indices.has(a.commitment.toLowerCase()))
          throw new Error('Non-contiguous or duplicate deposit events');
        indices.set(a.commitment.toLowerCase(), a.leafIndex);
        tree.insert(BigInt(a.commitment));
        if (hex32(tree.root()) !== a.root) throw new Error('Deposit root mismatch');
      }
    }
    if (hex32(tree.root()) !== (await contractRead(rpc, pool, 'getLastRoot', [], tag)))
      throw new Error('Canonical event tree does not match pool root');
    const recovered = new Map<string, SavedNote>();
    if (d.noteVersion === 2)
      for (const n of notes) {
        if (n.deployment !== d.id || n.pool.toLowerCase() !== pool.toLowerCase()) continue;
        const event = tags.get((n.baseCommitment ?? n.commitment).toLowerCase());
        if (event) {
          const found = withAmount(n, event.amount);
          if (found.commitment !== event.commitment)
            throw new Error('Recovered commitment mismatch');
          recovered.set(n.id, found);
        }
      }
    const spent = new Map<string, boolean>();
    await Promise.all(
      notes
        .filter(
          (n) =>
            n.deployment === d.id &&
            n.pool.toLowerCase() === pool.toLowerCase() &&
            (indices.has(n.commitment.toLowerCase()) || recovered.has(n.id)),
        )
        .map(async (n) =>
          spent.set(
            n.id,
            (await contractRead(rpc, pool, 'spent', [n.nullifierHash], tag)) as boolean,
          ),
        ),
    );
    pools.set(pool.toLowerCase(), {
      tree,
      indices,
      spent,
      recovered,
      nonce: BigInt(await rpc.request<Hex>('eth_getTransactionCount', [pool, tag])),
    });
  }
  const receipts = new Map<string, { receipt: Receipt; confirmed: boolean }>();
  await Promise.all(
    attempts
      .filter((a) => a.deployment === d.id && a.hash)
      .map(async (a) => {
        const receipt = await rpc.request<Receipt | null>('eth_getTransactionReceipt', [a.hash]);
        if (!receipt) return;
        const block = await rpc.request<Block | null>('eth_getBlockByNumber', [
          receipt.blockNumber,
          false,
        ]);
        if (
          block?.hash.toLowerCase() === receipt.blockHash.toLowerCase() &&
          receipt.transactionHash.toLowerCase() === a.hash!.toLowerCase()
        )
          receipts.set(a.id, { receipt, confirmed: BigInt(receipt.blockNumber) <= height });
      }),
  );
  const check = await rpc.request<Block>('eth_getBlockByNumber', [tag, false]);
  if (check.hash !== safe.hash) throw new Error('Chain reorganized during sync; refresh again');
  return { safe, head, pools, receipts };
}
export interface AttemptEvidence {
  receipt?: { success: boolean; confirmed: boolean };
  spent: boolean;
  outputPresent: boolean;
  nonce: bigint;
  timestamp: bigint;
  depositPresent: boolean;
}
export function reconcileAttempt(
  a: Attempt,
  e: AttemptEvidence,
): { state: AttemptState; detail: string } {
  if (a.kind === 'deposit') {
    if (e.depositPresent)
      return { state: 'confirmed', detail: 'Deposit found in canonical events' };
    if (e.receipt?.confirmed && !e.receipt.success)
      return { state: 'failed', detail: 'Deposit reverted' };
    return {
      state: e.receipt ? 'mined' : 'unknown',
      detail: 'Waiting for canonical deposit evidence; do not resend automatically',
    };
  }
  if (e.receipt) {
    if (!e.receipt.confirmed) return { state: 'mined', detail: 'Waiting for two successor blocks' };
    if (!e.receipt.success && !e.spent)
      return { state: 'failed', detail: 'Execution reverted; note remains unspent' };
    if (e.receipt.success && e.spent && (a.kind !== 'swap' || e.outputPresent))
      return { state: 'confirmed', detail: 'Canonical execution confirmed' };
    return { state: 'unknown', detail: 'Receipt and pool state disagree; keep notes reserved' };
  }
  if (e.spent) return { state: 'conflict', detail: 'Nullifier is spent on the canonical chain' };
  if (a.nonce !== undefined && e.nonce > BigInt(a.nonce))
    return {
      state: 'conflict',
      detail:
        'Another transaction consumed this pool nonce; fresh proof requires an explicit retry',
    };
  if (a.deadline !== undefined && e.timestamp > BigInt(a.deadline))
    return {
      state: 'expired',
      detail: 'Deadline passed on the confirmed chain; fresh proof requires an explicit retry',
    };
  return {
    state: 'unknown',
    detail: 'No canonical receipt yet; keep the input and output reserved',
  };
}
export function reconciled(
  attempts: Attempt[],
  notes: SavedNote[],
  d: Deployment,
  s: Snapshot,
): Attempt[] {
  return attempts.map((a) => {
    if (a.deployment !== d.id) return a;
    const note = notes.find((n) => n.id === a.source)!;
    const pool = s.pools.get(note.pool.toLowerCase())!;
    const output = notes.find((n) => n.id === a.output),
      found = s.receipts.get(a.id);
    const receipt = found
      ? {
          confirmed: found.confirmed,
          success:
            found.receipt.status === '0x1' &&
            (a.kind === 'deposit' || found.receipt.frameReceipts?.[3]?.status === '0x1'),
        }
      : undefined;
    const e: AttemptEvidence = {
      spent: pool.spent.get(note.id) ?? false,
      outputPresent:
        !!output &&
        !!s.pools.get(output.pool.toLowerCase())?.indices.has(output.commitment.toLowerCase()),
      nonce: pool.nonce,
      timestamp: BigInt(s.safe.timestamp),
      depositPresent: pool.indices.has(note.commitment.toLowerCase()),
      ...(receipt ? { receipt } : {}),
    };
    return { ...a, ...reconcileAttempt(a, e) };
  });
}
