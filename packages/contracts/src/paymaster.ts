import { bytesToHex, keccak256, type Hex } from 'viem';
import { assertHex, SPEC_COMMIT } from '../../frame-codec/src/index';

export const SPONSOR_CALLDATA = '0x48494d49' as const;
export interface Bounds { min: bigint; max: bigint }
export interface PoolPolicy {
  address: Hex;
  verifySelector: Hex;
  verifyCalldataBytes: number;
  executeSelector: Hex;
  executeCalldataBytes: number;
  additionalExecutions?: { selector: Hex; calldataBytes: number }[];
}
export interface SponsorPolicy {
  chainId: bigint;
  pools: PoolPolicy[];
  expiryVerifier: Hex;
  maxTransactionCost: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  proofBytes: number;
  // Exactly four frames: expiry, pool verification, sponsorship, pool execution.
  budgets: [FrameBudget, FrameBudget, FrameBudget, FrameBudget];
}
export interface FrameBudget { execution: Bounds; state: Bounds }

class Assembler {
  bytes: number[] = [];
  labels = new Map<string, number>();
  fixups: { offset: number; label: string }[] = [];
  op(...bytes: number[]) { this.bytes.push(...bytes); return this; }
  push(value: bigint | number) {
    const n = BigInt(value);
    if (n < 0n || n >= 1n << 256n) throw new Error('PUSH outside uint256');
    let hex = n.toString(16); if (hex.length % 2) hex = `0${hex}`;
    const bytes = Array.from({ length: hex.length / 2 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
    return this.op(0x5f + bytes.length, ...bytes);
  }
  label(name: string) { this.labels.set(name, this.bytes.length); return this.op(0x5b); }
  jumpIf(label: string) { this.op(0x61); this.fixups.push({ offset: this.bytes.length, label }); return this.op(0, 0, 0x57); }
  finish(): Hex {
    for (const f of this.fixups) {
      const pc = this.labels.get(f.label);
      if (pc === undefined || pc > 65535) throw new Error('Invalid jump label');
      this.bytes[f.offset] = pc >> 8; this.bytes[f.offset + 1] = pc & 255;
    }
    return bytesToHex(new Uint8Array(this.bytes));
  }
}

/** Emits immutable policy bytecode for the PINNED Ethrex fork, not standard-EVM Solidity.
 * Trust assumption: pinned pools are non-upgradeable and enforce proof + full action policy.
 * No deploy/fund side effects. Native regression: packages/protocol/automatic-roundtrip.mjs.
 */
export function buildPaymaster(policy: SponsorPolicy) {
  if (policy.pools.length < 1 || policy.pools.length > 8) throw new Error('Expected 1–8 trusted pools');
  assertHex(policy.expiryVerifier, 20);
  for (const value of [policy.chainId, policy.maxTransactionCost, policy.maxFeePerGas, policy.maxPriorityFeePerGas]) {
    if (value < 0n || value >= 1n << 256n) throw new Error('Invalid policy integer');
  }
  if (policy.maxTransactionCost === 0n || policy.maxFeePerGas === 0n || policy.maxPriorityFeePerGas > policy.maxFeePerGas) throw new Error('Invalid fee caps');
  if (!Number.isSafeInteger(policy.proofBytes) || policy.proofBytes < 1) throw new Error('Invalid proof length');
  const addresses = new Set<string>();
  for (const p of policy.pools) {
    assertHex(p.address, 20); assertHex(p.verifySelector, 4); assertHex(p.executeSelector, 4);
    if (BigInt(p.address) === 0n || addresses.has(p.address.toLowerCase())) throw new Error('Invalid or duplicate pool');
    addresses.add(p.address.toLowerCase());
    for (const size of [p.verifyCalldataBytes, p.executeCalldataBytes]) if (!Number.isSafeInteger(size) || size < 4) throw new Error('Invalid calldata length');
    for (const extra of p.additionalExecutions ?? []) {
      assertHex(extra.selector, 4);
      if (!Number.isSafeInteger(extra.calldataBytes) || extra.calldataBytes < 4) throw new Error('Invalid calldata length');
    }
  }
  if (policy.budgets.length !== 4) throw new Error('Four budgets required');
  for (const b of policy.budgets) for (const bounds of [b.execution, b.state]) {
    if (bounds.min < 0n || bounds.max < bounds.min || bounds.max >= 1n << 64n) throw new Error('Invalid gas bounds');
  }
  const a = new Assembler();
  const tx = (key: number) => { a.push(key).op(0xb0); };
  const frame = (i: number, key: number) => { a.push(key).push(i).op(0xb3); };
  const eq = (value: bigint | number) => { a.push(value).op(0x14, 0x15).jumpIf('reject'); };
  const equal = () => { a.op(0x14, 0x15).jumpIf('reject'); };
  const upper = (read: () => void, max: bigint) => { a.push(max); read(); a.op(0x11).jumpIf('reject'); };
  const lower = (read: () => void, min: bigint) => { a.push(min); read(); a.op(0x10).jumpIf('reject'); };
  const selector = (i: number, value: Hex) => { a.push(i).push(0).op(0xb1).push(224).op(0x1c); eq(BigInt(value)); };

  // Ordinary ETH funding is accepted without invoking frame-only opcodes.
  a.op(0x36, 0x15).jumpIf('fund');
  a.op(0x36); eq(4); a.push(0).op(0x35).push(224).op(0x1c); eq(BigInt(SPONSOR_CALLDATA));
  a.op(0x34); eq(0); a.op(0x33); eq(0xaan); a.op(0x46); eq(policy.chainId);
  tx(0); eq(6); tx(9); eq(4); tx(10); eq(2); tx(11); eq(1);
  tx(7); eq(0); tx(5); eq(0);
  upper(() => tx(6), policy.maxTransactionCost);
  upper(() => tx(4), policy.maxFeePerGas);
  upper(() => tx(3), policy.maxPriorityFeePerGas);
  a.push(1).push(0).op(0xb4); eq(0); // ARBITRARY
  a.push(2).push(0).op(0xb4); eq(0); // canonical digest
  a.push(3).push(0).op(0xb4); eq(policy.proofBytes);
  for (let i = 0; i < 4; i++) {
    frame(i, 2); eq(i === 3 ? 2 : 1);
    frame(i, 3); eq([0, 2, 1, 0][i]!);
    frame(i, 8); eq(0);
    for (const [key, bounds] of [[1, policy.budgets[i]!.execution], [9, policy.budgets[i]!.state]] as const) {
      lower(() => frame(i, key), bounds.min); upper(() => frame(i, key), bounds.max);
    }
  }
  frame(0, 0); eq(BigInt(policy.expiryVerifier)); frame(0, 4); eq(8);
  frame(0, 5); eq(1); frame(1, 5); eq(1);
  frame(2, 0); a.op(0x30); equal(); frame(2, 4); eq(4);
  frame(1, 0); tx(2); equal(); frame(3, 0); tx(2); equal();
  // Branch only to a configured pool's matching ABI shape.
  policy.pools.forEach((p, i) => { tx(2); a.push(BigInt(p.address)).op(0x14).jumpIf(`pool${i}`); });
  a.push(1).jumpIf('reject');
  policy.pools.forEach((p, i) => {
    a.label(`pool${i}`);
    frame(1, 4); eq(p.verifyCalldataBytes); selector(1, p.verifySelector);
    const executions = [{ selector: p.executeSelector, calldataBytes: p.executeCalldataBytes }, ...(p.additionalExecutions ?? [])];
    for (const execution of executions) {
      frame(3, 4); a.push(execution.calldataBytes).op(0x14);
      a.push(3).push(0).op(0xb1).push(224).op(0x1c).push(BigInt(execution.selector)).op(0x14, 0x16);
      a.jumpIf(`approve${i}`);
    }
    a.push(1).jumpIf('reject');
    a.label(`approve${i}`);
    // APPROVE stack: scope at depth 2, length at depth 1, offset at top.
    a.push(1).push(0).push(0).op(0xaa);
  });
  a.label('reject').push(0).push(0).op(0xfd);
  a.label('fund').op(0x00);
  const runtime = a.finish();
  const length = (runtime.length - 2) / 2;
  if (length > 24576) throw new Error('Runtime too large');
  // Fixed 15-byte creation prefix. Copies the exact runtime and returns it.
  const len = length.toString(16).padStart(4, '0');
  const initCode = `0x61${len}61000f60003961${len}6000f3${runtime.slice(2)}` as Hex;
  return { specCommit: SPEC_COMMIT, runtime, initCode, runtimeHash: keccak256(runtime) };
}
