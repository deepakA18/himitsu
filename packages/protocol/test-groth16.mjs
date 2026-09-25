import { setup, prove, verify, witness, fr, R } from './groth16.mjs'
const { pk, vk } = setup()
const txHash = fr(0x1234567890abcdefn * 991n)
const w = witness({ x1: 7n, x2: 13n, txHash })
const proof = prove(pk, w)
const pub = [w[1], w[2]]            // [y, txHash]
console.log('y =', w[1], ' valid proof verifies:', verify(vk, proof, pub))
// wrong public input (a different tx) must fail
console.log('rebound to another txHash verifies:', verify(vk, proof, [w[1], fr(txHash + 1n)]))
// corrupted proof must fail
const bad = { ...proof, c: proof.c.add(proof.a) }
console.log('corrupted proof verifies:', verify(vk, bad, pub))
// unsatisfying witness must not even prove
try { prove(pk, (()=>{const b=[...w]; b[1]=fr(w[1]+1n); return b})()) ; console.log('BAD: proved a false statement') }
catch (e) { console.log('unsatisfying witness rejected at prove time:', e.message) }
