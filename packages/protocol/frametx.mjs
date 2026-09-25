// EIP-8141 frame transactions: encoding, sig_hash, and RPC plumbing.
//
// Wire format, from crates/common/types/transaction.rs:
//   0x06 || rlp([chainId, nonce, sender, frames, signatures, fees, blobHashes])
//   frame     = [mode, flags, target, [execution, state], value, data]
//   signature = [scheme, signer, msg, signature]
//   fees      = [maxPriorityFeePerGas, maxFeePerGas, maxFeePerBlobGas]

import { keccak_256 } from '@noble/hashes/sha3.js'

export const FRAME_TX_TYPE = 0x06
export const MODE_DEFAULT = 0
export const MODE_VERIFY = 1
export const MODE_SENDER = 2
export const APPROVE_PAYMENT = 0x01
export const APPROVE_EXECUTION = 0x02
export const APPROVE_EXECUTION_AND_PAYMENT = 0x03
export const SCHEME_ARBITRARY = 0
export const SCHEME_SECP256K1 = 1

export const hexToBytes = (hex) => {
  const s = String(hex).replace(/^0x/, '')
  return Uint8Array.from(Buffer.from(s.length % 2 ? '0' + s : s, 'hex'))
}
export const bytesToHex = (b) => '0x' + Buffer.from(b).toString('hex')

// -------------------------------------------------------------------- RLP

export function rlpInt(value) {
  const v = BigInt(value)
  if (v < 0n) throw new Error('negative')
  if (v === 0n) return new Uint8Array(0)
  let hex = v.toString(16)
  if (hex.length % 2) hex = '0' + hex
  return hexToBytes(hex)
}

const rlpLength = (len, offset) => {
  if (len < 56) return Uint8Array.from([offset + len])
  const lenBytes = rlpInt(len)
  return Uint8Array.from([offset + 55 + lenBytes.length, ...lenBytes])
}

export function rlp(input) {
  if (Array.isArray(input)) {
    const payload = Buffer.concat(input.map((i) => Buffer.from(rlp(i))))
    return Uint8Array.from(Buffer.concat([Buffer.from(rlpLength(payload.length, 0xc0)), payload]))
  }
  const bytes = input instanceof Uint8Array ? input : hexToBytes(input)
  if (bytes.length === 1 && bytes[0] < 0x80) return bytes
  return Uint8Array.from(Buffer.concat([Buffer.from(rlpLength(bytes.length, 0x80)), Buffer.from(bytes)]))
}

// --------------------------------------------------------------- encoding

const encodeFrame = (f) => [
  rlpInt(f.mode),
  rlpInt(f.flags ?? 0),
  f.target ? hexToBytes(f.target) : new Uint8Array(0),
  [rlpInt(f.gasLimit), rlpInt(f.stateGasLimit ?? 0)],
  rlpInt(f.value ?? 0),
  hexToBytes(f.data ?? '0x'),
]

const encodeSignature = (s) => [
  rlpInt(s.scheme),
  s.signer ? hexToBytes(s.signer) : new Uint8Array(0),
  hexToBytes(s.msg ?? '0x'),
  hexToBytes(s.signature ?? '0x'),
]

const txFields = (tx, signatures) => [
  rlpInt(tx.chainId),
  rlpInt(tx.nonce),
  hexToBytes(tx.sender),
  tx.frames.map(encodeFrame),
  signatures.map(encodeSignature),
  [
    rlpInt(tx.maxPriorityFeePerGas),
    rlpInt(tx.maxFeePerGas),
    rlpInt(tx.maxFeePerBlobGas ?? 0),
  ],
  (tx.blobVersionedHashes ?? []).map(hexToBytes),
]

export function serialize(tx) {
  const body = rlp(txFields(tx, tx.signatures ?? []))
  return bytesToHex(Uint8Array.from([FRAME_TX_TYPE, ...body]))
}

/**
 * The canonical sig_hash, which TXPARAM(0x08) hands to the account's code.
 *
 * A signature whose `msg` is empty has its raw bytes ELIDED here -- a signature
 * cannot commit to itself. That is the hinge of this whole design: the Groth16
 * proof rides in such a signature entry, so it can name a hash that covers every
 * frame (target, value, data, nonce, chain id) without covering the proof.
 * Frame `data`, by contrast, is hashed verbatim, so a proof placed there could
 * never commit to the hash of the transaction carrying it.
 */
export function sigHash(tx) {
  const elided = (tx.signatures ?? []).map((s) =>
    (s.msg ?? '0x') === '0x' ? { ...s, signature: '0x' } : s,
  )
  const body = rlp(txFields(tx, elided))
  const buf = Uint8Array.from([FRAME_TX_TYPE, ...body])
  return '0x' + Buffer.from(keccak_256(buf)).toString('hex')
}

// -------------------------------------------------------------------- RPC

export function makeRpc(url) {
  let id = 0
  return async function rpc(method, params = []) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    })
    const body = await res.json()
    if (body.error) {
      const err = new Error(body.error.message ?? JSON.stringify(body.error))
      err.rpc = body.error
      throw err
    }
    return body.result
  }
}

export async function waitForReceipt(rpc, hash, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const r = await rpc('eth_getTransactionReceipt', [hash])
    if (r) return r
    await new Promise((res) => setTimeout(res, 300))
  }
  throw new Error(`no receipt for ${hash} within ${timeoutMs}ms`)
}
