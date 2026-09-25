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
const withdrawal = await recovered.c.spend(recovered.note.id, 'withdraw', local.account, () => {});
assert.equal((await settled(recovered.c, withdrawal.id)).state, 'confirmed');
const after = await opened(outputFile);
assert.equal(after.c.noteState(after.note), 'Spent');
console.log('PASS withdraw from imported output file; both spent notes rejected/reconciled');
writeFileSync(
  'deployments/private-note-evidence.json',
  JSON.stringify(
    {
      deployment: d.id,
      deposit: deposit.hash,
      swap: swap.hash,
      withdrawal: withdrawal.hash,
      outputAmount: recovered.note.amount,
      checks: [
        'portable deposit',
        'lost response journal recovered with input note',
        'duplicate deposit rejected',
        'fresh-file swap',
        'pre-swap file recovers actual output',
        'spent input rejected',
        'fresh-file withdrawal',
        'spent output reconciled',
      ],
    },
    null,
    2,
  ),
);

process.exit(0);
