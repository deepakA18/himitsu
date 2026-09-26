// Shared wiring for the Himitsu demos: deploy the system, build spend
// transactions, submit them.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APPROVE_EXECUTION, APPROVE_EXECUTION_AND_PAYMENT, APPROVE_PAYMENT,
  MODE_SENDER, MODE_VERIFY, SCHEME_ARBITRARY,
  makeRpc, serialize, sigHash, waitForReceipt,
} from './frametx.mjs'
import { introspectorRuntime, spendValidatorRuntime } from './frameasm.mjs'
import { sponsorRuntime } from './accounts.mjs'
import { makeDeployer } from './deploy.mjs'
import { FIELD_SIZE, MerkleTree, createNote, proveSpend, toHex32 } from './notes.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

export const RPC_URL = process.env.RPC_URL ?? 'http://localhost:8545'
export const FUNDER_KEY = process.env.PRIVATE_KEY ??
  '0x941e103320615d394a55708be13e45994c7d93b932b064dbcb2b511fe3254e2e'
export const FUNDER = '0x8943545177806ed17b9f23f0a21ee5948ecaa776'
export const DENOMINATION = 100_000_000_000_000_000n // 0.1 ETH

export const VERIFY_FRAME_GAS = 500_000n
export const PAY_FRAME_GAS = 50_000n
export const SPEND_FRAME_GAS = 200_000n
export const SPEND_FRAME_STATE_GAS = 300_000n

export const rpc = makeRpc(RPC_URL)
export const deployer = makeDeployer({ rpcUrl: RPC_URL, privateKey: FUNDER_KEY })
const { cast, send, deployAsm, deploySol, deployRaw, artifact } = deployer

export const iface = {
  validateSpend: cast('sig', 'validateSpend(bytes32,bytes32,address)'),
  spend: cast('sig', 'spend()'),
  spendAndSwapToNote: cast('sig', 'spendAndSwapToNote(address,uint256,uint256,address,bytes32)'),
  spendAndSwapToRecipient: cast('sig', 'spendAndSwapToRecipient(address,uint256,uint256,address)'),
  depositCredited: cast('sig', 'depositCredited(bytes32)'),
}

/** Calldata for the one sanctioned swap entry point. */
export const encodeSpendAndSwap = ({ pair, amount0Out, amount1Out, outPool, outCommitment }) =>
  iface.spendAndSwapToNote +
  BigInt(pair).toString(16).padStart(64, '0') +
  amount0Out.toString(16).padStart(64, '0') +
  amount1Out.toString(16).padStart(64, '0') +
  BigInt(outPool).toString(16).padStart(64, '0') +
  BigInt(outCommitment).toString(16).padStart(64, '0')

export const encodeSpendAndSwapToRecipient = ({ pair, minOut, recipient }) =>
  cast('sig', 'spendAndSwapToRecipient(address,uint256,address)') +
  BigInt(pair).toString(16).padStart(64, '0') +
  minOut.toString(16).padStart(64, '0') +
  BigInt(recipient).toString(16).padStart(64, '0')

export const eth = (wei) => `${(Number(wei) / 1e18).toFixed(6)} ETH`
export const pad = (s, n) => String(s).padEnd(n)

/** The gUSD pool's note size; chosen so one WETH note buys more than one. */
export const GUSD_DENOMINATION = 150_000_000_000_000_000_000n // 150 gUSD

/** Deploy the whole system and return its addresses. */
export async function deploySystem({ withStockVerifier = false, withUncheckedPool = false, withLegacySponsor = true, fundPool = true } = {}) {
  const poseidon = JSON.parse(readFileSync(join(HERE, 'poseidon.json')))

  const weth = deploySol('WETH9')
  const hasher = deployRaw('Poseidon(2)', poseidon.two.bytecode)
  const verifier = deploySol('SpendVerifier')
  const introspector = deployAsm('FrameIntrospector', introspectorRuntime())
  const validator = deployAsm('SpendValidator', spendValidatorRuntime(verifier))

  const poolArgs = (token, wrapsEth, denom, validatorAddress) => ({
    signature: 'constructor(address,address,bool,uint256,address,address)',
    values: [hasher, token, String(wrapsEth), denom.toString(), validatorAddress, introspector],
  })

  const pool = deploySol('GhostPool', { args: poolArgs(weth, true, DENOMINATION, validator) })
  if (fundPool) send('--value', '5ether', pool)

  const sponsor = withLegacySponsor ? deployAsm('Sponsor', sponsorRuntime(pool)) : null
  if (sponsor) send('--value', '5ether', sponsor)

  let stockVerifier = null
  let stockValidator = null
  if (withStockVerifier) {
    stockVerifier = deploySol('SpendVerifierStock')
    stockValidator = deployAsm('SpendValidatorStock', spendValidatorRuntime(stockVerifier))
  }

  let uncheckedPool = null
  if (withUncheckedPool) {
    uncheckedPool = deploySol('GhostPoolUnchecked', {
      args: poolArgs(weth, true, DENOMINATION, validator),
    })
    send('--value', '5ether', uncheckedPool)
  }

  return {
    weth, hasher, verifier, introspector, validator, pool, sponsor,
    stockVerifier, stockValidator, uncheckedPool,
    denomination: DENOMINATION,
  }
}

