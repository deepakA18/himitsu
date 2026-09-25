// A real Groth16 implementation over BN254 (alt_bn128), small enough to read.
//
// The circuit is the GhostSwap *placeholder* spend circuit:
//
//   signals: [ONE, y, txHash | x1, x2, txSq]      (3 public, 3 private)
//   C1:  x1 * x2     = y        knowledge of a factorisation of the public commitment
//   C2:  txHash * txHash = txSq  binds txHash into the QAP
//
// C2 looks pointless and is not. A public signal that appears in no constraint
// has A_i = B_i = C_i = 0, so its IC point is the identity and `vk_x` does not
// depend on it -- the classic unconstrained-public-input bug, under which a
// proof would verify against *any* txHash and the binding would be fake. C2 is
// the same trick circom's `txSq <== txHash * txHash` emits, and it is what makes
// swapping the recipient invalidate the proof.
//
// The trusted setup here is a toy: this file knows alpha/beta/gamma/delta/tau,
// so anyone reading it can forge proofs. That is fine for a devnet milestone --
// the Groth16 algebra, the proof, and the on-chain pairing check are all real --
// and it is the one thing that must be replaced by a real ceremony.

import { bn254 } from '@noble/curves/bn254.js'

const G1 = bn254.G1.Point
const G2 = bn254.G2.Point
export const R = bn254.fields.Fr.ORDER

// ------------------------------------------------------------- field helpers

export const fr = (x) => ((BigInt(x) % R) + R) % R
const add = (a, b) => fr(a + b)
const sub = (a, b) => fr(a - b)
const mul = (a, b) => fr(a * b)
const inv = (a) => {
  // Fermat: a^(r-2) mod r
  let base = fr(a)
  let e = R - 2n
  let acc = 1n
  while (e > 0n) {
    if (e & 1n) acc = mul(acc, base)
    base = mul(base, base)
    e >>= 1n
  }
  return acc
}
const div = (a, b) => mul(a, inv(b))

// -------------------------------------------------------- polynomials over Fr
// Coefficient form, little-endian: p[0] + p[1]*X + ...

const pTrim = (p) => {
  const q = [...p]
  while (q.length > 1 && q[q.length - 1] === 0n) q.pop()
  return q
}
const pAdd = (a, b) => {
  const out = new Array(Math.max(a.length, b.length)).fill(0n)
  for (let i = 0; i < out.length; i++) out[i] = add(a[i] ?? 0n, b[i] ?? 0n)
  return pTrim(out)
}
const pSub = (a, b) => {
  const out = new Array(Math.max(a.length, b.length)).fill(0n)
  for (let i = 0; i < out.length; i++) out[i] = sub(a[i] ?? 0n, b[i] ?? 0n)
  return pTrim(out)
}
const pMul = (a, b) => {
  const out = new Array(a.length + b.length - 1).fill(0n)
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) out[i + j] = add(out[i + j], mul(a[i], b[j]))
  return pTrim(out)
}
const pScale = (a, k) => pTrim(a.map((c) => mul(c, k)))
const pEval = (p, x) => p.reduceRight((acc, c) => add(mul(acc, x), c), 0n)

/** Exact division a / b; throws if the remainder is non-zero. */
const pDiv = (a, b) => {
  let rem = [...a]
  const q = new Array(Math.max(a.length - b.length + 1, 1)).fill(0n)
  const lead = b[b.length - 1]
  while (rem.length >= b.length && pTrim(rem).length >= b.length) {
    const shift = rem.length - b.length
    const factor = div(rem[rem.length - 1], lead)
    q[shift] = factor
    for (let i = 0; i < b.length; i++) {
      rem[shift + i] = sub(rem[shift + i], mul(factor, b[i]))
    }
    rem = pTrim(rem)
    if (rem.length === 1 && rem[0] === 0n) break
  }
  if (pTrim(rem).some((c) => c !== 0n)) throw new Error('polynomial division has a remainder')
  return pTrim(q)
}

/** Lagrange interpolation through (xs[i], ys[i]). */
const interpolate = (xs, ys) => {
  let acc = [0n]
  for (let i = 0; i < xs.length; i++) {
    let basis = [1n]
    let denom = 1n
    for (let j = 0; j < xs.length; j++) {
      if (i === j) continue
      basis = pMul(basis, [fr(-xs[j]), 1n])
      denom = mul(denom, sub(xs[i], xs[j]))
    }
    acc = pAdd(acc, pScale(basis, div(ys[i], denom)))
  }
  return acc
}

