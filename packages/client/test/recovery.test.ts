import { test, expect } from 'bun:test';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import {
  deriveNote,
  recoveryKey,
  recoveryCandidates,
  normalizePhrase,
  nextCounter,
} from '../src/recovery';
import { Vault, type Envelope, type VaultStore } from '../src/vault';
import { createSecretNote } from '../src/notes';
const phrase = entropyToMnemonic(new Uint8Array(32), wordlist);
const pool = '0x1111111111111111111111111111111111111111';
function store(): VaultStore {
  let value: Envelope | undefined;
  return {
    read: async () => value,
    compareAndSet: async (expected, next) => {
      if ((value?.revision ?? null) !== expected) throw new Error('Conflict');
      value = structuredClone(next);
    },
  };
}
test('24-word checksum validation and normalization', () => {
  expect(normalizePhrase('  ' + phrase.toUpperCase().replaceAll(' ', '\n') + ' ')).toBe(phrase);
  expect(() => normalizePhrase(Array(24).fill('abandon').join(' '))).toThrow();
  expect(() => normalizePhrase('abandon '.repeat(11) + 'about')).toThrow();
});
test('derivation is reproducible and separates counters, pools and deployments', async () => {
  const key = await recoveryKey(phrase),
    n = await deriveNote(key, 'deployment-a', pool, 0);
  expect(n.commitment).toBe('0x20782047bc8a4b0e84e38dd966d3f8e89ed5fa84acddd9f2bb5bff6051412952');
  expect(await deriveNote(await recoveryKey(phrase), 'deployment-a', pool, 0)).toEqual(n);
  for (const other of [
    await deriveNote(key, 'deployment-b', pool, 0),
    await deriveNote(key, 'deployment-a', '0x2222222222222222222222222222222222222222', 0),
    await deriveNote(key, 'deployment-a', pool, 1),
  ])
    expect(other.commitment).not.toBe(n.commitment);
  await expect(deriveNote(key, 'deployment-a', pool, 1024)).rejects.toThrow();
  const end = await deriveNote(key, 'deployment-a', pool, 1023);
  expect(() => nextCounter([end], 'deployment-a', pool)).toThrow('exhausted');
});
test('full scan includes notes beyond gaps and the final slot', async () => {
  const key = await recoveryKey(phrase),
    candidates = await recoveryCandidates(key, 'deployment-a', pool);
  expect(candidates.length).toBe(1024);
  expect(candidates[1023]).toEqual(await deriveNote(key, 'deployment-a', pool, 1023));
  expect(new Set(candidates.map((n) => n.commitment)).size).toBe(1024);
}, 30000);
test('phrase restore changes local password, excludes journal and test key, refuses overwrite', async () => {
  const first = await Vault.open(store(), 'original local password');
  expect(first.data.recovery?.confirmed).toBe(false);
  await expect(first.confirmRecovery(phrase)).rejects.toThrow();
  await first.confirmRecovery(first.data.recovery!.phrase);
  const destination = store();
  const restored = await Vault.restorePhrase(
    destination,
    'different local password',
    first.data.recovery!.phrase,
  );
  expect(restored.data.recovery).toEqual(first.data.recovery);
  expect(restored.data.notes).toEqual([]);
  expect(restored.data.testWalletKey).toBeUndefined();
  await expect(Vault.open(destination, 'original local password')).rejects.toThrow();
  expect((await Vault.open(destination, 'different local password')).data.recovery).toEqual(
    first.data.recovery,
  );
  await expect(
    Vault.restorePhrase(destination, 'different local password', phrase),
  ).rejects.toThrow('empty');
  expect(await first.backup()).not.toContain(first.data.recovery!.phrase);
});
test('enabling recovery preserves legacy notes and cannot replace an existing phrase', async () => {
  const v = await Vault.open(store(), 'legacy local password');
  const legacy = {
    ...createSecretNote(),
    id: 'legacy',
    deployment: 'deployment-a',
    pool,
    createdAt: 1,
  } as const;
  await v.save({ version: 1, notes: [legacy], attempts: [] });
  await v.enableRecovery();
  const original = v.data.recovery!.phrase;
  await v.enableRecovery();
  expect(v.data.recovery!.phrase).toBe(original);
  expect(v.data.notes).toEqual([legacy]);
});

test('create and unlock are separate actions and never overwrite an existing wallet', async () => {
  const destination = store();
  await expect(Vault.unlock(destination, 'test local password')).rejects.toThrow(
    'No private wallet',
  );
  const created = await Vault.create(destination, 'test local password');
  await expect(Vault.create(destination, 'another local password')).rejects.toThrow(
    'already exists',
  );
  expect((await Vault.unlock(destination, 'test local password')).data.recovery).toEqual(
    created.data.recovery,
  );
});