/**
 * Deploy the OFFICIAL Uniswap V2 factory and create a pair, using the artifacts
 * compiled by compile-uniswap.mjs with solc-js 0.5.16. No hand-written port is
 * involved in the swap path.
 */
export function deployUniswap(tokenA, tokenB) {
  const artifacts = JSON.parse(readFileSync(join(HERE, 'uniswap.json')))
  const args = cast('abi-encode', 'constructor(address)', FUNDER).replace(/^0x/, '')
  const { contractAddress: factory } = send('--create', artifacts.UniswapV2Factory.bytecode + args)

  send(factory, 'createPair(address,address)', tokenA, tokenB)
  const pair = cast('call', '--rpc-url', RPC_URL, factory, 'getPair(address,address)(address)', tokenA, tokenB)

  // The pair is created by the factory with CREATE2 from the Pair init code, so
  // check the deployed code against the artifact the same way deploy.mjs checks
  // its own deployments.
  const onChain = cast('code', '--rpc-url', RPC_URL, pair).toLowerCase()
  const expected = artifacts.UniswapV2Pair.deployedBytecode.toLowerCase()
  if (onChain !== expected) {
    throw new Error(
      `pair code differs from the compiled UniswapV2Pair (${onChain.length / 2 - 1} vs ${expected.length / 2 - 1} bytes)`,
    )
  }
  return { factory, pair, solcVersion: artifacts.solcVersion }
}

/** A second pool, for the token that comes out of the swap. */
export function deployTokenPool(system, token, denomination = GUSD_DENOMINATION, { fundPool = true } = {}) {
  const pool = deploySol('GhostPool', {
    args: {
      signature: 'constructor(address,address,bool,uint256,address,address)',
      values: [system.hasher, token, 'false', denomination.toString(), system.validator, system.introspector],
    },
  })
  if (fundPool) send('--value', '5ether', pool)
  return pool
}

/** Deposit one note: ETH in, WETH held by the pool, commitment in the tree. */
export async function deposit(system, tree) {
  const note = await createNote()
  const target = system.depositPool ?? system.pool
  const receipt = send(
    '--value', DENOMINATION.toString() + 'wei',
    target, 'depositETH(bytes32)', toHex32(note.commitment),
  )
  const leafIndex = tree.insert(note.commitment)

  // Cross-check: the contract's tree and this process's tree must agree, or the
  // witness we build later would be unprovable for reasons that are hard to see.
  const onChainRoot = BigInt(cast('call', '--rpc-url', RPC_URL, target, 'getLastRoot()(bytes32)'))
  const localRoot = tree.root()
  if (onChainRoot !== localRoot) {
    throw new Error(
      `merkle divergence after leaf ${leafIndex}:\n  chain ${toHex32(onChainRoot)}\n  local ${toHex32(localRoot)}`,
    )
  }
  return { note, leafIndex, root: localRoot, gasUsed: Number(receipt.gasUsed) }
}

async function baseFee() {
  const block = await rpc('eth_getBlockByNumber', ['latest', false])
  return BigInt(block.baseFeePerGas ?? '0x0')
}

const verifyFrameData = (root, nullifierHash, recipient) =>
  iface.validateSpend +
  BigInt(root).toString(16).padStart(64, '0') +
  BigInt(nullifierHash).toString(16).padStart(64, '0') +
  BigInt(recipient).toString(16).padStart(64, '0')

/**
 * Build a spend transaction and prove it against its own sig_hash.
 *
 * The proof cannot be made before the transaction exists (it commits to the
 * transaction) and the transaction is not sendable before the proof exists.
 * That is not circular only because sig_hash elides an ARBITRARY signature's
 * bytes: the hash is the same whether the signature slot is empty or holds the
 * finished proof.
 */
