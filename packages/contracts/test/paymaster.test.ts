import { expect, test } from 'bun:test';
import { buildPaymaster, SPONSOR_CALLDATA, type SponsorPolicy } from '../src/paymaster';
import { hexToBytes, type Hex } from 'viem';

const pool = `0x${'11'.repeat(20)}` as Hex;
const sponsor = `0x${'22'.repeat(20)}` as Hex;
const policy: SponsorPolicy = {
  chainId: 9n, pools: [{ address: pool, verifySelector: '0x12345678', verifyCalldataBytes: 4, executeSelector: '0xabcdef01', executeCalldataBytes: 4 }],
  expiryVerifier: '0x0000000000000000000000000000000000008141',
  maxTransactionCost: 1000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 2n, proofBytes: 256,
  budgets: Array.from({ length: 4 }, () => ({ execution: { min: 100n, max: 500000n }, state: { min: 0n, max: 500000n } })) as SponsorPolicy['budgets'],
};
function context() {
  return {
    data: SPONSOR_CALLDATA as Hex, caller: 0xaan, chain: 9n,
    tx: new Map([[0, 6n], [2, BigInt(pool)], [3, 1n], [4, 10n], [5, 0n], [6, 900n], [7, 0n], [9, 4n], [10, 2n], [11, 1n]]),
    frames: [
      [BigInt(policy.expiryVerifier), 1000n, 1n, 0n, 8n, 1n],
      [BigInt(pool), 300000n, 1n, 2n, 4n, 1n],
      [BigInt(sponsor), 20000n, 1n, 1n, 4n, 0n],
      [BigInt(pool), 300000n, 2n, 0n, 4n, 0n],
    ],
  };
}
/** Limited policy-control-flow interpreter. Not an EVM, gas meter, or native admission test. */
function evaluate(ctx: ReturnType<typeof context>): 'fund' | 'pay' | 'reject' {
  const code = hexToBytes(buildPaymaster(policy).runtime), stack: bigint[] = [];
  const pop = () => { const n = stack.pop(); if (n === undefined) throw new Error('Stack underflow'); return n; };
  let pc = 0;
  for (let steps = 0; steps < 10000; steps++) {
    const op = code[pc++]!;
    if (op >= 0x60 && op <= 0x7f) {
      let n = 0n; for (let j = 0; j < op - 0x5f; j++) n = n * 256n + BigInt(code[pc++]!);
      stack.push(n); continue;
    }
    switch (op) {
      case 0x00: return 'fund';
      case 0xfd: return 'reject';
      case 0x5b: break;
      case 0x36: stack.push(BigInt((ctx.data.length - 2) / 2)); break;
      case 0x35: pop(); stack.push(BigInt(ctx.data.padEnd(66, '0'))); break;
      case 0x34: stack.push(0n); break;
      case 0x33: stack.push(ctx.caller); break;
      case 0x30: stack.push(BigInt(sponsor)); break;
      case 0x46: stack.push(ctx.chain); break;
      case 0x14: stack.push(pop() === pop() ? 1n : 0n); break;
      case 0x15: stack.push(pop() === 0n ? 1n : 0n); break;
      case 0x16: stack.push(pop() & pop()); break;
      case 0x10: { const x = pop(), y = pop(); stack.push(x < y ? 1n : 0n); break; }
      case 0x11: { const x = pop(), y = pop(); stack.push(x > y ? 1n : 0n); break; }
      case 0x1c: { const shift = pop(), value = pop(); stack.push(value >> shift); break; }
      case 0x57: { const target = Number(pop()), yes = pop(); if (yes) { if (code[target] !== 0x5b) throw new Error('Bad jump'); pc = target; } break; }
      case 0xb0: { const key = Number(pop()); const value = ctx.tx.get(key); if (value === undefined) throw new Error('Unknown TXPARAM'); stack.push(value); break; }
      case 0xb3: { const i = Number(pop()), key = Number(pop()); stack.push(key === 8 || key === 9 ? 0n : ctx.frames[i]![key]!); break; }
      case 0xb4: { pop(); const key = pop(); stack.push(key === 3n ? 256n : 0n); break; }
      case 0xb1: { pop(); const index = pop(); stack.push(BigInt(index === 1n ? '0x12345678' : '0xabcdef01') << 224n); break; }
      case 0xaa: expect(pop()).toBe(0n); expect(pop()).toBe(0n); expect(pop()).toBe(1n); return 'pay';
      default: throw new Error(`Unexpected opcode ${op.toString(16)}`);
    }
  }
  throw new Error('Step limit');
}
test('funding path does not invoke native transaction context', () => {
  const ctx = context(); ctx.data = '0x'; ctx.tx.clear(); expect(evaluate(ctx)).toBe('fund');
});
test('supported layout approves payment only', () => expect(evaluate(context())).toBe('pay'));
test.each(['cost', 'fee', 'extra-frame', 'wrong-current-frame', 'blob', 'extra-signature', 'untrusted-pool', 'caller', 'chain', 'unapproved-pool', 'external-execution', 'atomic-swap', 'low-budget'])('rejects %s', attack => {
  const c = context();
  if (attack === 'cost') c.tx.set(6, 1001n);
  if (attack === 'fee') c.tx.set(4, 11n);
  if (attack === 'extra-frame') c.tx.set(9, 5n);
  if (attack === 'wrong-current-frame') c.tx.set(10, 1n);
  if (attack === 'blob') c.tx.set(7, 1n);
  if (attack === 'extra-signature') c.tx.set(11, 2n);
  if (attack === 'untrusted-pool') { c.tx.set(2, 99n); c.frames[1]![0] = 99n; c.frames[3]![0] = 99n; }
  if (attack === 'caller') c.caller = 1n;
  if (attack === 'chain') c.chain = 1n;
  if (attack === 'unapproved-pool') c.frames[1]![5] = 0n;
  if (attack === 'external-execution') c.frames[3]![0] = 99n;
  if (attack === 'atomic-swap') c.frames[3]![3] = 4n;
  if (attack === 'low-budget') c.frames[3]![1] = 99n;
  expect(evaluate(c)).toBe('reject');
});
test('creation prefix returns the full runtime at byte offset 15', () => {
  const artifact = buildPaymaster(policy);
  expect(artifact.initCode.slice(32)).toBe(artifact.runtime.slice(2));
  expect(Number.parseInt(artifact.initCode.slice(4, 8), 16)).toBe((artifact.runtime.length - 2) / 2);
});
