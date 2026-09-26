import { readMarket, amountOut, readiness, minimumOutput } from '../packages/client/src/market';
import {
  createPrivateNote,
  exportPrivateNote,
  importPrivateNote,
  privateNoteCacheKey,
} from '../packages/client/src/private-note';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Controller, Vault } from '../app/src/lib/controller';
import type { Envelope, VaultStore, Attempt } from '../packages/client/src/vault';
import type { Deployment } from '../packages/client/src/chain';
import type { Hex } from 'viem';
import { createRequire } from 'node:module';
const snarkjs = createRequire(process.cwd() + '/packages/protocol/package.json')('snarkjs');
const { FUNDER_KEY } = await import(process.cwd() + '/packages/protocol/ghost.mjs');
const d = JSON.parse(
  readFileSync(process.env.DEPLOYMENT_FILE ?? 'app/public/deployment.json', 'utf8'),
) as Deployment;
// Two independent browser origins/profiles have separate Web Locks and vaults.
Object.defineProperty(globalThis, 'navigator', {
  value: { locks: { request: async (_name: string, fn: () => unknown) => fn() } },
  configurable: true,
});
async function prover(_d: Deployment, input: unknown): Promise<Hex> {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    d.noteVersion === 2
      ? 'packages/protocol/circuits/v2/spend-v2_js/spend-v2.wasm'
      : 'packages/protocol/circuits/spend_js/spend.wasm',
    d.noteVersion === 2
      ? 'packages/protocol/circuits/v2/spend-v2.zkey'
      : 'packages/protocol/circuits/spend_final.zkey',
    undefined,
    undefined,
    { singleThread: true },
  );
  if (d.noteVersion === 2) {
    const vk = JSON.parse(
      readFileSync('packages/protocol/circuits/v2/verification_key.json', 'utf8'),
    );
    assert.equal(await snarkjs.groth16.verify(vk, publicSignals, proof), true);
    const forged = [...publicSignals];
    forged[3] = String(BigInt(forged[3]) + 1n);
    assert.equal(
      await snarkjs.groth16.verify(vk, forged, proof),
      false,
      'Proof must bind the exact amount',
    );
  }
  const encoded = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  return ('0x' +
    encoded
      .match(/0x[0-9a-fA-F]+/g)
      .slice(0, 8)
      .map((w: string) => BigInt(w).toString(16).padStart(64, '0'))
      .join('')) as Hex;
}
function store(): VaultStore {
  let value: Envelope | undefined;
  return {
    read: async () => value,
    compareAndSet: async (expected, next) => {
      assert.equal(value?.revision ?? null, expected);
      value = structuredClone(next);
    },
  };
}