export async function buildSpendTx({
  system, tree, note, leafIndex, recipient, extraFrames = [],
  sponsored = system.automaticSponsor ?? false, corrupt = false, mutate = null, root = null, atomic = true,
  // Tests use these to bend the frame layout: `senderFrames` replaces the
  // default pool-targeted spend() frame, `prefixFrames` puts frames (an
  // expiry-verifier frame, say) ahead of the validation frame.
  senderFrames = null, prefixFrames = [],
}) {
  const fee = await baseFee()
  const nonce = Number(await rpc('eth_getTransactionCount', [system.pool, 'latest']))
  const usedRoot = root ?? tree.root()
  if (system.automaticSponsor && prefixFrames.length === 0) {
    const latest = await rpc('eth_getBlockByNumber', ['latest', false])
    const expiry = BigInt(latest.timestamp) + 120n
    prefixFrames = [{ mode: MODE_VERIFY, flags: 0, target: '0x0000000000000000000000000000000000008141',
      gasLimit: 5000n, stateGasLimit: 0n, value: 0n, data: '0x' + expiry.toString(16).padStart(16, '0') }]
  }

  const verifyFrame = {
    mode: MODE_VERIFY,
    flags: sponsored ? APPROVE_EXECUTION : APPROVE_EXECUTION_AND_PAYMENT,
    target: null, // resolves to tx.sender: the pool verifies itself
    gasLimit: VERIFY_FRAME_GAS,
    stateGasLimit: 0n,
    value: 0n,
    data: verifyFrameData(usedRoot, note.nullifierHash, recipient),
  }
  const spendFrame = {
    mode: MODE_SENDER,
    // Atomic batch: link this frame to the next so the spend and whatever
    // follows it (the swap) either both happen or neither does.
    flags: extraFrames.length && atomic ? 0x04 : 0x00,
    target: system.pool,
    gasLimit: SPEND_FRAME_GAS,
    stateGasLimit: SPEND_FRAME_STATE_GAS,
    value: 0n,
    data: iface.spend,
  }
  const frames = [...prefixFrames, verifyFrame]
  if (sponsored) {
    frames.push({
      mode: MODE_VERIFY,
      flags: APPROVE_PAYMENT,
      target: system.sponsor,
      gasLimit: PAY_FRAME_GAS,
      stateGasLimit: 0n,
      value: 0n,
      data: system.sponsorCalldata ?? '0x01',
    })
  }
  if (senderFrames) frames.push(...senderFrames)
  else frames.push(spendFrame, ...extraFrames)

  const tx = {
    chainId: Number(await rpc('eth_chainId')),
    nonce,
    sender: system.pool,
    maxPriorityFeePerGas: 1_000_000_000n,
    maxFeePerGas: fee * 2n + 1_000_000_000n,
    maxFeePerBlobGas: 0n,
    blobVersionedHashes: [],
    frames,
    signatures: [{ scheme: SCHEME_ARBITRARY, msg: '0x', signature: '0x' }],
  }

  const hash = sigHash(tx)
  const { blob, publicSignals } = await proveSpend({
    note, tree, leafIndex, recipient, txHash: hash, root: usedRoot,
  })

  let proof = blob
  if (corrupt) {
    const bytes = Buffer.from(blob.slice(2), 'hex')
    bytes[255] ^= 0x01
    proof = '0x' + bytes.toString('hex')
  }
  tx.signatures = [{ scheme: SCHEME_ARBITRARY, msg: '0x', signature: proof }]

  const built = mutate ? mutate(tx) : tx
  return { tx: built, boundTo: hash, finalHash: sigHash(built), publicSignals, proofBlob: proof }
}

export async function submit(tx, { expect = 'mine' } = {}) {
  try {
    const hash = await rpc('eth_sendRawTransaction', [serialize(tx)])
    if (expect === 'reject') return { accepted: true, hash }
    return { accepted: true, hash, receipt: await waitForReceipt(rpc, hash) }
  } catch (err) {
    if (expect === 'reject' || expect === 'either') {
      return { accepted: false, error: cleanError(err.message) }
    }
    throw err
  }
}

export const cleanError = (message) =>
  message.replace('Invalid params: Frame transaction ', '').replace('validation-prefix simulation failed: ', '')

export function printFrames(receipt, labels) {
  console.log(
    `  mined         block #${Number(receipt.blockNumber)}  status ${receipt.status === '0x1' ? 'success' : 'FAILED'}  gas ${Number(receipt.gasUsed)}`,
  )
  console.log(`  payer         ${receipt.payer ?? '(none)'}`)
  for (const [i, fr] of (receipt.frameReceipts ?? []).entries()) {
    const status = { '0x0': 'failure', '0x1': 'success', '0x2': 'skipped' }[fr.status] ?? fr.status
    console.log(
      `  frame ${i}       ${pad(labels[i] ?? '', 24)} ${pad(status, 8)} gas ${String(Number(fr.gasUsed)).padStart(7)}  state ${Number(fr.stateGasUsed)}`,
    )
  }
}

export const balanceOf = (token, who) =>
  BigInt(cast('call', '--rpc-url', RPC_URL, token, 'balanceOf(address)(uint256)', who).split(' ')[0])

export { cast, send, MerkleTree, createNote, toHex32, FIELD_SIZE, artifact }
