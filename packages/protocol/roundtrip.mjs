#!/usr/bin/env node
// The full private asset round trip.
//
//   R1  deposit        ETH -> WETH -> private WETH note
//   R2  Himitsu swap   WETH note -> pair -> private gUSD note   (one SENDER frame)
//   R3  withdraw       gUSD note -> a fresh recipient           (separate transaction)
//   R4  atomicity      make the swap fail; the WETH note must survive intact
//
// R3 is the point of the milestone. R2 alone only shows that a swap output
// landed somewhere; R3 shows the resulting note is a real, backed, spendable
// asset by spending it in a later transaction, from a different pool, with a
// different proof.
//
// Note that the whole of R2 is a single execution frame calling one sanctioned
// pool function. The atomic-batch flag is not used: with the payout, the swap
// and the note mint inside one call, an ordinary revert already makes them
// indivisible, and there is only one frame for validation to have to sanction.

import {
  DENOMINATION, GUSD_DENOMINATION, MerkleTree, balanceOf, buildSpendTx, cast, cleanError,
  createNote, deploySystem, deployTokenPool, deposit, encodeSpendAndSwap, eth, printFrames,
  RPC_URL, send, deployer, deployUniswap, submit, toHex32,
} from './ghost.mjs'
import { MODE_SENDER } from './frametx.mjs'

const RECIPIENT = '0xe25583099ba105d9ec0a67f5ae86d90e50036425'
const FUNDER = '0x8943545177806ed17b9f23f0a21ee5948ecaa776'
const results = {}
const header = (t) => console.log(`\n=== ${t}`)
const gusd = (v) => `${(Number(v) / 1e18).toFixed(4)} gUSD`

/** Uniswap V2 pricing, for reference; the swap below asks for less than this. */
const maxOut = (amountIn, reserveIn, reserveOut) =>
  (amountIn * 997n * reserveOut) / (reserveIn * 1000n + amountIn * 997n)

