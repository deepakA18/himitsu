#!/usr/bin/env node
// The Himitsu swap flow, joining deposit and spend.
//
//   S1  plain atomic swap     WETH -> gUSD with no allowance anywhere
//
// This is the allowance-free primitive on its own, from an ordinary account:
// two SENDER frames (transfer, then swap) linked by the atomic-batch flag. The
// note-funded version of the same trade is roundtrip.mjs R2, where both legs sit
// inside a single pool call instead.
//
// Uniswap V2 never pulls tokens: `swap` sends the output, then requires the
// invariant to hold against its own measured balance. The input therefore has
// to arrive first, which is normally what the router's `transferFrom` (and thus
// an allowance) is for. EIP-8141 replaces that with two SENDER frames linked by
// the atomic-batch flag: the transfer and the swap are one indivisible step, so
// no allowance is ever granted and none can be left dangling.

import {
  DENOMINATION, MerkleTree, balanceOf, buildSpendTx, cast, cleanError, deploySystem,
  deposit, eth, printFrames, RPC_URL, submit, send, deployer, deployUniswap, rpc,
} from './ghost.mjs'
import { MODE_SENDER, SCHEME_ARBITRARY, MODE_VERIFY, APPROVE_EXECUTION_AND_PAYMENT,
         makeRpc, serialize, sigHash, waitForReceipt } from './frametx.mjs'

const TRADER = '0x614561d2d143621e126e87831aef287678b442b8'
const results = {}
const header = (t) => console.log(`\n=== ${t}`)

/** Uniswap V2's exact pricing: 0.3% fee on the way in. */
const amountOut = (amountIn, reserveIn, reserveOut) => {
  const inWithFee = amountIn * 997n
  return (inWithFee * reserveOut) / (reserveIn * 1000n + inWithFee)
}

const iface = {
  swap: cast('sig', 'swap(uint256,uint256,address,bytes)'),
  transfer: cast('sig', 'transfer(address,uint256)'),
}

const encodeSwap = (amount0Out, amount1Out, to) =>
  iface.swap +
  amount0Out.toString(16).padStart(64, '0') +
  amount1Out.toString(16).padStart(64, '0') +
  BigInt(to).toString(16).padStart(64, '0') +
  (0x80).toString(16).padStart(64, '0') + // offset to `data`
  ''.padStart(64, '0') // data.length = 0

const encodeTransfer = (to, value) =>
  iface.transfer +
  BigInt(to).toString(16).padStart(64, '0') +
  value.toString(16).padStart(64, '0')

async function setupPair(system) {
  const token = deployer.deploySol('TestToken', {
    args: { signature: 'constructor(uint256)', values: ['1000000000000000000000000'] },
  })
  const { pair, solcVersion } = deployUniswap(system.weth, token)
  console.log(`  uniswap       official v2-core, solc ${solcVersion}`)

  // Seed liquidity: 10 WETH and 20,000 gUSD, sent then minted -- V2 style.
  send('--value', '10ether', system.weth, 'deposit()')
  send(system.weth, 'transfer(address,uint256)', pair, '10000000000000000000')
  send(token, 'transfer(address,uint256)', pair, '20000000000000000000000')
  send(pair, 'mint(address)', '0x8943545177806ed17b9f23f0a21ee5948ecaa776')

  const token0 = cast('call', '--rpc-url', RPC_URL, pair, 'token0()(address)')
  const wethIsToken0 = token0.toLowerCase() === system.weth.toLowerCase()
  const reserves = cast('call', '--rpc-url', RPC_URL, pair, 'getReserves()(uint112,uint112)')
    .split('\n').map((r) => BigInt(r.split(' ')[0]))
  console.log(`  pair          ${pair}`)
  console.log(`  token (gUSD)  ${token}`)
  console.log(`  reserves      ${eth(reserves[0])} / ${eth(reserves[1])}  (WETH is token${wethIsToken0 ? 0 : 1})`)
  return { token, pair, wethIsToken0, reserves }
}

/** The output leg of a WETH-in swap, priced from current reserves. */
function quote(market, amountIn) {
  const [r0, r1] = market.reserves
  const [reserveIn, reserveOut] = market.wethIsToken0 ? [r0, r1] : [r1, r0]
  const out = amountOut(amountIn, reserveIn, reserveOut)
  return {
    out,
    amount0Out: market.wethIsToken0 ? 0n : out,
    amount1Out: market.wethIsToken0 ? out : 0n,
  }
}

