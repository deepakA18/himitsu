#!/usr/bin/env node
// The private asset lifecycle: deposit -> note -> proven spend, and the ways a
// spend must fail. The A-E suite from the previous milestone is carried over
// here onto the real circuit.
//
//   1  deposit            ETH -> WETH -> commitment in the pool's tree
//   A  valid spend        proof of ownership + membership, self-paid
//   B  corrupted proof    rejected at admission
//   C  altered recipient  rejected at admission (the binding)
//   2  double spend       rejected at admission (nullifier already published)
//   3  in-tx double spend rejected at execution (two SENDER frames, one note)
//   D  sponsored spend    mined, sponsor pays
//   E  stock verifier     rejected: BannedOpcode(GAS)
//
// Needs: ethrex --dev --network fixtures/genesis/l1-hegota.json
//               --mempool.max-verify-gas 1000000

import {
  DENOMINATION, MerkleTree, balanceOf, buildSpendTx, cast, cleanError, deploySystem,
  deposit, eth, iface, printFrames, rpc, submit, RPC_URL, toHex32,
} from './ghost.mjs'
import { MODE_SENDER } from './frametx.mjs'
import { FIELD_SIZE } from './notes.mjs'

const RECIPIENT = '0xe25583099ba105d9ec0a67f5ae86d90e50036425'
const OTHER = '0x614561d2d143621e126e87831aef287678b442b8'
const results = {}

const header = (t) => console.log(`\n=== ${t}`)

