// Notes, the Merkle tree, and spend proofs.
//
// The tree here must agree with GhostPool's byte for byte: same Poseidon, same
// empty-leaf constant, same insertion order. `lifecycle.mjs` cross-checks the
// root this file computes against the root the contract reports after every
// deposit, so a divergence surfaces immediately instead of as an unprovable
// witness later.

import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { buildPoseidon } from 'circomlibjs'
import * as snarkjs from 'snarkjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const WASM = join(HERE, 'circuits/spend_js/spend.wasm')
export const ZKEY = join(HERE, 'circuits/spend_final.zkey')
export const VKEY = join(HERE, 'circuits/verification_key.json')

export const FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n
export const LEVELS = 10

/** Mirrors GhostPool.ZERO_VALUE. */
export const ZERO_VALUE =
  BigInt('0x' + Buffer.from(keccak_256(Buffer.from('himitsu.empty.leaf'))).toString('hex')) %
  FIELD_SIZE

let poseidonImpl = null
export async function poseidon() {
  if (!poseidonImpl) {
    const p = await buildPoseidon()
    poseidonImpl = (inputs) => p.F.toObject(p(inputs))
  }
  return poseidonImpl
}

export const toHex32 = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0')

/** A uniformly random field element. */
export function randomField() {
  while (true) {
    const candidate = BigInt('0x' + randomBytes(32).toString('hex'))
    if (candidate < FIELD_SIZE) return candidate
  }
}

/** A fresh note: the secret pair, and the commitment the pool will store. */
export async function createNote() {
  const H = await poseidon()
  const nullifier = randomField()
  const secret = randomField()
  return {
    nullifier,
    secret,
    commitment: H([nullifier, secret]),
    nullifierHash: H([nullifier]),
  }
}

/**
 * An append-only Merkle tree of fixed depth, matching GhostPool's `_insert`.
 * Small enough to keep every leaf in memory; a real deployment would rebuild
 * paths from deposit events instead.
 */
export class MerkleTree {
  constructor(H, levels = LEVELS) {
    this.H = H
    this.levels = levels
    this.leaves = []
    this.zeros = []
    let current = ZERO_VALUE
    for (let i = 0; i < levels; i++) {
      this.zeros.push(current)
      current = H([current, current])
    }
    this.emptyRoot = current
  }

  static async create(levels = LEVELS) {
    return new MerkleTree(await poseidon(), levels)
  }

  insert(leaf) {
    this.leaves.push(BigInt(leaf))
    return this.leaves.length - 1
  }

  /** Hashes level by level, padding each level with that level's zero value. */
  _layers() {
    const layers = [this.leaves.slice()]
    for (let level = 0; level < this.levels; level++) {
      const below = layers[level]
      const above = []
      for (let i = 0; i < below.length; i += 2) {
        const left = below[i]
        const right = i + 1 < below.length ? below[i + 1] : this.zeros[level]
        above.push(this.H([left, right]))
      }
      layers.push(above)
    }
    return layers
  }

  root() {
    if (this.leaves.length === 0) return this.emptyRoot
    const layers = this._layers()
    const top = layers[this.levels]
    return top.length ? top[0] : this.emptyRoot
  }

  /** The sibling path and left/right bits for `index`. */
  path(index) {
    const layers = this._layers()
    const pathElements = []
    const pathIndices = []
    let i = index
    for (let level = 0; level < this.levels; level++) {
      const isRight = i % 2
      const siblingIndex = isRight ? i - 1 : i + 1
      const layer = layers[level]
      const sibling = siblingIndex < layer.length ? layer[siblingIndex] : this.zeros[level]
      pathElements.push(sibling)
      pathIndices.push(isRight)
      i = Math.floor(i / 2)
    }
    return { pathElements, pathIndices }
  }
}

/**
 * Prove a spend.
 *
 * `txHash` is the frame transaction's sig_hash, split into the same two 128-bit
 * limbs SpendValidator derives on-chain from TXPARAM(0x08). They are public
 * signals, so the proof is valid for exactly one transaction: change the
 * recipient, the amount, the nonce or any frame, and sig_hash moves with it.
 */
export const digestLimbs = (digest) => ({
  hi: BigInt(digest) >> 128n,
  lo: BigInt(digest) & ((1n << 128n) - 1n),
})

export async function proveSpend({ note, tree, leafIndex, recipient, txHash, root = null }) {
  const { pathElements, pathIndices } = tree.path(leafIndex)
  const { hi, lo } = digestLimbs(txHash)
  const input = {
    root: (root ?? tree.root()).toString(),
    nullifierHash: note.nullifierHash.toString(),
    recipient: BigInt(recipient).toString(),
    txHashHi: hi.toString(),
    txHashLo: lo.toString(),
    nullifier: note.nullifier.toString(),
    secret: note.secret.toString(),
    pathElements: pathElements.map(String),
    pathIndices: pathIndices.map(String),
  }
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY)
  return { proof, publicSignals, blob: await proofToBlob(proof, publicSignals) }
}

/**
 * Flatten a proof into the 256-byte blob the transaction carries as its
 * ARBITRARY signature.
 *
 * The G1/G2 word order (in particular that each G2 coordinate puts its
 * imaginary coefficient first) is taken from snarkjs' own
 * `exportSolidityCallData` rather than re-derived here -- that function is the
 * authority on what its exported verifier expects, and getting the order wrong
 * is the classic Groth16 integration bug.
 */
export async function proofToBlob(proof, publicSignals) {
  const encoded = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)
  const words = (encoded.match(/0x[0-9a-fA-F]+/g) ?? []).map((w) => BigInt(w))
  if (words.length < 8) throw new Error(`unexpected call data: ${encoded.slice(0, 80)}`)
  // a[2], b[2][2], c[2] -- the public signals follow and are supplied separately
  // by the account from frame data and TXPARAM.
  return '0x' + words.slice(0, 8).map((w) => w.toString(16).padStart(64, '0')).join('')
}

export async function verifyOffline(proof, publicSignals) {
  const { readFileSync } = await import('node:fs')
  const vkey = JSON.parse(readFileSync(VKEY, 'utf8'))
  return snarkjs.groth16.verify(vkey, publicSignals, proof)
}
