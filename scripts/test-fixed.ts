import { encodeFunctionData, parseAbi } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { readMarket, amountOut, readiness } from '../packages/client/src/market';
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
  throw new Error('Confirmation timeout');
}

assert.equal(d.mode, 'fixed');
assert.equal(d.denomination, '100000000000000000');
assert.equal(
  await readMarket(
    new Controller(d, await Vault.openPrivateNote(store(), privateNoteCacheKey(createPrivateNote(d, d.pool))), prover).rpc,
    d.pool,
    'denomination',
  ),
  BigInt(d.denomination),
);
const seed = createPrivateNote(d, d.pool);
const c = new Controller(
  d,
  await Vault.openPrivateNote(store(), privateNoteCacheKey(seed)),
  prover,
);
const local = await c.localTestWallet();
execFileSync(
  'cast',
  ['send', '--rpc-url', d.rpcUrl, '--private-key', FUNDER_KEY, '--value', '1ether', local.account],
  { stdio: 'pipe' },
);
const abi = parseAbi([
  'function depositETH(bytes32)',
  'function validateSpend(bytes32,bytes32,address,uint256)',
]);
for (const amount of [0n, 90000000000000000n, 110000000000000000n]) {
  await assert.rejects(() =>
    c.rpc.request('eth_call', [
      {
        from: local.account,
        to: d.pool,
        value: '0x' + amount.toString(16),
        data: encodeFunctionData({ abi, functionName: 'depositETH', args: [seed.commitment] }),
      },
      'latest',
    ]),
  );
}
const deposits: string[] = [],
  files: string[] = [];
for (let i = 0; i < 3; i++) {
  const note = createPrivateNote(d, d.pool);
  const file = exportPrivateNote(note, d);
  const attempt = await c.deposit(local.wallet, local.account, note);
  assert.equal((await settled(c, attempt.id)).state, 'confirmed');
  deposits.push(attempt.hash!);
  files.push(file);
}
assert.equal(await readMarket(c.rpc, d.pool, 'accounted'), 3n * BigInt(d.denomination));
console.log('PASS three equal 0.1 ETH deposits; wrong denominations rejected');
const withdrawals: string[] = [];
for (const file of files) {
  const recovered = await opened(file);
  assert.equal(recovered.note.amount, d.denomination);
  assert.equal(recovered.c.noteState(recovered.note), 'Available');
  await assert.rejects(
    () => recovered.c.spend(recovered.note.id, 'swap', '', () => {}),
    /withdrawals only/,
  );
  const recipient = privateKeyToAccount(generatePrivateKey()).address;
  assert.equal(await c.rpc.request('eth_getBalance', [recipient, 'latest']), '0x0');
  const badAmount = encodeFunctionData({
    abi,
    functionName: 'validateSpend',
    args: [seed.commitment, recovered.note.nullifierHash, recipient, BigInt(d.denomination) + 1n],
  });
  await assert.rejects(() =>
    c.rpc.request('eth_call', [{ to: d.pool, data: badAmount }, 'latest']),
  );
  const attempt = await recovered.c.spend(recovered.note.id, 'withdraw', recipient, () => {});
  assert.equal((await settled(recovered.c, attempt.id)).state, 'confirmed');
  assert.equal(await readMarket(c.rpc, d.weth, 'balanceOf', [recipient]), BigInt(d.denomination));
  assert.equal(await c.rpc.request('eth_getBalance', [recipient, 'latest']), '0x0');
  const spent = await opened(file);
  assert.equal(spent.c.noteState(spent.note), 'Spent');
  await assert.rejects(
    () => spent.c.spend(spent.note.id, 'withdraw', recipient, () => {}),
    /available note/,
  );
  withdrawals.push(attempt.hash!);
}
assert.equal(await readMarket(c.rpc, d.pool, 'accounted'), 0n);
console.log(
  'PASS note-only recovery; three exact WETH withdrawals to unfunded fresh addresses; spent notes rejected',
);
writeFileSync(
  'deployments/fixed-evidence.json',
  JSON.stringify(
    {
      deployment: d.id,
      denomination: d.denomination,
      deposits,
      withdrawals,
      checks: [
        'wrong deposit amounts rejected',
        'equal denominations',
        'fresh note-file recovery',
        'swaps disabled',
        'wrong spend amounts rejected',
        'exact withdrawals to unfunded recipients',
        'double spend rejected',
        'backing reconciled',
      ],
    },
    null,
    2,
  ) + '\n',
);
process.exit(0);
