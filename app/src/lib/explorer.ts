import { decodeEventLog, formatUnits, parseAbi, type Hex } from 'viem';
import { RpcClient, verifyDeployment } from '../../../packages/client/src/index';
import { poolAbi, poolV2Abi, type Deployment } from '../../../packages/client/src/chain';
export type Frame = {
  mode: Hex;
  flags: Hex;
  to: Hex | null;
  gasLimit: Hex;
  stateGasLimit: Hex;
  data: Hex;
  value: Hex;
};
export type Transaction = {
  hash: Hex;
  type: Hex;
  from: Hex;
  sender?: Hex;
  to: Hex | null;
  nonce: Hex;
  value?: Hex;
  blockNumber: Hex | null;
  frames?: Frame[];
};
export type Log = { address: Hex; topics: Hex[]; data: Hex };
export type Receipt = {
  blockHash: Hex;
  blockNumber: Hex;
  status: Hex;
  gasUsed: Hex;
  effectiveGasPrice?: Hex;
  payer?: Hex;
  contractAddress?: Hex;
  logs: Log[];
  frameReceipts?: { status: Hex; gasUsed: Hex; stateGasUsed?: Hex }[];
};
export type Block = {
  number: Hex;
  hash: Hex;
  timestamp: Hex;
  gasUsed: Hex;
  transactions: Transaction[];
};
export const quantity = (v?: string | null) =>
  v == null ? '—' : BigInt(v).toLocaleString('en-US');
export const short = (v: string) => `${v.slice(0, 10)}…${v.slice(-6)}`;
export function frameStatus(status?: Hex) {
  return status == null
    ? 'Not reported'
    : ({ 0: 'Reverted', 1: 'Success', 2: 'Skipped' }[Number(BigInt(status))] ?? 'Unknown');
}
export function frameLabel(f: Frame, d: Deployment, sender: string) {
  const target = (f.to ?? sender).toLowerCase();
  const pool = [d.pool, d.outputPool].some((p) => p.toLowerCase() === target);
  if (target === '0x0000000000000000000000000000000000008141') return 'Check expiry';
  if (target === d.sponsor.toLowerCase()) return 'Approve gas payment';
  if (pool && BigInt(f.mode) === 1n) return 'Verify note & authorize spend';
  if (pool && f.data.startsWith('0x431cbd85')) return 'Swap & create output note';
  if (pool && f.data.startsWith('0x45615bcc')) return 'Withdraw';
  return pool && BigInt(f.mode) === 2n ? 'Execute pool action' : 'Contract execution';
}
const events = parseAbi([
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'event Approval(address indexed owner,address indexed spender,uint256 value)',
]);
export function decodeLog(
  log: Log,
  d: Deployment,
): { title: string; fields: [string, string][] } | null {
  try {
    const token =
      log.address.toLowerCase() === d.weth.toLowerCase()
        ? 'WETH'
        : log.address.toLowerCase() === d.token.toLowerCase()
          ? 'gUSD'
          : null;
    if (token) {
      const event = decodeEventLog({
        abi: events,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const a = event.args;
      return {
        title: `${token} ${event.eventName}`,
        fields:
          event.eventName === 'Transfer'
            ? [
                ['From', event.args.from],
                ['To', event.args.to],
                ['Amount', `${formatUnits(a.value, 18)} ${token}`],
              ]
            : [
                ['Owner', event.args.owner],
                ['Spender', event.args.spender],
                ['Allowance', `${formatUnits(a.value, 18)} ${token}`],
              ],
      };
    }
    if ([d.pool, d.outputPool].some((p) => p.toLowerCase() === log.address.toLowerCase())) {
      const event = decodeEventLog({
        abi: d.noteVersion === 2 ? poolV2Abi : poolAbi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      return {
        title: 'Private note commitment',
        fields: Object.entries(event.args).map(([k, v]) => [k, String(v)]),
      };
    }
  } catch {
    /* Unrecognized logs remain available as raw public data. */
  }
  return null;
}
export function parseSearch(input: string): { tx?: string; block?: string } {
  const value = input.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return { tx: value };
  if (/^\d{1,20}$/.test(value)) return { block: BigInt(value).toString() };
  throw new Error('Enter a 0x transaction hash (64 hex characters) or a decimal block number.');
}
export async function loadExplorer(
  d: Deployment,
  query: { tx?: string; block?: string; before?: string },
) {
  const rpc = new RpcClient(d.rpcUrl);
  await verifyDeployment(rpc, { chainId: BigInt(d.chainId), genesisHash: d.genesisHash });
  const head = BigInt(await rpc.request<Hex>('eth_blockNumber'));
  if (query.tx) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(query.tx)) throw new Error('Invalid transaction hash');
    const [transaction, receipt] = await Promise.all([
      rpc.request<Transaction | null>('eth_getTransactionByHash', [query.tx]),
      rpc.request<Receipt | null>('eth_getTransactionReceipt', [query.tx]),
    ]);
    const canonical = receipt
      ? await rpc.request<Block | null>('eth_getBlockByNumber', [receipt.blockNumber, false])
      : null;
    return {
      head,
      transaction,
      receipt,
      canonical: !!receipt && canonical?.hash === receipt.blockHash,
      blocks: [] as Block[],
    };
  }
  const cursor = query.block ?? query.before;
  if (cursor && !/^\d{1,20}$/.test(cursor)) throw new Error('Invalid block number');
  const top = cursor ? BigInt(cursor) : head;
  if (top > head) throw new Error('That block has not been mined yet.');
  const count = query.block ? 1 : Number(top < 11n ? top + 1n : 12n);
  const blocks = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      rpc.request<Block | null>('eth_getBlockByNumber', [
        `0x${(top - BigInt(i)).toString(16)}`,
        true,
      ]),
    ),
  );
  if (blocks.some((b) => !b))
    throw new Error('Block data changed or is unavailable. Refresh to retry.');
  return { head, blocks: blocks as Block[], transaction: null, receipt: null, canonical: false };
}
