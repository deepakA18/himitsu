import { poseidon1, poseidon2 } from 'poseidon-lite';
import { keccak256, stringToHex, type Hex } from 'viem';
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const hex32 = (v: bigint): Hex => `0x${v.toString(16).padStart(64, '0')}`;
export const ZERO = BigInt(keccak256(stringToHex('ghostswap.empty.leaf'))) % FIELD;
export interface SecretNote { nullifier: string; secret: string; commitment: Hex; nullifierHash: Hex; }
export interface SavedNote extends SecretNote { id: string; deployment: string; pool: Hex; createdAt: number; }
export function randomField(): bigint {
  for (;;) { const bytes = crypto.getRandomValues(new Uint8Array(32)); const n = BigInt('0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')); if (n < FIELD) return n; }
}
export function createSecretNote(): SecretNote {
  const nullifier = randomField(), secret = randomField();
  return { nullifier: String(nullifier), secret: String(secret), commitment: hex32(poseidon2([nullifier, secret])), nullifierHash: hex32(poseidon1([nullifier])) };
}
export function validateSecretNote(note: SecretNote) {
  for (const v of [note.nullifier, note.secret]) if (!/^[0-9]+$/.test(v) || BigInt(v) >= FIELD) throw new Error('Invalid note field');
  if (hex32(poseidon2([BigInt(note.nullifier), BigInt(note.secret)])) !== note.commitment || hex32(poseidon1([BigInt(note.nullifier)])) !== note.nullifierHash) throw new Error('Note commitment mismatch');
}
export class NoteTree {
  readonly zeros: bigint[] = []; readonly leaves: bigint[] = []; readonly emptyRoot: bigint;
  constructor() { let z = ZERO; for (let i = 0; i < 10; i++) { this.zeros.push(z); z = poseidon2([z, z]); } this.emptyRoot = z; }
  insert(leaf: bigint) { if (leaf < 0n || leaf >= FIELD || this.leaves.length >= 1024) throw new Error('Invalid tree leaf'); this.leaves.push(leaf); }
  layers() { const out = [this.leaves]; for (let d = 0; d < 10; d++) { const layer = out[d]!, next: bigint[] = []; for (let i = 0; i < layer.length; i += 2) next.push(poseidon2([layer[i]!, layer[i + 1] ?? this.zeros[d]!])); out.push(next); } return out; }
  root() { return this.layers()[10]![0] ?? this.emptyRoot; }
  path(index: number) { if (!Number.isInteger(index) || index < 0 || index >= this.leaves.length) throw new Error('Note is not in canonical tree'); const layers = this.layers(), pathElements: string[] = [], pathIndices: number[] = []; for (let d = 0; d < 10; d++) { pathElements.push(String(layers[d]![index ^ 1] ?? this.zeros[d]!)); pathIndices.push(index % 2); index = Math.floor(index / 2); } return { pathElements, pathIndices }; }
}
