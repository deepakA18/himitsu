import { readiness, readMarket, amountOut } from '../packages/client/src/market';
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
  throw new Error(
    'Reconciliation did not settle: ' +
      JSON.stringify(c.vault.data.attempts.find((a) => a.id === id)),
  );
}

assert.equal(d.noteVersion, 2, 'Market regression requires the v2 deployment');
const { c, local } = await client();
await settled(c, c.vault.data.attempts[0]!.id);
const note = c.vault.data.notes.find((n) => n.id === c.vault.data.attempts[0]!.source)!;
const initial = await readiness(c.rpc, d);
const call = (...args: string[]) =>
  execFileSync('cast', ['send', '--rpc-url', d.rpcUrl, '--private-key', FUNDER_KEY, ...args], {
    stdio: 'pipe',
  });
let moved = false;
const moving = new Controller(d, c.vault, async (deployment, input) => {
  const proof = await prover(deployment, input);
  if (!moved) {
    moved = true;
    // A different trader moves the price AFTER our quote/proof, before broadcast.
    const reserves = await readMarket(c.rpc, d.pair, 'getReserves');
    const output = amountOut(
      1000000000000000000n,
      reserves[d.wethIsToken0 ? 0 : 1],
      reserves[d.wethIsToken0 ? 1 : 0],
    );
    call('--value', '1ether', d.weth, 'deposit()');
    call(d.weth, 'transfer(address,uint256)', d.pair, '1000000000000000000');
    call(
      d.pair,
      'swap(uint256,uint256,address,bytes)',
      d.wethIsToken0 ? '0' : String(output),
      d.wethIsToken0 ? String(output) : '0',
      local.account,
      '0x',
    );
  }
  return proof;
});
const accountedBefore = await readMarket(c.rpc, d.pool, 'accounted');
const outputBefore = await readMarket(c.rpc, d.outputPool, 'accounted');
const indexBefore = await readMarket(c.rpc, d.outputPool, 'nextIndex');
const failed = await moving.spend(note.id, 'swap', local.account, () => {});
assert.equal((await settled(moving, failed.id)).state, 'failed');
assert.equal(moving.noteState(note), 'Available');
assert.equal(await readMarket(c.rpc, d.pool, 'accounted'), accountedBefore);
assert.equal(await readMarket(c.rpc, d.outputPool, 'accounted'), outputBefore);
assert.equal(await readMarket(c.rpc, d.outputPool, 'nextIndex'), indexBefore);
const quote = await readiness(c.rpc, d);
assert.ok(BigInt(quote.quote) < BigInt(initial.quote));
const success = await moving.spend(note.id, 'swap', local.account, () => {});
assert.equal((await settled(moving, success.id)).state, 'confirmed');
const output = moving.vault.data.notes.find((n) => n.id === success.output)!;
assert.equal(output.amount, quote.quote, 'Entire live quote must become a private output note');
assert.equal(
  await readMarket(c.rpc, d.outputPool, 'accounted'),
  outputBefore + BigInt(output.amount!),
);
assert.equal(
  await readMarket(c.rpc, d.token, 'balanceOf', [d.pool]),
  0n,
  'No output dust may remain in input pool',
);
const restored = new Controller(
  d,
  await Vault.restorePhrase(
    store(),
    'market test recovery password',
    moving.vault.data.recovery!.phrase,
  ),
  prover,
);
await restored.refresh();
assert.equal(restored.vault.data.notes.length, 2);
const recovered = restored.vault.data.notes.find(
  (n) => n.amount === output.amount && n.pool === d.outputPool,
)!;
assert.equal(restored.noteState(recovered), 'Available');
const before = await readMarket(c.rpc, d.token, 'balanceOf', [local.account]);
const withdrawal = await restored.spend(recovered.id, 'withdraw', local.account, () => {});
assert.equal((await settled(restored, withdrawal.id)).state, 'confirmed');
assert.equal(
  await readMarket(c.rpc, d.token, 'balanceOf', [local.account]),
  before + BigInt(output.amount!),
);
// Read-only fault injection checks client gating without draining shared test funding.
const original = c.rpc.request.bind(c.rpc);
c.rpc.request = async function <T>(method: string, params: unknown[] = []): Promise<T> {
  return method === 'eth_getBalance' ? ('0x0' as T) : original<T>(method, params);
};
const unfunded = await readiness(c.rpc, d);
assert.ok(unfunded.swapIssues.includes('Paymaster needs more ETH'));
assert.ok(unfunded.withdrawalIssues.includes('Paymaster needs more ETH'));
c.rpc.request = original;
const summary = {
  deployment: d.id,
  slippageReverted: true,
  inputPreserved: true,
  outputNotCreatedOnFailure: true,
  fullOutputRecovered: output.amount,
  withdrawalExact: true,
  insufficientFundingDetected: true,
  failedTransaction: failed.hash,
  successfulSwap: success.hash,
  withdrawal: withdrawal.hash,
};
writeFileSync('.local/evidence/market-v2.json', JSON.stringify(summary, null, 2));
console.log(summary);
process.exit(0);