// ----------------------------------------------------------------- the R1CS

export const NUM_SIGNALS = 6
export const NUM_PUBLIC = 3 // [ONE, y, txHash]
const [ONE, Y, TXHASH, X1, X2, TXSQ] = [0, 1, 2, 3, 4, 5]

const vec = (entries) => {
  const v = new Array(NUM_SIGNALS).fill(0n)
  for (const [i, c] of entries) v[i] = fr(c)
  return v
}

// Constraint j is  <A_j, w> * <B_j, w> = <C_j, w>
const CONSTRAINTS = [
  { a: vec([[X1, 1n]]), b: vec([[X2, 1n]]), c: vec([[Y, 1n]]) },
  { a: vec([[TXHASH, 1n]]), b: vec([[TXHASH, 1n]]), c: vec([[TXSQ, 1n]]) },
]
const M = CONSTRAINTS.length
const POINTS = [1n, 2n] // the QAP evaluation domain

/** Full witness vector for the circuit. */
export function witness({ x1, x2, txHash }) {
  const w = new Array(NUM_SIGNALS).fill(0n)
  w[ONE] = 1n
  w[X1] = fr(x1)
  w[X2] = fr(x2)
  w[Y] = mul(w[X1], w[X2])
  w[TXHASH] = fr(txHash)
  w[TXSQ] = mul(w[TXHASH], w[TXHASH])
  return w
}

/** R1CS -> QAP: per-signal polynomials A_i, B_i, C_i interpolated over POINTS. */
function qap() {
  const A = [], B = [], C = []
  for (let i = 0; i < NUM_SIGNALS; i++) {
    A.push(interpolate(POINTS, CONSTRAINTS.map((k) => k.a[i])))
    B.push(interpolate(POINTS, CONSTRAINTS.map((k) => k.b[i])))
    C.push(interpolate(POINTS, CONSTRAINTS.map((k) => k.c[i])))
  }
  // Z(X) = prod (X - point)
  let Z = [1n]
  for (const p of POINTS) Z = pMul(Z, [fr(-p), 1n])
  return { A, B, C, Z }
}

// ------------------------------------------------------------------- setup

