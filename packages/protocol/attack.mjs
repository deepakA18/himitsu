#!/usr/bin/env node
// The attack this design has to survive.
//
// Transaction-hash binding stops someone ALTERING a transaction that was
// already proved. It does nothing about someone proving a malicious transaction
// from the start. A legitimate note owner can run the prover over any
// transaction they like, including one whose SENDER frame has nothing to do
// with spending their note.
//
// The pool is `tx.sender`, so a SENDER frame executes AS THE POOL. APPROVE
// grants execution authority over the transaction, not over one call -- so
// unless something constrains the frame layout, a valid proof for a 0.1 WETH
// note authorises the pool to make any call at all, including
// WETH.transfer(attacker, <entire pool balance>).
//
//   X1  drain via a SENDER frame targeting WETH directly
//   X2  drain via a SENDER frame targeting the pool with an unexpected selector
//   X3  spend with the VERIFY frame moved off index 0 (expiry-frame layout)
//
// Run against a node started with:
//   ethrex --dev --network fixtures/genesis/l1-hegota.json --mempool.max-verify-gas 1000000

import {
  DENOMINATION, MerkleTree, balanceOf, buildSpendTx, cast, cleanError, deploySystem,
  deposit, eth, iface, printFrames, RPC_URL, submit,
} from './ghost.mjs'
import { MODE_SENDER, MODE_VERIFY } from './frametx.mjs'

const ATTACKER = '0x614561d2d143621e126e87831aef287678b442b8'
const EXPIRY_VERIFIER = '0x0000000000000000000000000000000000008141'
const results = {}
const header = (t) => console.log(`\n=== ${t}`)

const encodeTransfer = (to, value) =>
  cast('sig', 'transfer(address,uint256)') +
  BigInt(to).toString(16).padStart(64, '0') +
  value.toString(16).padStart(64, '0')

