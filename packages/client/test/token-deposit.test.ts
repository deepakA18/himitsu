import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { decodeFunctionData, encodeAbiParameters, parseAbi, type Hex } from 'viem';
import { Controller, type Wallet } from '../../../app/src/lib/controller';
import { createPrivateNote, exportPrivateNote, importPrivateNote, privateNoteCacheKey, HUSD_DEPOSIT_AMOUNTS } from '../src/private-note';
import { withAmount } from '../src/notes';
import { Vault, type Envelope, type VaultStore } from '../src/vault';
import { reconcileAttempt, type Deployment, poolV2Abi } from '../src/chain';
const d = JSON.parse(readFileSync('app/public/deployment.json', 'utf8')) as Deployment;
const account = `0x${'11'.repeat(20)}` as Hex;
const approvalHash = `0x${'aa'.repeat(32)}` as Hex;
const depositHash = `0x${'bb'.repeat(32)}` as Hex;
const blockHash = `0x${'cc'.repeat(32)}` as Hex;
const abi = parseAbi(['function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)', 'function decimals() view returns(uint8)', 'function approve(address,uint256) returns(bool)']);
async function fixture(options: { reject?: boolean; revert?: boolean; poor?: boolean; allowance?: bigint; loseDeposit?: boolean } = {}) {
  let saved: Envelope | undefined;
  const store: VaultStore = { read: async () => saved, compareAndSet: async (revision, value) => { expect(saved?.revision ?? null).toBe(revision); saved = structuredClone(value); } };
  const note = createPrivateNote(d, d.outputPool, 'token-deposit', HUSD_DEPOSIT_AMOUNTS[1]);
  const amount = BigInt(note.amount!);
  const vault = await Vault.openPrivateNote(store, privateNoteCacheKey(note));
  const c = new Controller(d, vault);
  c.exclusive = async (fn) => fn();
  Reflect.set(c, 'sync', async () => {});
  Reflect.set(c, 'requireReady', async () => {});
  let approved = options.allowance ?? 0n, receiptChecked = false;
  const sent: { to: Hex; value: Hex; data: Hex }[] = [];
  c.rpc.request = async <T>(method: string, params: unknown[] = []): Promise<T> => {
    let result: unknown;
    if (method === 'eth_call') {
      const { functionName } = decodeFunctionData({ abi, data: (params[0] as { data: Hex }).data });
      result = encodeAbiParameters([{ type: 'uint256' }], [functionName === 'decimals' ? 18n : functionName === 'balanceOf' ? options.poor ? 0n : amount : approved]);
    } else if (method === 'eth_getTransactionReceipt') {
      receiptChecked = true;
      expect(vault.data.attempts[0]?.approvalHashes).toEqual([approvalHash]);
      expect(vault.data.attempts[0]?.hash).toBeUndefined();
      result = { status: options.revert ? '0x0' : '0x1', blockNumber: '0x1', blockHash };
    } else if (method === 'eth_getBlockByNumber') result = { hash: blockHash };
    else if (method === 'eth_blockNumber') result = '0x3';
    else throw new Error(method);
    return result as T;
  };
  const wallet: Wallet = { request: async ({ method, params }) => {
    if (method === 'eth_chainId') return '0x9';
    if (method === 'eth_accounts') return [account];
    const tx = params![0] as typeof sent[number];
    sent.push(tx);
    if (tx.to === d.token) {
      if (options.reject) throw new Error('User rejected approval');
      const decoded = decodeFunctionData({ abi, data: tx.data });
      expect(decoded.functionName).toBe('approve');
      expect(decoded.args![0]!.toString().toLowerCase()).toBe(d.outputPool.toLowerCase());
      expect(decoded.args![1]).toBe(amount);
      approved = amount;
      return approvalHash;
    }
    expect(approved).toBe(amount);
    expect(receiptChecked || options.allowance === amount).toBe(true);
    expect(vault.data.attempts[0]?.depositBroadcast).toBe(true);
    if (options.loseDeposit) throw new Error('Lost response');
    return depositHash;
  } };
  return { c, wallet, note, vault, sent };
}
test('hUSD presets produce recoverable amount-bound notes in the hUSD pool', () => {
  for (const amount of HUSD_DEPOSIT_AMOUNTS) {
    const note = createPrivateNote(d, d.outputPool, 'token-deposit', amount);
    const restored = importPrivateNote(exportPrivateNote(note, d), d);
    expect(restored.pool.toLowerCase()).toBe(d.outputPool.toLowerCase());
    expect(withAmount(restored, amount).commitment).toBe(note.commitment);
  }
  expect(() => createPrivateNote(d, d.pool, 'token-deposit')).toThrow('hUSD pool');
  expect(() => createPrivateNote(d, d.outputPool, 'token-deposit', '1')).toThrow('Choose');
});
test('exact pool approval is confirmed before token deposit; allowance is reduced if oversized', async () => {
  const f = await fixture({ allowance: 1n << 255n });
  const a = await f.c.deposit(f.wallet, account, f.note);
  expect(a.state).toBe('submitted');
  expect(a.hash).toBe(depositHash);
  expect(a.approvalHashes).toEqual([approvalHash]);
  expect(f.sent.length).toBe(2);
  expect(f.sent[1]!.to).toBe(d.outputPool);
  expect(f.sent[1]!.value).toBe('0x0');
  const decoded = decodeFunctionData({ abi: poolV2Abi, data: f.sent[1]!.data });
  expect(decoded.functionName).toBe('depositTokenAmount');
  expect(decoded.args).toEqual([f.note.baseCommitment!, BigInt(f.note.amount!)]);
});
test('existing exact approval skips the extra wallet transaction', async () => {
  const f = await fixture({ allowance: BigInt(HUSD_DEPOSIT_AMOUNTS[1]!) });
  expect((await f.c.deposit(f.wallet, account, f.note)).state).toBe('submitted');
  expect(f.sent.length).toBe(1);
});
for (const options of [{ reject: true }, { revert: true }, { poor: true }]) {
  test(`no deposit after unsuccessful token preparation ${JSON.stringify(options)}`, async () => {
    const f = await fixture(options);
    const a = await f.c.deposit(f.wallet, account, f.note);
    expect(a.state).toBe('failed');
    expect(a.depositBroadcast).toBe(false);
    expect(a.hash).toBeUndefined();
    expect(f.sent.some((tx) => tx.to === d.outputPool)).toBe(false);
    expect(reconcileAttempt(a, { spent: false, outputPresent: false, nonce: 0n, timestamp: 0n, depositPresent: false }).state).toBe('failed');
  });
}
test('lost deposit response remains uncertain and retains the private note and approval journal', async () => {
  const f = await fixture({ loseDeposit: true });
  const a = await f.c.deposit(f.wallet, account, f.note);
  expect(a.state).toBe('unknown');
  expect(a.depositBroadcast).toBe(true);
  expect(a.approvalHashes).toEqual([approvalHash]);
  expect(f.vault.data.notes[0]!.id).toBe(f.note.id);
});
