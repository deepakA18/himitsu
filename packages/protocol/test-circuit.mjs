import assert from 'node:assert/strict'
// Offline: does the real circuit prove and verify, and does the binding hold?
import { MerkleTree, createNote, proveSpend, verifyOffline, poseidon } from './notes.mjs'

const tree = await MerkleTree.create()
const notes = [await createNote(), await createNote(), await createNote()]
notes.forEach((n) => tree.insert(n.commitment))

const recipient = '0xe25583099ba105d9ec0a67f5ae86d90e50036425'
const txHash = '0x' + 'ab'.repeat(32)
const t0 = Date.now()
const { proof, publicSignals } = await proveSpend({ note: notes[1], tree, leafIndex: 1, recipient, txHash })
console.log(`proved in ${Date.now() - t0}ms; public signals:`, publicSignals.length)
console.log('  [root, nullifierHash, recipient, txHashHi, txHashLo]')
assert.equal(await verifyOffline(proof, publicSignals), true, 'valid proof must verify')

// altered recipient
const altered = [...publicSignals]; altered[2] = (BigInt(altered[2]) + 1n).toString()
assert.equal(await verifyOffline(proof, altered), false, 'altered must fail')
// altered digest limbs (i.e. any change to the transaction)
const reboundHi = [...publicSignals]; reboundHi[3] = (BigInt(reboundHi[3]) + 1n).toString()
assert.equal(await verifyOffline(proof, reboundHi), false, 'reboundHi must fail')
const reboundLo = [...publicSignals]; reboundLo[4] = (BigInt(reboundLo[4]) + 1n).toString()
assert.equal(await verifyOffline(proof, reboundLo), false, 'reboundLo must fail')
// wrong root (note not in that tree)
const wrongRoot = [...publicSignals]; wrongRoot[0] = (BigInt(wrongRoot[0]) + 1n).toString()
assert.equal(await verifyOffline(proof, wrongRoot), false, 'wrongRoot must fail')

// a note that is NOT in the tree must not be provable
const outsider = await createNote()
await assert.rejects(() => proveSpend({ note: outsider, tree, leafIndex: 0, recipient, txHash }))
console.log('PASS: valid membership and all proof-binding rejection checks')
process.exit(0)
