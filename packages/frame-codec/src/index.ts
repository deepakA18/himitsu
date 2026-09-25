import { concatHex, keccak256, toHex, toRlp, type Hex } from 'viem';

/** Wire format pinned to ethereum/EIPs b75cbe6115, not an evergreen EIP API. */
export const SPEC_COMMIT = 'b75cbe6115';
export const FRAME_TYPE = '0x06' as const;
export const Mode = { DEFAULT: 0, VERIFY: 1, SENDER: 2 } as const;
export const Scope = { NONE: 0, PAYMENT: 1, EXECUTION: 2, BOTH: 3 } as const;
export const ATOMIC = 4;
export interface Frame {
  mode: 0 | 1 | 2;
  flags: number;
  target: Hex | null;
  limits: { execution: bigint; state: bigint };
  value: bigint;
  data: Hex;
}
export interface Signature {
  scheme: 0 | 1 | 2;
  signer: Hex;
  msg: Hex;
  signature: Hex;
}
export interface FrameTransaction {
  chainId: bigint;
  nonce: bigint;
  sender: Hex;
  frames: Frame[];
  signatures: Signature[];
  fees: { maxPriorityFeePerGas: bigint; maxFeePerGas: bigint; maxFeePerBlobGas: bigint };
  blobVersionedHashes: Hex[];
}
function requireValue(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function assertHex(value: string, bytes?: number): asserts value is Hex {
  requireValue(/^0x(?:[\da-fA-F]{2})*$/.test(value), 'Invalid hex bytes');
  if (bytes !== undefined) requireValue(value.length === 2 + bytes * 2, `Expected ${bytes} bytes`);
}
function uint(value: bigint, bits = 256): Hex {
  requireValue(typeof value === 'bigint' && value >= 0n && value < (1n << BigInt(bits)), `Invalid uint${bits}`);
  return value === 0n ? '0x' : toHex(value);
}
export function validateTransaction(tx: FrameTransaction): void {
  uint(tx.chainId); uint(tx.nonce, 64); assertHex(tx.sender, 20);
  requireValue(tx.frames.length > 0 && tx.frames.length <= 64, 'Expected 1–64 frames');
  uint(tx.fees.maxFeePerGas); uint(tx.fees.maxPriorityFeePerGas); uint(tx.fees.maxFeePerBlobGas);
  requireValue(tx.fees.maxPriorityFeePerGas <= tx.fees.maxFeePerGas, 'Priority fee exceeds fee cap');
  // Himitsu intentionally supports no blobs; fail closed rather than partially encoding them.
  requireValue(tx.blobVersionedHashes.length === 0 && tx.fees.maxFeePerBlobGas === 0n, 'Blobs unsupported');
  let budgets = 0n;
  tx.frames.forEach((frame, index) => {
    requireValue([0, 1, 2].includes(frame.mode), 'Unsupported frame mode');
    requireValue(Number.isInteger(frame.flags) && frame.flags >= 0 && frame.flags < 8, 'Unsupported flags');
    if (frame.target !== null) assertHex(frame.target, 20);
    assertHex(frame.data); uint(frame.value); uint(frame.limits.execution, 64); uint(frame.limits.state, 64);
    budgets += frame.limits.execution + frame.limits.state;
    requireValue(frame.mode === Mode.SENDER || frame.value === 0n, 'Value requires SENDER');
    const target = (frame.target ?? tx.sender).toLowerCase();
    if (frame.flags & Scope.EXECUTION) requireValue(target === tx.sender.toLowerCase(), 'Execution approval must target sender');
    if (frame.flags & ATOMIC) {
      const next = tx.frames[index + 1];
      requireValue(frame.mode !== Mode.VERIFY && next !== undefined && next.mode !== Mode.VERIFY, 'Invalid atomic group');
    }
    if ((frame.flags & ATOMIC) || ((tx.frames[index - 1]?.flags ?? 0) & ATOMIC)) {
      requireValue((frame.flags & 3) === 0, 'Atomic frames cannot approve');
    }
  });
  requireValue(budgets < (1n << 64n), 'Gas budget overflow');
  for (const sig of tx.signatures) {
    requireValue([0, 1, 2].includes(sig.scheme), 'Unsupported signature scheme');
    assertHex(sig.signer); assertHex(sig.msg); assertHex(sig.signature);
    requireValue(sig.signer === '0x' || sig.signer.length === 42, 'Invalid signer');
    requireValue(sig.msg === '0x' || (sig.msg.length === 66 && BigInt(sig.msg) !== 0n), 'Invalid signature message');
    if (sig.scheme === 0) requireValue(sig.signer === '0x', 'ARBITRARY signer must be empty');
    if (sig.scheme === 1) assertHex(sig.signature, 65);
    if (sig.scheme === 2) assertHex(sig.signature, 128);
  }
}
function payload(tx: FrameTransaction, signing: boolean) {
  return [uint(tx.chainId), uint(tx.nonce, 64), tx.sender,
    tx.frames.map(f => [uint(BigInt(f.mode)), uint(BigInt(f.flags)), f.target ?? '0x',
      [uint(f.limits.execution), uint(f.limits.state)], uint(f.value), f.data]),
    tx.signatures.map(s => [uint(BigInt(s.scheme)), s.signer, s.msg,
      signing && s.msg === '0x' ? '0x' : s.signature]),
    [uint(tx.fees.maxPriorityFeePerGas), uint(tx.fees.maxFeePerGas), uint(tx.fees.maxFeePerBlobGas)],
    tx.blobVersionedHashes];
}
export function serializeTransaction(tx: FrameTransaction): Hex {
  validateTransaction(tx);
  return concatHex([FRAME_TYPE, toRlp(payload(tx, false))]);
}
export function signingHash(tx: FrameTransaction): Hex {
  validateTransaction(tx);
  return keccak256(concatHex([FRAME_TYPE, toRlp(payload(tx, true))]));
}
export function transactionHash(tx: FrameTransaction): Hex { return keccak256(serializeTransaction(tx)); }
/** Big-endian high/low limbs; circuit must range constrain both limbs. */
export function digestLimbs(digest: Hex): readonly [bigint, bigint] {
  assertHex(digest, 32);
  const value = BigInt(digest);
  return [value >> 128n, value & ((1n << 128n) - 1n)];
}

export interface FrameReceipt { status: 0 | 1 | 2; }
export type Effect = 'persisted' | 'reverted' | 'rolled-back' | 'skipped';
/** Use alongside canonical surviving logs and state reconciliation, not instead of them. */
export function frameEffects(frames: Frame[], receipts: FrameReceipt[]): Effect[] {
  requireValue(frames.length === receipts.length, 'Receipt count mismatch');
  const effects: Effect[] = [];
  for (let start = 0; start < frames.length;) {
    let end = start;
    while (frames[end]!.flags & ATOMIC) {
      end++;
      requireValue(end < frames.length, 'Unterminated atomic group');
    }
    const group = receipts.slice(start, end + 1);
    let failed = false;
    for (const r of group) {
      requireValue([0, 1, 2].includes(r.status), 'Invalid receipt status');
      requireValue(!failed ? r.status !== 2 : r.status === 2, 'Inconsistent skipped frame');
      if (r.status === 0) failed = true;
    }
    for (const r of group) effects.push(r.status === 2 ? 'skipped' : r.status === 0 ? 'reverted' : failed ? 'rolled-back' : 'persisted');
    start = end + 1;
  }
  return effects;
}
