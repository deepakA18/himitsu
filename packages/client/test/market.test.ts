import { test, expect } from 'bun:test';
import { amountOut, minimumOutput, fundingRequired } from '../src/market';
import { createSecretNote, withAmount, validateSecretNote, NoteTree } from '../src/notes';
test('Uniswap quote uses integer rounding and includes the 0.3% fee', () => {
  expect(amountOut(100n, 10000n, 20000n)).toBe(197n);
  expect(amountOut(100000000000000000n, 10000000000000000000n, 20000000000000000000000n)).toBe(
    197431606879412259770n,
  );
  expect(() => amountOut(1n, 0n, 5n)).toThrow();
  expect(minimumOutput(197431606879412259770n, 50)).toBe(196444448845015198471n);
  expect(() => minimumOutput(100n, -1)).toThrow();
  expect(() => minimumOutput(100n, 501)).toThrow();
});
test('funding checks cover frame budgets and refuse fee/policy excess', () => {
  expect(fundingRequired(0n, true).maximum).toBeGreaterThan(fundingRequired(0n, false).maximum);
  expect(() => fundingRequired(5000000000n, true)).toThrow();
  expect(() => fundingRequired(3000000000n, true)).toThrow('budget');
});
test('amount notes commit their exact value and preserve a recovery tag', () => {
  const base = createSecretNote(),
    note = withAmount(base, '150000000000000000001');
  expect(note.baseCommitment).toBe(base.commitment);
  expect(() => validateSecretNote(note)).not.toThrow();
  expect(() => validateSecretNote({ ...note, amount: '150000000000000000002' })).toThrow();
  expect(() => withAmount(base, '0')).toThrow();
  expect(() => withAmount(base, String(1n << 128n))).toThrow();
  const tree = new NoteTree();
  tree.insert(BigInt(note.commitment));
  expect(tree.path(0).pathIndices.length).toBe(10);
});
