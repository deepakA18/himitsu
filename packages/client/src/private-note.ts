import { keccak256, stringToHex, type Hex } from 'viem';
import { poseidon1, poseidon2 } from 'poseidon-lite';
import { createSecretNote, hex32, validateSecretNote, withAmount, type SavedNote } from './notes';
import type { Deployment } from './chain';

const PREFIX = 'himitsu-note-v1:';
function identity(d: Deployment, pool: Hex, nullifierHash: Hex) {
  return keccak256(
    stringToHex(JSON.stringify(['himitsu-private-note', d.id, pool.toLowerCase(), nullifierHash])),
  );
}
export function createPrivateNote(
  d: Deployment,
  pool: Hex,
  purpose: 'deposit' | 'swap' = 'deposit',
): SavedNote {
  const secret = createSecretNote();
  const note = {
    ...secret,
    id: identity(d, pool, secret.nullifierHash),
    deployment: d.id,
    pool,
    createdAt: Date.now(),
  };
  return d.noteVersion === 2 && purpose === 'deposit' && pool.toLowerCase() === d.pool.toLowerCase()
    ? withAmount(note, d.defaultDepositAmount ?? d.denomination)
    : note;
}
/** Export only the spend preimage and deployment binding. V2 amounts are recovered from events.
 * The checksum catches accidental damage; it is not an authenticity signature.
 */
export function exportPrivateNote(note: SavedNote, d: Deployment): string {
  validateSecretNote(note);
  if (
    note.deployment !== d.id ||
    ![d.pool.toLowerCase(), d.outputPool.toLowerCase()].includes(note.pool.toLowerCase())
  )
    throw new Error('Note belongs to a different deployment');
  const body = JSON.stringify([
    d.chainId,
    d.genesisHash.toLowerCase(),
    d.id,
    d.noteVersion ?? 1,
    note.pool.toLowerCase(),
    note.nullifier,
    note.secret,
  ]);
  return PREFIX + body + ':' + keccak256(stringToHex(body)).slice(2);
}
export function importPrivateNote(text: string, d: Deployment): SavedNote {
  const value = text.trim();
  if (value.length > 4096 || !value.startsWith(PREFIX))
    throw new Error('Not a Himitsu private note');
  const end = value.lastIndexOf(':'),
    body = value.slice(PREFIX.length, end);
  if (keccak256(stringToHex(body)).slice(2) !== value.slice(end + 1))
    throw new Error('Private note is damaged: checksum mismatch');
  let fields: unknown;
  try {
    fields = JSON.parse(body);
  } catch {
    throw new Error('Invalid private note');
  }
  if (!Array.isArray(fields) || fields.length !== 7)
    throw new Error('Unsupported private note format');
  const [chain, genesis, deployment, version, pool, nullifier, secret] = fields;
  if (
    chain !== d.chainId ||
    genesis !== d.genesisHash.toLowerCase() ||
    deployment !== d.id ||
    version !== (d.noteVersion ?? 1)
  )
    throw new Error(
      'Note belongs to a different network or deployment. Select its original pool deployment.',
    );
  if (
    typeof pool !== 'string' ||
    ![d.pool.toLowerCase(), d.outputPool.toLowerCase()].includes(pool)
  )
    throw new Error('Unknown note pool');
  for (const field of [nullifier, secret])
    if (typeof field !== 'string' || !/^(0|[1-9][0-9]{0,76})$/.test(field))
      throw new Error('Invalid note secret');
  const note: SavedNote = {
    id: '',
    deployment: d.id,
    pool: pool as Hex,
    createdAt: 0,
    nullifier,
    secret,
    commitment: hex32(poseidon2([BigInt(nullifier), BigInt(secret)])),
    nullifierHash: hex32(poseidon1([BigInt(nullifier)])),
  };
  validateSecretNote(note);
  note.id = identity(d, note.pool, note.nullifierHash);
  return d.noteVersion === 2 && pool === d.pool.toLowerCase() && BigInt(d.denomination) > 0n
    ? withAmount(note, d.defaultDepositAmount ?? d.denomination)
    : note;
}
/** A high-entropy bearer secret unlocks only this note's local encrypted transaction cache. */
export function privateNoteCacheKey(note: SavedNote) {
  return keccak256(
    stringToHex(
      JSON.stringify([
        'himitsu-note-cache-v1',
        note.deployment,
        note.pool.toLowerCase(),
        note.nullifier,
        note.secret,
      ]),
    ),
  );
}