async function main() {
  header('Deploying both pools')
  const system = await deploySystem({ withUncheckedPool: true })
  console.log(`  pool (checked)   ${system.pool}`)
  console.log(`  pool (unchecked) ${system.uncheckedPool}  <- same code minus the layout check`)

  // Two independent pools, each with its own tree and its own notes.
  const checked = { sys: system, tree: await MerkleTree.create(), notes: [] }
  const unchecked = {
    sys: { ...system, pool: system.uncheckedPool, depositPool: system.uncheckedPool },
    tree: await MerkleTree.create(),
    notes: [],
  }
  for (let i = 0; i < 3; i++) checked.notes.push(await deposit(checked.sys, checked.tree))
  for (let i = 0; i < 3; i++) unchecked.notes.push(await deposit(unchecked.sys, unchecked.tree))
  console.log(`  each holds ${eth(balanceOf(system.weth, system.pool))} WETH backing 3 notes`)
  console.log(`  the attacker legitimately owns ONE note in each (${eth(DENOMINATION)})`)

  // ---------------------------------------------------------------- X1
  header('X1. Valid proof + SENDER frame that transfers the whole pool balance')
  console.log('  the proof is freshly generated FOR this transaction -- nothing is rebound,')
  console.log('  so sig_hash binding has nothing to catch. Only the layout check can.')

  const drain = async (label, ctx, noteIndex) => {
    const pool = ctx.sys.pool
    const poolBalance = balanceOf(system.weth, pool)
    const before = balanceOf(system.weth, ATTACKER)
    const built = await buildSpendTx({
      system: ctx.sys, tree: ctx.tree, note: ctx.notes[noteIndex].note,
      leafIndex: ctx.notes[noteIndex].leafIndex, recipient: ATTACKER,
      // The sanctioned spend() frame is replaced by a direct WETH transfer.
      // A SENDER frame executes AS THE POOL, so this moves the pool's tokens.
      senderFrames: [{
        mode: MODE_SENDER, flags: 0x00, target: system.weth,
        gasLimit: 120_000n, stateGasLimit: 200_000n, value: 0n,
        data: encodeTransfer(ATTACKER, poolBalance),
      }],
    })
    const out = await submit(built.tx, { expect: 'either' })
    console.log(`\n  -- ${label}`)
    if (out.receipt) printFrames(out.receipt, ['VERIFY proof', 'SENDER WETH.transfer(attacker, ALL)'])
    else console.log(`     rejected   ${out.error}`)
    const stolen = balanceOf(system.weth, ATTACKER) - before
    console.log(`     attacker took ${eth(stolen)} against a ${eth(DENOMINATION)} note`)
    console.log(`     pool ${eth(poolBalance)} -> ${eth(balanceOf(system.weth, pool))}`)
    return stolen
  }

  const stolenUnchecked = await drain('WITHOUT the layout check', unchecked, 0)
  const stolenChecked = await drain('WITH the layout check', checked, 0)
  results.x1_uncheckedPoolIsDrained = stolenUnchecked > DENOMINATION
  results.x1_checkedPoolHolds = stolenChecked === 0n

  // ---------------------------------------------------------------- X2
  header('X2. Valid proof + SENDER frame calling the pool with another selector')
  const before2 = balanceOf(system.weth, ATTACKER)
  const poolBalance2 = balanceOf(system.weth, system.pool)
  const x2 = await buildSpendTx({
    system, tree: checked.tree, note: checked.notes[1].note, leafIndex: 1, recipient: ATTACKER,
    senderFrames: [{
      mode: MODE_SENDER, flags: 0x00, target: system.pool,
      gasLimit: 200_000n, stateGasLimit: 300_000n, value: 0n,
      // deposit() is a legitimate pool function; the point is that the frame
      // layout, not the target alone, is what has to be constrained.
      data: cast('sig', 'depositCredited(bytes32)') + '11'.repeat(32),
    }],
  })
  const out2 = await submit(x2.tx, { expect: 'either' })
  if (out2.receipt) printFrames(out2.receipt, ['VERIFY proof', 'SENDER pool.depositCredited'])
  else console.log(`  rejected      ${out2.error}`)
  console.log(`  attacker gained ${eth(balanceOf(system.weth, ATTACKER) - before2)}`)
  console.log(`  pool           ${eth(poolBalance2)} -> ${eth(balanceOf(system.weth, system.pool))}`)
  results.x2_unexpectedSelectorBlocked =
    balanceOf(system.weth, ATTACKER) - before2 === 0n

  // ---------------------------------------------------------------- X3
  header('X3. Honest spend whose VERIFY frame is NOT at index 0 (expiry frame first)')
  // EIP-8141 lets an expiry-verifier frame precede the validation prefix. Any
  // code that hardcodes "frame 0 is the verification frame" breaks here.
  const deadline = Math.floor(Date.now() / 1000) + 3600
  const expiryFrame = {
    mode: MODE_VERIFY, flags: 0x00, target: EXPIRY_VERIFIER,
    gasLimit: 30_000n, stateGasLimit: 0n, value: 0n,
    data: '0x' + deadline.toString(16).padStart(16, '0'),
  }
  const before3 = balanceOf(system.weth, ATTACKER)
  const x3 = await buildSpendTx({
    system, tree: checked.tree, note: checked.notes[2].note, leafIndex: 2, recipient: ATTACKER,
    prefixFrames: [expiryFrame],
  })
  const out3 = await submit(x3.tx, { expect: 'either' })
  if (out3.receipt) printFrames(out3.receipt, ['VERIFY expiry', 'VERIFY proof', 'SENDER spend'])
  else console.log(`  rejected      ${out3.error}`)
  const paid3 = balanceOf(system.weth, ATTACKER) - before3
  console.log(`  recipient got ${eth(paid3)} (an honest spend: should be ${eth(DENOMINATION)})`)
  results.x3_expiryLayoutWorks = paid3 === DENOMINATION

  header('Results')
  let ok = true
  for (const [name, value] of Object.entries(results)) {
    ok &&= value
    console.log(`  ${name.padEnd(32)} ${value ? 'PASS' : 'FAIL'}`)
  }
  console.log(`\n${ok ? 'the pool survived all three' : 'VULNERABLE -- see above'}`)
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error(`\nfailed: ${cleanError(err.message)}`)
  process.exit(1)
})
