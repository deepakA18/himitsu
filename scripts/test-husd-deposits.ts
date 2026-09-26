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
    const vk = JSON.parse(readFileSync('packages/protocol/circuits/v2/verification_key.json', 'utf8'));
    assert.deepEqual(vk, await snarkjs.zKey.exportVerificationKey('packages/protocol/circuits/v2/spend-v2.zkey'), 'Verifier bundle must match proving key');
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
    if (['confirmed', 'failed', 'conflict', 'expired'].includes(a.state)) {
      if (a.state === 'confirmed' && a.kind !== 'deposit') {
        assert(a.raw?.startsWith('0x06'), 'Private spend must serialize as EIP-8141');
        const mined = await c.rpc.request<{ type: Hex }>('eth_getTransactionByHash', [a.hash]);
        assert.equal(BigInt(mined.type), 6n, 'Mined private spend must be type 0x06');
      }
      return a;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const pending = c.vault.data.attempts.find((a) => a.id === id);
  console.error('Timed out waiting for transaction state:', pending?.state, pending?.hash, pending?.detail);
  throw new Error('Confirmation timeout');
}

assert.equal(d.noteVersion, 2);
const initial = createPrivateNote(d, d.outputPool, 'token-deposit', '100000000000000000000');
const vault = await Vault.openPrivateNote(store(), privateNoteCacheKey(initial));
const c = new Controller(d, vault, prover);
const local = await c.localTestWallet();
const send = (...args: string[]) => execFileSync('cast', ['send', '--rpc-url', d.rpcUrl, '--private-key', FUNDER_KEY, ...args], { stdio: 'pipe' });
send('--value', '1ether', local.account);
send(d.token, 'transfer(address,uint256)', local.account, '300000000000000000000');
const hashes: Record<string, string> = {};
async function depositHusd(note = createPrivateNote(d, d.outputPool, 'token-deposit', '100000000000000000000')) {
  const file = exportPrivateNote(note, d);
  const before = await readMarket(c.rpc, d.outputPool, 'accounted');
  const a = await c.deposit(local.wallet, local.account, note, console.log);
  if (a.state === 'failed') throw new Error(a.detail);
  assert.equal((await settled(c, a.id)).state, 'confirmed');
  assert.equal(await readMarket(c.rpc, d.outputPool, 'accounted'), before + BigInt(note.amount!));
  assert.equal(BigInt(execFileSync('cast', ['call', '--rpc-url', d.rpcUrl, d.token, 'allowance(address,address)(uint256)', local.account, d.outputPool], { encoding: 'utf8' }).trim()), 0n);
  const recovered = await opened(file);
  assert.equal(recovered.c.noteState(recovered.note), 'Available');
  assert.equal(recovered.note.amount, note.amount);
  assert.equal(recovered.note.commitment, note.commitment);
  hashes['deposit' + Object.keys(hashes).length] = a.hash!;
  console.log('PASS exact hUSD deposit, zero remaining pool allowance and fresh-file recovery');
  return recovered;
}
const first = await depositHusd(initial);
const tokenBefore = await readMarket(c.rpc, d.token, 'balanceOf', [local.account]);
const withdraw = await first.c.spend(first.note.id, 'withdraw', local.account, console.log);
assert.equal((await settled(first.c, withdraw.id)).state, 'confirmed');
assert.equal(await readMarket(c.rpc, d.token, 'balanceOf', [local.account]), tokenBefore + BigInt(first.note.amount!));
hashes.withdraw = withdraw.hash!;
console.log('PASS hUSD deposit → native 0x06 withdrawal');
const second = await depositHusd();
const output = createPrivateNote(d, d.pool, 'swap');
const outputFile = exportPrivateNote(output, d);
const swap = await second.c.spend(second.note.id, 'swap', '', console.log, undefined, output);
assert.equal((await settled(second.c, swap.id)).state, 'confirmed');
const weth = await opened(outputFile);
assert.equal(weth.c.noteState(weth.note), 'Available');
const wethBefore = await readMarket(c.rpc, d.weth, 'balanceOf', [local.account]);
const out = await weth.c.spend(weth.note.id, 'withdraw', local.account, console.log);
assert.equal((await settled(weth.c, out.id)).state, 'confirmed');
assert.equal(await readMarket(c.rpc, d.weth, 'balanceOf', [local.account]), wethBefore + BigInt(weth.note.amount!));
hashes.swap = swap.hash!;
hashes.wethWithdraw = out.hash!;
console.log('PASS hUSD deposit → native swap → WETH note recovery → native withdrawal');
const third = await depositHusd();
const beforeDirect = await readMarket(c.rpc, d.weth, 'balanceOf', [local.account]);
const direct = await third.c.spend(third.note.id, 'swap-withdraw', local.account, console.log);
assert.equal((await settled(third.c, direct.id)).state, 'confirmed');
assert((await readMarket(c.rpc, d.weth, 'balanceOf', [local.account])) > beforeDirect);
hashes.direct = direct.hash!;
console.log('PASS hUSD deposit → native direct swap-and-withdraw');
writeFileSync('.local/husd-deposit-evidence.json', JSON.stringify({ deployment: d.id, hashes }, null, 2));
process.exit(0);
