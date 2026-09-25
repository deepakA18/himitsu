import { deriveNote, recoveryKey } from '../packages/client/src/recovery';
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
const d = JSON.parse(readFileSync(process.env.DEPLOYMENT_FILE ?? 'app/public/deployment.json', 'utf8')) as Deployment;
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
async function client() {
  const v = await Vault.open(store(), 'native integration test vault');
  await v.confirmRecovery(v.data.recovery!.phrase);
  // Persist abandoned drafts: recovery must not stop at empty counter gaps.
  const key = await recoveryKey(v.data.recovery!.phrase);
  await v.save({
    ...v.data,
    notes: [await deriveNote(key, d.id, d.pool, 31), await deriveNote(key, d.id, d.outputPool, 63)],
  });
  const c = new Controller(d, v, prover);
  const local = await c.localTestWallet();
  execFileSync(
    'cast',
    [
      'send',
      '--rpc-url',
      d.rpcUrl,
      '--private-key',
      FUNDER_KEY,
      '--value',
      '1ether',
      local.account,
    ],
    { stdio: 'pipe' },
  );
  const deposit = await c.deposit(local.wallet, local.account);
  assert.equal(deposit.state, 'submitted');
  return { c, local };
}
async function settled(c: Controller, id: string) {
  for (let i = 0; i < 20; i++) {
    await c.refresh();
    const a = c.vault.data.attempts.find((a) => a.id === id)!;
    if (['confirmed', 'conflict', 'failed', 'expired'].includes(a.state)) return a;
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error('Reconciliation did not settle: ' + JSON.stringify(c.vault.data.attempts.find(a => a.id === id)));
}
const a = await client(),
  b = await client();
await settled(a.c, a.c.vault.data.attempts[0]!.id);
await settled(b.c, b.c.vault.data.attempts[0]!.id);
const aNote = a.c.vault.data.notes.find((n) => n.id === a.c.vault.data.attempts[0]!.source)!,
  bNote = b.c.vault.data.notes.find((n) => n.id === b.c.vault.data.attempts[0]!.source)!;
let release!: () => void, arrived!: () => void;
const paused = new Promise<void>((r) => (arrived = r)),
  gate = new Promise<void>((r) => (release = r));
const originalA = a.c.rpc.request.bind(a.c.rpc);
a.c.rpc.request = async function <T>(method: string, params: unknown[] = []): Promise<T> {
  if (method === 'eth_sendRawTransaction') {
    arrived();
    await gate;
  }
  return originalA<T>(method, params);
};
const waiting = a.c.spend(aNote.id, 'withdraw', a.local.account, () => {});
await paused;
const first = await b.c.spend(bNote.id, 'withdraw', b.local.account, () => {});
assert.equal((await settled(b.c, first.id)).state, 'confirmed');
release();
const loser = await waiting;
assert.equal(loser.state, 'unknown');
assert.equal((await settled(a.c, loser.id)).state, 'conflict');
assert.equal(a.c.noteState(aNote), 'Available');
// Explicit retry after canonical nonce conflict, with a deliberately lost RPC response.
a.c.rpc.request = async function <T>(method: string, params: unknown[] = []): Promise<T> {
  const result = await originalA<T>(method, params);
  if (method === 'eth_sendRawTransaction')
    throw new Error('Simulated lost response after real acceptance');
  return result;
};
const retry = await a.c.spend(aNote.id, 'swap', a.local.account, () => {});
assert.equal(retry.state, 'unknown');
assert.equal(a.c.noteState(aNote), 'Reserved');
const confirmed = await settled(a.c, retry.id);
assert.equal(confirmed.state, 'confirmed');
assert.equal(a.c.noteState(aNote), 'Spent');
const output = a.c.vault.data.notes.find((n) => n.id === confirmed.output)!;
assert.equal(a.c.noteState(output), 'Available');
const restored = await Vault.restorePhrase(
  store(),
  'a completely new local password',
  a.c.vault.data.recovery!.phrase,
);
const recovered = new Controller(d, restored, prover);
await recovered.refresh();
assert.equal(
  restored.data.notes.length,
  2,
  'Only mined notes should be recovered across counter gaps',
);
assert.equal(restored.data.attempts.length, 0);
assert.equal(restored.data.testWalletKey, undefined);
const recoveredInput = restored.data.notes.find((n) => n.commitment === aNote.commitment)!;
const recoveredOutput = restored.data.notes.find((n) => n.commitment === output.commitment)!;
assert.equal(recoveredInput.recovery!.counter, 32);
assert.equal(recoveredOutput.recovery!.counter, 64);
assert.equal(recovered.noteState(recoveredInput), 'Spent');
assert.equal(recovered.noteState(recoveredOutput), 'Available');
const outputWithdrawal = await recovered.spend(
  recoveredOutput.id,
  'withdraw',
  a.local.account,
  () => {},
);
assert.equal((await settled(recovered, outputWithdrawal.id)).state, 'confirmed');
const summary = {
  deployment: d.id,
  nonceConflict: true,
  lostResponseRecovered: true,
  outputNoteRecovered: true,
  withdrawalConfirmed: true,
  noteVersion: d.noteVersion ?? 1,
  recoveredOutputAmount: recoveredOutput.amount ?? d.outputDenomination,
  amountBindingVerified: d.noteVersion === 2,
  phraseRestoreWithNewPassword: true,
  counterGapRecovery: [32, 64],
  transactions: [loser.hash, first.hash, retry.hash, outputWithdrawal.hash],
};
writeFileSync('.local/evidence/client-reconciliation.json', JSON.stringify(summary, null, 2));
console.log(summary);
process.exit(0);