async function main() {
  header('Deploying')
  const system = await deploySystem({ withStockVerifier: true })
  for (const [name, address] of Object.entries(system)) {
    if (address) console.log(`  ${name.padEnd(15)} ${address}`)
  }
  console.log(`  (every deployment above was byte-compared against its artifact)`)

  // ---------------------------------------------------------------- 1
  header('1. Deposit: ETH -> WETH -> private note')
  const tree = await MerkleTree.create()
  const deposits = []
  for (let i = 0; i < 4; i++) deposits.push(await deposit(system, tree))
  for (const d of deposits) {
    console.log(
      `  leaf ${d.leafIndex}  gas ${String(d.gasUsed).padStart(7)}  root ${toHex32(d.root).slice(0, 18)}...  (contract root matches)`,
    )
  }
  const poolWeth = balanceOf(system.weth, system.pool)
  console.log(`  pool now holds ${eth(poolWeth)} of WETH backing ${deposits.length} notes`)
  results.depositGas = deposits[1].gasUsed

  // ---------------------------------------------------------------- A
  header('A. Valid spend (ownership + membership), self-paid')
  const before = balanceOf(system.weth, RECIPIENT)
  const spendA = await buildSpendTx({
    system, tree, note: deposits[0].note, leafIndex: 0, recipient: RECIPIENT,
  })
  const outA = await submit(spendA.tx)
  printFrames(outA.receipt, ['VERIFY proof', 'SENDER spend'])
  const gained = balanceOf(system.weth, RECIPIENT) - before
  console.log(`  recipient     +${eth(gained)} WETH (exactly the denomination: ${gained === DENOMINATION})`)
  console.log(`  nullifier     ${toHex32(deposits[0].note.nullifierHash).slice(0, 20)}... now published`)
  results.validationGas = Number(outA.receipt.frameReceipts[0].gasUsed)
  results.spendStateGas = Number(outA.receipt.frameReceipts[1].stateGasUsed)
  results.validSpend = outA.receipt.status === '0x1' && gained === DENOMINATION

  // ---------------------------------------------------------------- B
  header('B. Corrupted proof')
  const spendB = await buildSpendTx({
    system, tree, note: deposits[1].note, leafIndex: 1, recipient: RECIPIENT, corrupt: true,
  })
  console.log(`  sig_hash unchanged by the corruption: ${spendB.boundTo === spendB.finalHash}`)
  const outB = await submit(spendB.tx, { expect: 'reject' })
  console.log(`  rejected      ${outB.accepted ? 'NO -- ' + outB.hash : outB.error}`)
  results.corruptRejected = !outB.accepted

  // ---------------------------------------------------------------- C
  header('C. Valid proof, recipient swapped after proving')
  const spendC = await buildSpendTx({
    system, tree, note: deposits[1].note, leafIndex: 1, recipient: RECIPIENT,
    mutate: (tx) => {
      // Rewrite the recipient in the VERIFY frame's data, leaving the proof be.
      const data = tx.frames[0].data
      const swapped = data.slice(0, data.length - 40) + OTHER.replace(/^0x/, '')
      return { ...tx, frames: [{ ...tx.frames[0], data: swapped }, ...tx.frames.slice(1)] }
    },
  })
  console.log(`  proof names   ${RECIPIENT}`)
  console.log(`  tx now names  ${OTHER}`)
  console.log(`  sig_hash moved: ${spendC.boundTo !== spendC.finalHash}`)
  const outC = await submit(spendC.tx, { expect: 'reject' })
  console.log(`  rejected      ${outC.accepted ? 'NO -- ' + outC.hash : outC.error}`)
  results.alteredRecipientRejected = !outC.accepted

  // ---------------------------------------------------------------- 2
  header('2. Double spend: the same note again, in a later transaction')
  const spend2 = await buildSpendTx({
    system, tree, note: deposits[0].note, leafIndex: 0, recipient: RECIPIENT,
  })
  const out2 = await submit(spend2.tx, { expect: 'reject' })
  console.log(`  the proof itself is still valid; the pool refuses the nullifier`)
  console.log(`  rejected      ${out2.accepted ? 'NO -- ' + out2.hash : out2.error}`)
  results.doubleSpendRejected = !out2.accepted

  // ---------------------------------------------------------------- 3
  header('3. Two execution frames in one transaction (attempted in-tx double spend)')
  // This used to be caught at execution, by the nullifier check inside spend():
  // validation runs before any SENDER frame, so the nullifier still looks unspent
  // when the VERIFY frame inspects it. It is now refused earlier and harder -- the
  // frame-layout rule permits exactly one execution frame, so the transaction
  // never reaches a block. The execution-time check is retained as defence in
  // depth; see attack.mjs for why the layout rule exists at all.
  const spend3 = await buildSpendTx({
    system, tree, note: deposits[2].note, leafIndex: 2, recipient: RECIPIENT, atomic: false,
    extraFrames: [{
      mode: MODE_SENDER, flags: 0x00, target: system.pool,
      gasLimit: 200_000n, stateGasLimit: 300_000n, value: 0n, data: iface.spend,
    }],
  })
  const beforeDup = balanceOf(system.weth, RECIPIENT)
  const out3 = await submit(spend3.tx, { expect: 'reject' })
  console.log(`  rejected      ${out3.accepted ? 'NO -- ' + out3.hash : out3.error}`)
  const gained3 = balanceOf(system.weth, RECIPIENT) - beforeDup
  console.log(`  recipient     +${eth(gained3)} -- nothing moved at all`)
  results.inTxDoubleSpendBlocked = !out3.accepted && gained3 === 0n

  // ---------------------------------------------------------------- D
  header('D. Sponsored spend (sponsor pays, note owner pays nothing)')
  const poolEthBefore = BigInt(await rpc('eth_getBalance', [system.pool, 'latest']))
  const sponsorBefore = BigInt(await rpc('eth_getBalance', [system.sponsor, 'latest']))
  const spendD = await buildSpendTx({
    system, tree, note: deposits[3].note, leafIndex: 3, recipient: RECIPIENT, sponsored: true,
  })
  const outD = await submit(spendD.tx)
  printFrames(outD.receipt, ['VERIFY proof', 'VERIFY sponsor pays', 'SENDER spend'])
  const poolEthAfter = BigInt(await rpc('eth_getBalance', [system.pool, 'latest']))
  const sponsorAfter = BigInt(await rpc('eth_getBalance', [system.sponsor, 'latest']))
  console.log(`  pool ETH      ${poolEthBefore === poolEthAfter ? 'unchanged' : 'CHANGED'}`)
  console.log(`  sponsor ETH   -${eth(sponsorBefore - sponsorAfter)}`)
  console.log(`  payer         ${outD.receipt.payer} == sponsor: ${outD.receipt.payer?.toLowerCase() === system.sponsor.toLowerCase()}`)
  results.sponsoredSpend = outD.receipt.status === '0x1' && poolEthBefore === poolEthAfter

  // ---------------------------------------------------------------- E
  header('E. Same proof, stock snarkjs verifier (sub(gas(), 2000) unpatched)')
  const stockSystem = { ...system, validator: system.stockValidator }
  // Redeploy a pool wired to the unpatched validator, so only that differs.
  const stockPool = await deployStockPool(system)
  const stockTree = await MerkleTree.create()
  const stockDeposit = await deposit({ ...system, pool: stockPool }, stockTree)
  const spendE = await buildSpendTx({
    system: { ...stockSystem, pool: stockPool }, tree: stockTree,
    note: stockDeposit.note, leafIndex: 0, recipient: RECIPIENT,
  })
  const outE = await submit(spendE.tx, { expect: 'reject' })
  console.log(`  rejected      ${outE.accepted ? 'NO -- ' + outE.hash : outE.error}`)
  console.log(`  (0x5a = GAS: the stock export does sub(gas(), 2000) before each precompile)`)
  results.stockVerifierRejected = !outE.accepted

  // ------------------------------------------------------------ summary
  header('Gas')
  console.log(`  deposit (10 Poseidon hashes on chain)  ${results.depositGas}`)
  console.log(`  VERIFY frame: proof + tree/nullifier    ${results.validationGas}`)
  console.log(`  SENDER frame state gas (EIP-8037)       ${results.spendStateGas}`)
  console.log(`  pairing precompile alone                ${45000 + 4 * 34000}`)

  header('Results')
  let ok = true
  for (const [name, value] of Object.entries(results)) {
    if (typeof value === 'boolean') {
      ok &&= value
      console.log(`  ${name.padEnd(28)} ${value ? 'PASS' : 'FAIL'}`)
    }
  }
  console.log(`\n${ok ? 'all lifecycle checks passed' : 'SOME CHECKS FAILED'}`)
  process.exit(ok ? 0 : 1)
}

/** A second pool whose only difference is the unpatched validator. */
async function deployStockPool(system) {
  const { deployer } = await import('./ghost.mjs')
  void deployer
  const { makeDeployer } = await import('./deploy.mjs')
  const d = makeDeployer({
    rpcUrl: RPC_URL,
    privateKey: process.env.PRIVATE_KEY ??
      '0x941e103320615d394a55708be13e45994c7d93b932b064dbcb2b511fe3254e2e',
  })
  const pool = d.deploySol('GhostPool', {
    args: {
      signature: 'constructor(address,address,bool,uint256,address,address)',
      values: [
        system.hasher, system.weth, 'true', DENOMINATION.toString(),
        system.stockValidator, system.introspector,
      ],
    },
  })
  d.send('--value', '5ether', pool)
  return pool
}

main().catch((err) => {
  console.error(`\nfailed: ${cleanError(err.message)}`)
  process.exit(1)
})
