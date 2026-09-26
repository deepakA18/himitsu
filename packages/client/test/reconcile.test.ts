import { expect, test } from 'bun:test';
import { reconcileAttempt, type AttemptEvidence } from '../src/chain';
import type { Attempt } from '../src/vault';
const attempt: Attempt = {
  id: 'a',
  deployment: 'test',
  kind: 'swap',
  source: 'in',
  output: 'out',
  sender: `0x${'11'.repeat(20)}`,
  nonce: '4',
  deadline: '1000',
  state: 'unknown',
  createdAt: 0,
};
const base: AttemptEvidence = {
  spent: false,
  outputPresent: false,
  nonce: 4n,
  timestamp: 900n,
  depositPresent: true,
};
test('missing receipt with unchanged nonce keeps a note reserved', () =>
  expect(reconcileAttempt(attempt, base).state).toBe('unknown'));
test('canonical nonce consumption releases only unspent note for explicit retry', () =>
  expect(reconcileAttempt(attempt, { ...base, nonce: 5n }).state).toBe('conflict'));
test('expiry must pass on confirmed chain, not the wall clock', () => {
  expect(reconcileAttempt(attempt, { ...base, timestamp: 1000n }).state).toBe('unknown');
  expect(reconcileAttempt(attempt, { ...base, timestamp: 1001n }).state).toBe('expired');
});
test('receipt waits for confirmations and requires note settlement', () => {
  expect(
    reconcileAttempt(attempt, { ...base, receipt: { success: true, confirmed: false } }).state,
  ).toBe('mined');
  expect(
    reconcileAttempt(attempt, { ...base, receipt: { success: true, confirmed: true } }).state,
  ).toBe('unknown');
  expect(
    reconcileAttempt(attempt, {
      ...base,
      spent: true,
      outputPresent: true,
      receipt: { success: true, confirmed: true },
    }).state,
  ).toBe('confirmed');
});
test('swap and withdraw confirms without an output note when input is spent', () => {
  const directAttempt: Attempt = { ...attempt, kind: 'swap-withdraw' };
  delete directAttempt.output;
  expect(
    reconcileAttempt(
      directAttempt,
      { ...base, spent: true, receipt: { success: true, confirmed: true } },
    ).state,
  ).toBe('confirmed');
});
test('confirmed revert makes unspent input recoverable', () =>
  expect(
    reconcileAttempt(attempt, { ...base, receipt: { success: false, confirmed: true } }).state,
  ).toBe('failed'));
test('reorg reopens previously confirmed transaction instead of trusting cached success', () =>
  expect(reconcileAttempt({ ...attempt, state: 'confirmed' }, base).state).toBe('unknown'));
test('deposit without wallet hash is recovered by commitment event', () =>
  expect(reconcileAttempt({ ...attempt, kind: 'deposit' }, base).state).toBe('confirmed'));
