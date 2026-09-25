import { generateMnemonic, mnemonicToSeed, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { poseidon1, poseidon2 } from 'poseidon-lite';
import { FIELD, hex32, type SavedNote } from './notes';
import type { Hex } from 'viem';
export const RECOVERY_SLOTS = 1024;
export interface Recovery {
  version: 1;
  phrase: string;
  confirmed: boolean;
}
export function normalizePhrase(value: string): string {
  const phrase = value.normalize('NFKD').trim().toLowerCase().split(/\s+/).join(' ');
  if (phrase.split(' ').length !== 24 || !validateMnemonic(phrase, wordlist))
    throw new Error('Enter a valid 24-word Himitsu recovery phrase');
  return phrase;
}
export const createRecovery = (): Recovery => ({
  version: 1,
  phrase: generateMnemonic(wordlist, 256),
  confirmed: false,
});
export function nextCounter(notes: SavedNote[], deployment: string, pool: Hex): number {
  const counter =
    1 +
    Math.max(
      -1,
      ...notes
        .filter((n) => n.deployment === deployment && n.pool.toLowerCase() === pool.toLowerCase())
        .map((n) => n.recovery?.counter ?? -1),
    );
  if (counter >= RECOVERY_SLOTS)
    throw new Error('Recovery note slots exhausted for this pool. Use a new private wallet.');
  return counter;
}
export async function recoveryKey(phrase: string): Promise<CryptoKey> {
  const seed = await mnemonicToSeed(normalizePhrase(phrase), '');
  try {
    return await crypto.subtle.importKey(
      'raw',
      new Uint8Array(seed),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } finally {
    seed.fill(0);
  }
}
export async function deriveNote(
  key: CryptoKey,
  deployment: string,
  pool: Hex,
  counter: number,
): Promise<SavedNote> {
  if (!Number.isInteger(counter) || counter < 0 || counter >= RECOVERY_SLOTS)
    throw new Error('Invalid recovery counter');
  async function field(label: string) {
    for (let retry = 0; ; retry++) {
      const bytes = new Uint8Array(
        await crypto.subtle.sign(
          'HMAC',
          key,
          new TextEncoder().encode(
            JSON.stringify([
              'himitsu-notes:v1',
              deployment.toLowerCase(),
              pool.toLowerCase(),
              counter,
              label,
              retry,
            ]),
          ),
        ),
      );
      const n = BigInt('0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''));
      if (n < FIELD) return n;
    }
  }
  const nullifier = await field('nullifier'),
    secret = await field('secret');
  const commitment = hex32(poseidon2([nullifier, secret]));
  return {
    id: `recovery-v1:${pool.toLowerCase()}:${commitment}`,
    deployment,
    pool,
    createdAt: 0,
    recovery: { version: 1, counter },
    nullifier: String(nullifier),
    secret: String(secret),
    commitment,
    nullifierHash: hex32(poseidon1([nullifier])),
  };
}
export async function recoveryCandidates(
  key: CryptoKey,
  deployment: string,
  pool: Hex,
): Promise<SavedNote[]> {
  const notes: SavedNote[] = [];
  // Full bounded scan: failed transactions may leave arbitrarily long gaps.
  for (let i = 0; i < RECOVERY_SLOTS; i++) {
    notes.push(await deriveNote(key, deployment, pool, i));
    if (i % 16 === 15) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return notes;
}