async function main() {
  header('Deploying')
  const system = await deploySystem()
  const token = deployer.deploySol('TestToken', {
    args: { signature: 'constructor(uint256)', values: ['1000000000000000000000000'] },
  })
  const { factory, pair, solcVersion } = deployUniswap(system.weth, token)
  console.log(`  uniswap       factory ${factory} (official v2-core, solc ${solcVersion})`)
  send('--value', '10ether', system.weth, 'deposit()')
  send(system.weth, 'transfer(address,uint256)', pair, '10000000000000000000')
  send(token, 'transfer(address,uint256)', pair, '20000000000000000000000')
  send(pair, 'mint(address)', FUNDER)

  const gusdPool = deployTokenPool(system, token)
  const wethIsToken0 =
    cast('call', '--rpc-url', RPC_URL, pair, 'token0()(address)').toLowerCase() ===
    system.weth.toLowerCase()
  console.log(`  WETH pool     ${system.pool}   (${eth(DENOMINATION)} notes)`)
  console.log(`  gUSD pool     ${gusdPool}   (${gusd(GUSD_DENOMINATION)} notes)`)
  console.log(`  pair          ${pair}   WETH is token${wethIsToken0 ? 0 : 1}`)

  const gusdSystem = { ...system, pool: gusdPool, depositPool: gusdPool }

  // ---------------------------------------------------------------- R1
  header('R1. Deposit: ETH -> WETH -> private note')
  const wethTree = await MerkleTree.create()
  const note = await deposit(system, wethTree)
  console.log(`  leaf ${note.leafIndex}  gas ${note.gasUsed}  (contract root matches)`)
  console.log(`  pool backs it with ${eth(balanceOf(system.weth, system.pool))} WETH`)

  // ---------------------------------------------------------------- R2
  header('R2. Himitsu: private WETH note -> swap -> private gUSD note')
  const gusdTree = await MerkleTree.create()
  const outputNote = await createNote()
  const reserves = cast('call', '--rpc-url', RPC_URL, pair, 'getReserves()(uint112,uint112)')
    .split('\n').map((r) => BigInt(r.split(' ')[0]))
  const [reserveIn, reserveOut] = wethIsToken0 ? [reserves[0], reserves[1]] : [reserves[1], reserves[0]]
  const best = maxOut(DENOMINATION, reserveIn, reserveOut)
  console.log(`  pair would give up to ${gusd(best)} for ${eth(DENOMINATION)}`)
  console.log(`  the pool asks for exactly one note: ${gusd(GUSD_DENOMINATION)} (surplus stays with the LPs)`)

  const swapData = encodeSpendAndSwap({
    pair,
    amount0Out: wethIsToken0 ? 0n : GUSD_DENOMINATION,
    amount1Out: wethIsToken0 ? GUSD_DENOMINATION : 0n,
    outPool: gusdPool,
    outCommitment: outputNote.commitment,
  })
  const built = await buildSpendTx({
    system, tree: wethTree, note: note.note, leafIndex: note.leafIndex,
    recipient: pair, // the proof names the pair as the destination
    senderFrames: [{
      mode: MODE_SENDER, flags: 0x00, target: system.pool,
      gasLimit: 900_000n, stateGasLimit: 1_500_000n, value: 0n,
      data: swapData,
    }],
  })
  const out2 = await submit(built.tx)
  printFrames(out2.receipt, ['VERIFY spend proof', 'SENDER spendAndSwapToNote'])
  if (out2.receipt.status !== '0x1') throw new Error('R2 reverted')

  gusdTree.insert(outputNote.commitment)
  const chainRoot = BigInt(cast('call', '--rpc-url', RPC_URL, gusdPool, 'getLastRoot()(bytes32)'))
  const rootsAgree = chainRoot === gusdTree.root()
  console.log(`  gUSD pool holds ${gusd(balanceOf(token, gusdPool))}, tree root matches: ${rootsAgree}`)
  console.log(`  output note commitment ${toHex32(outputNote.commitment).slice(0, 20)}...`)
  console.log(`  nobody held the gUSD in between: pair -> input pool -> output pool, minted atomically`)
  results.r2_swapMintedANote =
    rootsAgree && balanceOf(token, gusdPool) === GUSD_DENOMINATION

  // ---------------------------------------------------------------- R3
  header('R3. Withdraw the gUSD note -- a separate transaction, a separate proof')
  const before = balanceOf(token, RECIPIENT)
  const withdraw = await buildSpendTx({
    system: gusdSystem, tree: gusdTree,
    note: outputNote, leafIndex: 0, recipient: RECIPIENT,
  })
  const out3 = await submit(withdraw.tx)
  printFrames(out3.receipt, ['VERIFY spend proof', 'SENDER spend'])
  const received = balanceOf(token, RECIPIENT) - before
  console.log(`  recipient received ${gusd(received)} of real gUSD`)
  console.log(`  gUSD pool left     ${gusd(balanceOf(token, gusdPool))}`)
  results.r3_outputNoteIsSpendable = received === GUSD_DENOMINATION

  // ---------------------------------------------------------------- R4
  header('R4. Atomicity: the swap fails, so the WETH note must survive')
  const note4 = await deposit(system, wethTree)
  const doomed = await createNote()
  const greedy = best * 2n // more than the invariant permits
  const built4 = await buildSpendTx({
    system, tree: wethTree, note: note4.note, leafIndex: note4.leafIndex, recipient: pair,
    senderFrames: [{
      mode: MODE_SENDER, flags: 0x00, target: system.pool,
      gasLimit: 900_000n, stateGasLimit: 1_500_000n, value: 0n,
      data: encodeSpendAndSwap({
        pair,
        amount0Out: wethIsToken0 ? 0n : greedy,
        amount1Out: wethIsToken0 ? greedy : 0n,
        outPool: gusdPool,
        outCommitment: doomed.commitment,
      }),
    }],
  })
  const poolWethBefore = balanceOf(system.weth, system.pool)
  const out4 = await submit(built4.tx)
  printFrames(out4.receipt, ['VERIFY spend proof', 'SENDER spendAndSwapToNote (bad)'])
  const nullifierSpent = cast('call', '--rpc-url', RPC_URL, system.pool, 'spent(bytes32)(bool)',
    toHex32(note4.note.nullifierHash))
  console.log(`  pool WETH     ${eth(poolWethBefore)} -> ${eth(balanceOf(system.weth, system.pool))}`)
  console.log(`  nullifier spent? ${nullifierSpent} -- the note is still spendable`)
  results.r4_failedSwapLeavesNoteIntact =
    nullifierSpent === 'false' && poolWethBefore === balanceOf(system.weth, system.pool)

  header('Results')
  let ok = true
  for (const [name, value] of Object.entries(results)) {
    ok &&= value
    console.log(`  ${name.padEnd(32)} ${value ? 'PASS' : 'FAIL'}`)
  }
  console.log(`\n${ok ? 'round trip complete: the private output is a usable, backed asset' : 'SOME CHECKS FAILED'}`)
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error(`\nfailed: ${cleanError(err.message)}`)
  process.exit(1)
})
