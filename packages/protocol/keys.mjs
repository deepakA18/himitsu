// Deterministic toy ceremony: every script in this demo regenerates the
// identical proving/verifying key from a fixed seed, so nothing has to be
// serialised to disk and any run is reproducible.
//
// Deterministic toxic waste means anyone can forge proofs for this key. That is
// the one part of the pipeline a production GhostSwap must replace (a real
// multi-party ceremony, e.g. snarkjs powersOfTau + zkey contributions). The
// algebra, the proof and the on-chain pairing check do not change when it is.

import { createHash } from 'node:crypto'
import { setup, prove, witness, fr, encodeVk, encodeProof, R } from './groth16.mjs'

/** SHA-256 chained PRNG over Fr — deterministic and independent of Node's RNG. */
function seeded(seed) {
  let state = createHash('sha256').update(seed).digest()
  return () => {
    state = createHash('sha256').update(state).digest()
    return fr(BigInt('0x' + state.toString('hex')))
  }
}

export const SEED = 'ghostswap-devnet-0'
/** The note's public commitment: y = x1 * x2 with the secret factors below. */
export const SECRET = { x1: 0xdeadbeefn, x2: 0xfeedfacen }

let cached = null
export function ceremony() {
  if (!cached) {
    const { pk, vk } = setup(seeded(SEED + '/setup'))
    const y = fr(SECRET.x1 * SECRET.x2)
    cached = { pk, vk, y, vkWords: encodeVk(vk) }
  }
  return cached
}

/** The 20 verifying-key words the Groth16Verifier constructor takes. */
export function vkConstructorWords() {
  const { alpha, beta, gamma, delta, ic } = ceremony().vkWords
  return [...alpha, ...beta, ...gamma, ...delta, ...ic.flat()]
}

/**
 * Prove "I know a factorisation of y, and I mean *this* transaction".
 * `sigHash` is the frame transaction's canonical sig_hash; reducing it mod R is
 * what the account's code does on-chain, so both sides agree on the signal.
 */
export function proveFor(sigHash, { spoilWitness = false } = {}) {
  const { pk, y } = ceremony()
  const txHash = fr(BigInt(sigHash) % R)
  const secret = spoilWitness ? { x1: SECRET.x1 + 1n, x2: SECRET.x2 } : SECRET
  const w = witness({ ...secret, txHash })
  if (fr(w[1]) !== y) throw new Error('witness does not open the public commitment')
  const proof = prove(pk, w, seeded(SEED + '/prove/' + txHash.toString(16)))
  return { proof, blob: encodeProof(proof), publicSignals: [y, txHash] }
}