async function main() {
  header('Deploying')
  const system = await deploySystem()
  const market = await setupPair(system)

  // ------------------------------------------------------------------ S1
  header('S1. Allowance-free atomic swap (no private note yet)')
  // S1 uses a plain account, not the pool: it isolates the swap mechanics from
  // the proof machinery.
  send('--value', '1ether', system.weth, 'deposit()')

  const q1 = quote(market, DENOMINATION)
  console.log(`  swapping      ${eth(DENOMINATION)} WETH -> ${eth(q1.out)} gUSD (V2 pricing, 0.3% fee)`)
  const allowanceBefore = cast('call', '--rpc-url', RPC_URL, system.weth,
    'allowance(address,address)(uint256)', system.pool, market.pair).split(' ')[0]

  const traderBefore = balanceOf(market.token, TRADER)
  const s1 = await sendFrames(system, [
    {
      mode: MODE_SENDER, flags: 0x04, target: system.weth, // atomic with the swap
      gasLimit: 120_000n, stateGasLimit: 300_000n, value: 0n,
      data: encodeTransfer(market.pair, DENOMINATION),
    },
    {
      // The official pair writes both TWAP accumulators and the reserves on a
      // first swap, which costs far more than a port that omits them -- and
      // most of it lands in EIP-8037's separate state-gas dimension.
      mode: MODE_SENDER, flags: 0x00, target: market.pair,
      gasLimit: 500_000n, stateGasLimit: 900_000n, value: 0n,
      data: encodeSwap(q1.amount0Out, q1.amount1Out, TRADER),
    },
  ])
  printFrames(s1.receipt, ['VERIFY (plain)', 'SENDER transfer WETH', 'SENDER pair.swap'])
  const traderGained = balanceOf(market.token, TRADER) - traderBefore
  const allowanceAfter = cast('call', '--rpc-url', RPC_URL, system.weth,
    'allowance(address,address)(uint256)', system.pool, market.pair).split(' ')[0]
  console.log(`  trader got    ${eth(traderGained)} gUSD (expected ${eth(q1.out)})`)
  console.log(`  allowance     before ${allowanceBefore}, after ${allowanceAfter} -- never granted`)
  results.atomicSwap = traderGained === q1.out && allowanceAfter === '0'

  // S2 and S3 -- the note-funded swap and its rollback -- moved to roundtrip.mjs
  // when the pool gained its frame-layout rule. A spend is now exactly one
  // execution frame calling one sanctioned pool function, so a note-funded swap
  // is no longer assembled from separate transfer and swap frames the way S1 is.

  header('Results')
  let ok = true
  for (const [name, value] of Object.entries(results)) {
    ok &&= value
    console.log(`  ${name.padEnd(20)} ${value ? 'PASS' : 'FAIL'}`)
  }
  console.log(`\n${ok ? 'swap path verified' : 'SOME CHECKS FAILED'}`)
  process.exit(ok ? 0 : 1)
}

function currentReserves(market) {
  return cast('call', '--rpc-url', RPC_URL, market.pair, 'getReserves()(uint112,uint112)')
    .split('\n').map((r) => BigInt(r.split(' ')[0]))
}

/**
 * Send SENDER frames from the pool without a note: frame 0 is a VERIFY frame
 * that approves unconditionally, so S1 isolates the swap mechanics from the
 * proof machinery.
 */
async function sendFrames(system, frames) {
  const plainAccount = system.plainAccount ?? (system.plainAccount = await deployPlainAccount())
  const block = await rpc('eth_getBlockByNumber', ['latest', false])
  const fee = BigInt(block.baseFeePerGas ?? '0x0')
  // Retarget the frames at the plain account (it holds the WETH for S1).
  send(system.weth, 'transfer(address,uint256)', plainAccount, DENOMINATION.toString())
  const tx = {
    chainId: Number(await rpc('eth_chainId')),
    nonce: Number(await rpc('eth_getTransactionCount', [plainAccount, 'latest'])),
    sender: plainAccount,
    maxPriorityFeePerGas: 1_000_000_000n,
    maxFeePerGas: fee * 2n + 1_000_000_000n,
    maxFeePerBlobGas: 0n,
    blobVersionedHashes: [],
    frames: [
      {
        mode: MODE_VERIFY, flags: APPROVE_EXECUTION_AND_PAYMENT, target: null,
        gasLimit: 60_000n, stateGasLimit: 0n, value: 0n, data: '0x01',
      },
      ...frames,
    ],
    signatures: [],
  }
  const hash = await rpc('eth_sendRawTransaction', [serialize(tx)])
  return { receipt: await waitForReceipt(rpc, hash) }
}

async function deployPlainAccount() {
  const { assemble } = await import('./asm.mjs')
  const runtime = assemble([
    'CALLDATASIZE', 'ISZERO', ['PUSHLABEL', 'fund'], 'JUMPI',
    ['PUSH', 0x06], ['PUSH', 0x0a], 'TXPARAM', 'FRAMEPARAM',
    ['PUSH', 0], ['PUSH', 0], 'APPROVE',
    ['JUMPDEST', 'fund'], 'STOP',
  ])
  const address = deployer.deployAsm('PlainAccount', runtime)
  send('--value', '2ether', address)
  return address
}

main().catch((err) => {
  console.error(`\nfailed: ${cleanError(err.message)}`)
  process.exit(1)
})
