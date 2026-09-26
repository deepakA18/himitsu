import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  createPrivateNote,
  exportPrivateNote,
  importPrivateNote,
  privateNoteCacheKey,
} from './private-note';
import { withAmount } from './notes';
import { Vault, type Envelope, type VaultStore } from './vault';
import type { Deployment } from './chain';
const d = JSON.parse(readFileSync('app/public/deployment.json', 'utf8')) as Deployment;
function store(): VaultStore {
  let saved: Envelope | undefined;
  return {
    read: async () => saved,
    compareAndSet: async (revision, next) => {
      if ((saved?.revision ?? null) !== revision) throw new Error('CAS conflict');
      saved = structuredClone(next);
    },
  };
}
describe('portable private notes', () => {
  test('deposit file round trip preserves spend secrets and deployment binding', () => {
    const n = createPrivateNote(d, d.pool),
      restored = importPrivateNote(exportPrivateNote(n, d), d);
    expect(restored.id).toBe(n.id);
    expect(withAmount(restored, n.amount!).commitment).toBe(n.commitment);
    expect(restored.nullifier).toBe(n.nullifier);
    expect(n.amount).toBe(d.defaultDepositAmount ?? d.denomination);
    expect(restored.amount).toBe(BigInt(d.denomination) === 0n ? undefined : d.denomination);
  });
  test('pre-swap output file remains identical after amount recovery', () => {
    const n = createPrivateNote(d, d.outputPool),
      text = exportPrivateNote(n, d);
    const valued = withAmount(n, '123456789012345678901');
    expect(exportPrivateNote(valued, d)).toBe(text);
    const restored = importPrivateNote(text, d);
    expect(restored.amount).toBeUndefined();
    expect(withAmount(restored, valued.amount!).commitment).toBe(valued.commitment);
    expect(privateNoteCacheKey(restored)).toBe(privateNoteCacheKey(valued));
  });
  test('rejects damage, foreign chain/deployment/pool version, and oversized input', () => {
    const text = exportPrivateNote(createPrivateNote(d, d.pool), d);
    expect(() => importPrivateNote(text.slice(0, -1) + 'x', d)).toThrow('checksum');
    expect(() => importPrivateNote(text, { ...d, chainId: '1' })).toThrow('different network');
    expect(() => importPrivateNote(text, { ...d, id: d.id + 'other' })).toThrow(
      'different network',
    );
    const { noteVersion, ...legacyDeployment } = d;
    expect(() => importPrivateNote(text, legacyDeployment)).toThrow('different network');
    expect(() => importPrivateNote('x'.repeat(5000), d)).toThrow();
  });
  test('encrypted cache reopens from the note alone without a recovery phrase', async () => {
    const n = createPrivateNote(d, d.pool),
      s = store(),
      key = privateNoteCacheKey(n);
    const v = await Vault.openPrivateNote(s, key);
    expect(v.data.recovery).toBeUndefined();
    await v.save({ ...v.data, notes: [n] });
    const restored = importPrivateNote(exportPrivateNote(n, d), d);
    const reopened = await Vault.openPrivateNote(s, privateNoteCacheKey(restored));
    expect(reopened.data.notes[0]!.nullifier).toBe(n.nullifier);
    expect(JSON.stringify(await s.read())).not.toContain(n.secret);
    await expect(
      Vault.openPrivateNote(s, privateNoteCacheKey(createPrivateNote(d, d.pool))),
    ).rejects.toThrow('Wrong password');
  });
});

test('variable WETH output backup recovers arbitrary amounts without changing the file', () => {
  const variable = { ...d, denomination: '0', defaultDepositAmount: '100000000000000000' };
  const output = createPrivateNote(variable, variable.pool, 'swap');
  expect(output.amount).toBeUndefined();
  const file = exportPrivateNote(output, variable);
  const valued = withAmount(output, '98765432109876543');
  const imported = importPrivateNote(file, variable);
  expect(imported.amount).toBeUndefined();
  expect(withAmount(imported, valued.amount!).commitment).toBe(valued.commitment);
  expect(exportPrivateNote(valued, variable)).toBe(file);
  expect(privateNoteCacheKey(imported)).toBe(privateNoteCacheKey(valued));
});
test('archived fixed WETH notes still import with their original denomination', () => {
  const { defaultDepositAmount, ...old } = d;
  const fixed = { ...old, denomination: '100000000000000000' };
  const note = createPrivateNote(fixed, fixed.pool);
  const imported = importPrivateNote(exportPrivateNote(note, fixed), fixed);
  expect(imported.commitment).toBe(note.commitment);
  expect(imported.amount).toBe(fixed.denomination);
});