/** Toy trusted setup. `rand` lets tests pin the toxic waste. */
export function setup(rand = () => fr(BigInt('0x' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')))) {
  const { A, B, C, Z } = qap()
  const alpha = rand(), beta = rand(), gamma = rand(), delta = rand(), tau = rand()

  const At = A.map((p) => pEval(p, tau))
  const Bt = B.map((p) => pEval(p, tau))
  const Ct = C.map((p) => pEval(p, tau))
  const Zt = pEval(Z, tau)

  const g1 = (k) => G1.BASE.multiply(fr(k) === 0n ? 1n : fr(k)) // guard: multiply(0) throws
  const g2 = (k) => G2.BASE.multiply(fr(k) === 0n ? 1n : fr(k))
  const g1OrZero = (k) => (fr(k) === 0n ? G1.ZERO : G1.BASE.multiply(fr(k)))

  // IC_i = (beta*A_i(tau) + alpha*B_i(tau) + C_i(tau)) / gamma   for public i
  // L_i  = (beta*A_i(tau) + alpha*B_i(tau) + C_i(tau)) / delta   for private i
  const combined = (i) => add(add(mul(beta, At[i]), mul(alpha, Bt[i])), Ct[i])
  const IC = []
  for (let i = 0; i < NUM_PUBLIC; i++) IC.push(g1OrZero(div(combined(i), gamma)))
  const L = []
  for (let i = NUM_PUBLIC; i < NUM_SIGNALS; i++) L.push(g1OrZero(div(combined(i), delta)))

  // H query: tau^k * Z(tau) / delta for k = 0..M-2
  const H = []
  for (let k = 0; k <= M - 2; k++) {
    let tk = 1n
    for (let j = 0; j < k; j++) tk = mul(tk, tau)
    H.push(g1OrZero(div(mul(tk, Zt), delta)))
  }

  const pk = {
    alphaG1: g1(alpha),
    betaG1: g1(beta),
    betaG2: g2(beta),
    deltaG1: g1(delta),
    deltaG2: g2(delta),
    AG1: At.map(g1OrZero),
    BG1: Bt.map(g1OrZero),
    BG2: Bt.map((k) => (fr(k) === 0n ? G2.ZERO : G2.BASE.multiply(fr(k)))),
    L,
    H,
  }
  const vk = {
    alphaG1: g1(alpha),
    betaG2: g2(beta),
    gammaG2: g2(gamma),
    deltaG2: g2(delta),
    IC,
  }
  return { pk, vk }
}

// ------------------------------------------------------------------- prove

export function prove(pk, w, rand = () => fr(BigInt('0x' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')))) {
  const { A, B, C, Z } = qap()

  // h(X) = (A(X)B(X) - C(X)) / Z(X) where A(X) = sum w_i A_i(X)
  let Aw = [0n], Bw = [0n], Cw = [0n]
  for (let i = 0; i < NUM_SIGNALS; i++) {
    Aw = pAdd(Aw, pScale(A[i], w[i]))
    Bw = pAdd(Bw, pScale(B[i], w[i]))
    Cw = pAdd(Cw, pScale(C[i], w[i]))
  }
  const h = pDiv(pSub(pMul(Aw, Bw), Cw), Z) // throws if the witness is unsatisfying

  const r = rand(), s = rand()
  const msum = (points, scalars, zero) =>
    points.reduce(
      (acc, P, i) => (fr(scalars[i]) === 0n || P.is0?.() ? acc : acc.add(P.multiply(fr(scalars[i])))),
      zero,
    )

  // A = alpha + sum w_i A_i(tau) + r*delta
  const Apt = pk.alphaG1.add(msum(pk.AG1, w, G1.ZERO)).add(pk.deltaG1.multiply(r))
  // B (G2) = beta + sum w_i B_i(tau) + s*delta ; and the same in G1 for C below
  const Bpt2 = pk.betaG2.add(msum(pk.BG2, w, G2.ZERO)).add(pk.deltaG2.multiply(s))
  const Bpt1 = pk.betaG1.add(msum(pk.BG1, w, G1.ZERO)).add(pk.deltaG1.multiply(s))

  // C = sum_{private} w_i L_i + sum h_k H_k + s*A + r*B1 - r*s*delta
  let Cpt = msum(pk.L, w.slice(NUM_PUBLIC), G1.ZERO)
  Cpt = Cpt.add(msum(pk.H, h, G1.ZERO))
  Cpt = Cpt.add(Apt.multiply(s)).add(Bpt1.multiply(r))
  Cpt = Cpt.subtract(pk.deltaG1.multiply(mul(r, s)))

  return { a: Apt, b: Bpt2, c: Cpt }
}

// ------------------------------------------------------------------ verify
// e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1

export function verify(vk, proof, publicSignals) {
  let vkx = vk.IC[0]
  for (let i = 0; i < publicSignals.length; i++) {
    const s = fr(publicSignals[i])
    if (s !== 0n) vkx = vkx.add(vk.IC[i + 1].multiply(s))
  }
  const out = bn254.pairingBatch([
    { g1: proof.a.negate(), g2: proof.b },
    { g1: vk.alphaG1, g2: vk.betaG2 },
    { g1: vkx, g2: vk.gammaG2 },
    { g1: proof.c, g2: vk.deltaG2 },
  ])
  return bn254.fields.Fp12.eql(out, bn254.fields.Fp12.ONE)
}

// ------------------------------------------------------------- EVM encoding

const hex32 = (x) => BigInt(x).toString(16).padStart(64, '0')

/** G1 as the precompiles want it: x || y, 32 bytes each. */
export const g1ToWords = (P) => {
  const { x, y } = P.toAffine()
  return [x, y]
}
/**
 * G2 for the EVM: the imaginary coefficient comes FIRST in each coordinate
 * (x_c1, x_c0, y_c1, y_c0). Getting this backwards is the classic Groth16
 * integration bug, so `verify-evm-encoding` in the test suite pins it against
 * the on-chain precompile rather than trusting this comment.
 */
export const g2ToWords = (P) => {
  const { x, y } = P.toAffine()
  return [x.c1, x.c0, y.c1, y.c0]
}

/** The 256-byte proof blob carried in the ARBITRARY signature entry. */
export function encodeProof(proof) {
  const words = [...g1ToWords(proof.a), ...g2ToWords(proof.b), ...g1ToWords(proof.c)]
  return '0x' + words.map(hex32).join('')
}

/** The verifying key, flattened for embedding in the Solidity verifier. */
export function encodeVk(vk) {
  return {
    alpha: g1ToWords(vk.alphaG1),
    beta: g2ToWords(vk.betaG2),
    gamma: g2ToWords(vk.gammaG2),
    delta: g2ToWords(vk.deltaG2),
    ic: vk.IC.map(g1ToWords),
  }
}
