import { expect, test } from 'bun:test';
import { serializeTransaction, signingHash } from '../src/index.ts';
import { serialize, sigHash } from '../../protocol/frametx.mjs';

for (const nonce of [0n, 1n, 255n, 256n, (1n << 64n) - 1n]) {
  test(`independent protocol codec agrees at nonce ${nonce}`, () => {
    const tx = {
      chainId: 9n, nonce, sender: '0x' + '11'.repeat(20),
      frames: [
        { mode: 1, flags: 0, target: '0x0000000000000000000000000000000000008141', limits: { execution: 1000n, state: 0n }, value: 0n, data: '0x000000006ab70000' },
        { mode: 1, flags: 2, target: null, limits: { execution: 500000n, state: 0n }, value: 0n, data: '0x12345678' },
        { mode: 1, flags: 1, target: '0x' + '22'.repeat(20), limits: { execution: 50000n, state: 0n }, value: 0n, data: '0x48494d49' },
        { mode: 2, flags: 0, target: null, limits: { execution: 900000n, state: 900000n }, value: 0n, data: '0x' + 'aa'.repeat(164) },
      ],
      signatures: [{ scheme: 0, signer: '0x', msg: '0x', signature: '0x' + 'ab'.repeat(256) }],
      fees: { maxPriorityFeePerGas: 1000000000n, maxFeePerGas: 2000000000n, maxFeePerBlobGas: 0n }, blobVersionedHashes: [],
    };
    const legacy = { ...tx, ...tx.fees, signatures: tx.signatures.map(({ signer, ...rest }) => rest), frames: tx.frames.map(({ limits, ...rest }) => ({ ...rest, gasLimit: limits.execution, stateGasLimit: limits.state })) };
    expect(serializeTransaction(tx)).toBe(serialize(legacy));
    expect(signingHash(tx)).toBe(sigHash(legacy));
  });
}
