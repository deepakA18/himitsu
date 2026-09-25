import { describe, expect, test } from 'bun:test';
import { fromRlp, type Hex } from 'viem';
import { digestLimbs, frameEffects, serializeTransaction, signingHash, transactionHash, type FrameTransaction } from '../src/index';

export function fixture(): FrameTransaction {
  return { chainId: 9n, nonce: 0n, sender: `0x${'11'.repeat(20)}`,
    frames: [
      { mode: 1, flags: 3, target: null, limits: { execution: 300000n, state: 0n }, value: 0n, data: '0x1234' },
      { mode: 2, flags: 0, target: null, limits: { execution: 100000n, state: 400000n }, value: 0n, data: '0xabcd' },
    ], signatures: [{ scheme: 0, signer: '0x', msg: '0x', signature: '0x123456' }],
    fees: { maxPriorityFeePerGas: 1n, maxFeePerGas: 10n, maxFeePerBlobGas: 0n }, blobVersionedHashes: [] };
}
describe('pinned frame encoding', () => {
  test('zero nonce and null target use empty RLP bytes', () => {
    const decoded = fromRlp(`0x${serializeTransaction(fixture()).slice(4)}` as Hex);
    expect(decoded[0]).toBe('0x09'); expect(decoded[1]).toBe('0x');
    expect((decoded[3] as Hex[][])[0]![2]).toBe('0x');
  });
  test('proof replacement changes tx hash but not authorization digest', () => {
    const a = fixture(), b = fixture(); b.signatures[0]!.signature = '0xffffff';
    expect(signingHash(a)).toBe(signingHash(b)); expect(transactionHash(a)).not.toBe(transactionHash(b));
  });
  test('explicit-message witness is committed', () => {
    const a = fixture(); a.signatures[0]!.msg = `0x${'12'.repeat(32)}`;
    const b = structuredClone(a); b.signatures[0]!.signature = '0xff';
    expect(signingHash(a)).not.toBe(signingHash(b));
  });
  test.each(['nonce', 'chain', 'fee', 'target', 'calldata', 'state-budget', 'signer-metadata'])('mutation of %s changes digest', field => {
    const a = fixture(), b = fixture();
    if (field === 'nonce') b.nonce++;
    if (field === 'chain') b.chainId++;
    if (field === 'fee') b.fees.maxFeePerGas++;
    if (field === 'target') b.frames[1]!.target = `0x${'22'.repeat(20)}`;
    if (field === 'calldata') b.frames[1]!.data = '0xabce';
    if (field === 'state-budget') b.frames[1]!.limits.state++;
    if (field === 'signer-metadata') b.signatures[0]!.msg = `0x${'12'.repeat(32)}`;
    expect(signingHash(a)).not.toBe(signingHash(b));
  });
  test('limbs reconstruct all 256 digest bits', () => {
    const hash = signingHash(fixture()); const [hi, lo] = digestLimbs(hash);
    expect((hi << 128n) | lo).toBe(BigInt(hash));
  });
  test('rejects dangling atomic flag and invalid arbitrary signer', () => {
    const a = fixture(); a.frames[1]!.flags = 4;
    expect(() => serializeTransaction(a)).toThrow('atomic');
    const b = fixture(); b.signatures[0]!.signer = b.sender;
    expect(() => serializeTransaction(b)).toThrow('ARBITRARY');
  });
});
describe('rollback interpretation', () => {
  test('earlier success is rolled back when a later batch frame fails', () => {
    const frames = [fixture().frames[1]!, fixture().frames[1]!, fixture().frames[1]!];
    frames[0]!.flags = 4; frames[1]!.flags = 4;
    expect(frameEffects(frames, [{ status: 1 }, { status: 0 }, { status: 2 }])).toEqual(['rolled-back', 'reverted', 'skipped']);
  });
  test('independent successful frame survives later failure', () => {
    expect(frameEffects(fixture().frames, [{ status: 1 }, { status: 0 }])).toEqual(['persisted', 'reverted']);
  });
  test('impossible skipped standalone receipt fails closed', () => {
    expect(() => frameEffects(fixture().frames, [{ status: 1 }, { status: 2 }])).toThrow();
  });
});