async function opened(text: string) {
  const note = importPrivateNote(text, d);
  const cache = store();
  const v = await Vault.openPrivateNote(cache, privateNoteCacheKey(note));
  await v.save({ ...v.data, notes: [note] });
  const c = new Controller(d, v, prover);
  await c.refresh();
  return { c, cache, note: c.vault.data.notes.find((n) => n.id === note.id)! };
}
async function settled(c: Controller, id: string) {
  for (let i = 0; i < 40; i++) {
    await c.refresh();
    const a = c.vault.data.attempts.find((a) => a.id === id)!;
    if (['confirmed', 'failed', 'conflict', 'expired'].includes(a.state)) return a;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const pending = c.vault.data.attempts.find((a) => a.id === id);
  console.error('Timed out waiting for transaction state:', pending?.state, pending?.hash, pending?.detail);
  throw new Error('Confirmation timeout');
}
const input = createPrivateNote(d, d.pool);
const inputFile = exportPrivateNote(input, d);
const inputStore = store();
const v = await Vault.openPrivateNote(inputStore, privateNoteCacheKey(input));
const c = new Controller(d, v, prover);
const local = await c.localTestWallet();
execFileSync(
  'cast',
  ['send', '--rpc-url', d.rpcUrl, '--private-key', FUNDER_KEY, '--value', '1ether', local.account],
  { stdio: 'pipe' },
);
const deposit = await c.deposit(local.wallet, local.account, input);
assert.equal((await settled(c, deposit.id)).state, 'confirmed');
console.log('PASS deposit with pre-saved portable note, no phrase');
await assert.rejects(() => c.deposit(local.wallet, local.account, input), /already used/);
const source = await opened(inputFile);
assert.equal(source.c.noteState(source.note), 'Available');
const output = createPrivateNote(d, d.outputPool);
const outputFile = exportPrivateNote(output, d); // This is the only output recovery material retained.
const request = source.c.rpc.request.bind(source.c.rpc);
source.c.rpc.request = async (method, params = []) => {
  const result = await request(method, params);
  if (method === 'eth_sendRawTransaction')
    throw new Error('Simulated lost RPC response after acceptance');
  return result as never;
};
const swap = await source.c.spend(source.note.id, 'swap', '', () => {}, undefined, output);
assert.equal(swap.state, 'unknown');
const reopened = await Vault.openPrivateNote(
  source.cache,
  privateNoteCacheKey(importPrivateNote(inputFile, d)),
);
assert.equal(reopened.data.attempts.find((a) => a.id === swap.id)!.state, 'unknown');
assert(reopened.data.attempts.find((a) => a.id === swap.id)!.raw);
assert.equal((await settled(new Controller(d, reopened, prover), swap.id)).state, 'confirmed');
console.log(
  'PASS uncertain accepted swap retains raw journal and reconciles after note-only cache reopen',
);
const recovered = await opened(outputFile);
assert.equal(recovered.c.noteState(recovered.note), 'Available');
assert(BigInt(recovered.note.amount!) > 0n);
assert.equal(exportPrivateNote(recovered.note, d), outputFile);
console.log('PASS fresh cache imports pre-swap output file and discovers actual amount');
const spent = await opened(inputFile);
assert.equal(spent.c.noteState(spent.note), 'Spent');
await assert.rejects(
  () =>
    spent.c.spend(
      spent.note.id,
      'swap',
      '',
      () => {},
      undefined,
      createPrivateNote(d, d.outputPool),
    ),
  /available note/,
);
// Prove a reverse swap, then move the market adversely before broadcast.
assert.equal(d.denomination, '0', 'Reverse swaps require variable WETH notes');
const reverseNote = createPrivateNote(d, d.pool, 'swap');
const reverseFile = exportPrivateNote(reverseNote, d);
const reverseQuote = await readiness(recovered.c.rpc, d, d.outputPool, recovered.note.amount!);
const balancesBefore = await Promise.all([
  readMarket(c.rpc, d.pool, 'accounted'),
  readMarket(c.rpc, d.outputPool, 'accounted'),
]);
let moved = false;
const moving = new Controller(d, recovered.c.vault, async (deployment, input) => {
  const proof = await prover(deployment, input);
  if (!moved) {
    moved = true;
    const reserves = await readMarket(c.rpc, d.pair, 'getReserves');
    const sold = 1000n * 10n ** 18n;
    const bought = amountOut(
      sold,
      reserves[d.wethIsToken0 ? 1 : 0],
      reserves[d.wethIsToken0 ? 0 : 1],
    );
    const send = (...args: string[]) =>
      execFileSync('cast', ['send', '--rpc-url', d.rpcUrl, '--private-key', FUNDER_KEY, ...args], {
        stdio: 'pipe',
      });
    send(d.token, 'transfer(address,uint256)', d.pair, String(sold));
    send(
      d.pair,
      'swap(uint256,uint256,address,bytes)',
      d.wethIsToken0 ? String(bought) : '0',
      d.wethIsToken0 ? '0' : String(bought),
      local.account,
      '0x',
    );
  }
  return proof;
});
const failedReverse = await moving.spend(
  recovered.note.id,
  'swap',
  '',
  () => {},
  undefined,
  reverseNote,
);
assert.equal((await settled(moving, failedReverse.id)).state, 'failed');
assert.equal(moving.noteState(recovered.note), 'Available');
assert.deepEqual(
  await Promise.all([
    readMarket(c.rpc, d.pool, 'accounted'),
    readMarket(c.rpc, d.outputPool, 'accounted'),
  ]),
  balancesBefore,
);
console.log('PASS reverse slippage reverts atomically and preserves hUSD input');
const returned = createPrivateNote(d, d.pool, 'swap');
const returnedFile = exportPrivateNote(returned, d);
const reverse = await moving.spend(recovered.note.id, 'swap', '', () => {}, undefined, returned);
assert.equal((await settled(moving, reverse.id)).state, 'confirmed');
const weth = await opened(returnedFile);
assert.equal(weth.c.noteState(weth.note), 'Available');
assert(BigInt(weth.note.amount!) > 0n);
assert.notEqual(weth.note.amount, d.defaultDepositAmount);
assert.equal(exportPrivateNote(weth.note, d), returnedFile);
const allowanceAbi = 'allowance(address,address)(uint256)';
for (const [token, owner, spender] of [
  [d.token, d.pool, d.outputPool],
  [d.weth, d.outputPool, d.pool],
  [d.token, d.outputPool, d.pair],
  [d.weth, d.pool, d.pair],
]) {
  const allowance = execFileSync(
    'cast',
    ['call', '--rpc-url', d.rpcUrl, token!, allowanceAbi, owner!, spender!],
    { encoding: 'utf8' },
  ).trim();
  assert.equal(BigInt(allowance), 0n);
}
console.log('PASS hUSD → WETH, fresh-file recovery and zero residual allowances');
// The returned variable WETH note must itself work as an exact-input swap.
const again = createPrivateNote(d, d.outputPool, 'swap');
const againFile = exportPrivateNote(again, d);
const forwardAgain = await weth.c.spend(weth.note.id, 'swap', '', () => {}, undefined, again);
assert.equal((await settled(weth.c, forwardAgain.id)).state, 'confirmed');
const last = await opened(againFile);
const beforeWithdrawal = await readMarket(c.rpc, d.token, 'balanceOf', [local.account]);
const withdrawal = await last.c.spend(last.note.id, 'withdraw', local.account, () => {});
assert.equal((await settled(last.c, withdrawal.id)).state, 'confirmed');
assert.equal(
  await readMarket(c.rpc, d.token, 'balanceOf', [local.account]),
  beforeWithdrawal + BigInt(last.note.amount!),
);
console.log('PASS returned variable WETH → hUSD → exact withdrawal');
const directInput = createPrivateNote(d, d.pool, 'deposit');
const directFile = exportPrivateNote(directInput, d);
const directDeposit = await c.deposit(local.wallet, local.account, directInput);
assert.equal((await settled(c, directDeposit.id)).state, 'confirmed');
const direct = await opened(directFile);
const directQuote = await readiness(direct.c.rpc, d, d.pool, direct.note.amount!);
const directExpected = BigInt(directQuote.quote);
const directMinimum = minimumOutput(directExpected, 50);
const recipientBeforeDirect = await readMarket(c.rpc, d.token, 'balanceOf', [local.account]);
const outputPoolBeforeDirect = await readMarket(c.rpc, d.outputPool, 'accounted');
const swapAndWithdraw = await direct.c.spend(
  direct.note.id,
  'swap-withdraw',
  local.account,
  () => {},
  {
    expected: directExpected.toString(),
    minimum: directMinimum.toString(),
    quotedAt: directQuote.checkedAt,
  },
);
console.log('Direct swap-and-withdraw submitted as', swapAndWithdraw.state, swapAndWithdraw.hash);
assert.equal((await settled(direct.c, swapAndWithdraw.id)).state, 'confirmed');
const receivedDirect =
  (await readMarket(c.rpc, d.token, 'balanceOf', [local.account])) - recipientBeforeDirect;
assert(receivedDirect >= directMinimum);
assert.equal(await readMarket(c.rpc, d.outputPool, 'accounted'), outputPoolBeforeDirect);
assert.equal(direct.c.noteState(direct.note), 'Spent');
console.log('PASS swap and withdraw sends output to recipient atomically without minting an output note');
writeFileSync(
  'deployments/bidirectional-evidence.json',
  JSON.stringify(
    {
      deployment: d.id,
      deposit: deposit.hash,
      swap: swap.hash,
      failedReverse: failedReverse.hash,
      reverse: reverse.hash,
      forwardAgain: forwardAgain.hash,
      returnedWeth: weth.note.amount,
      withdrawal: withdrawal.hash,
      swapAndWithdraw: swapAndWithdraw.hash,
      outputAmount: recovered.note.amount,
      checks: [
        'portable deposit',
        'lost response journal recovered with input note',
        'duplicate deposit rejected',
        'fresh-file swap',
        'pre-swap file recovers actual output',
        'spent input rejected',
        'reverse slippage atomic revert',
        'reverse swap and fresh-file WETH recovery',
        'zero remaining pool and exchange allowances',
        'variable WETH reswap',
        'fresh-file withdrawal',
        'swap output sent directly to recipient with minimum-output protection',
        'direct swap does not create an output note or credit the output pool',
        'spent output reconciled',
      ],
    },
    null,
    2,
  ),
);

process.exit(0);
