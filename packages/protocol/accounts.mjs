// The two EIP-8141 accounts of the Himitsu milestone, in EVM assembly.
//
// Operand order note: every handler in levm pops its operands top-of-stack
// first, so `let [a, b, c] = stack.pop()` means `a` was pushed LAST. Each
// sequence below therefore pushes its arguments in reverse.

import { keccak_256 } from '@noble/hashes/sha3.js'
import { assemble } from './asm.mjs'

/** BN254 scalar field; sig_hash is reduced mod this before it becomes a signal. */
export const R_SCALAR =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n

/** Derived, not hardcoded: `verify(uint256[8],uint256[2])` -> 0xf4fd6a1f. */
export const VERIFY_SIGNATURE = 'verify(uint256[8],uint256[2])'
export const VERIFY_SELECTOR = BigInt(
  '0x' + Buffer.from(keccak_256(Buffer.from(VERIFY_SIGNATURE))).toString('hex').slice(0, 8),
)

// Calldata for the verifier, built at memory 0:
//   0x0000  selector          4 bytes
//   0x0004  proof[8]        256 bytes   <- SIGDATACOPY from signatures[0]
//   0x0104  input[0] = y     32 bytes   <- immutable note commitment
//   0x0124  input[1] = hash  32 bytes   <- TXPARAM(sig_hash) mod R
//   total 0x0144 = 324 bytes
const ARGS_LEN = 0x0144
const RET_AT = 0x0200
const PROOF_LEN = 256

/**
 * The Himitsu account. Its code IS the account's validation logic: a VERIFY
 * frame targeting this address runs it, and it grants approval only when a
 * Groth16 proof bound to this exact transaction verifies.
 *
 * @param verifier  address of the deployed Groth16Verifier
 * @param y         public note commitment, the circuit's first public signal
 */
export function zkAccountRuntime(verifier, y) {
  return assemble([
    // A plain ETH transfer into this account is a CALL with empty calldata that
    // runs this same code. APPROVE and friends halt outside a frame tx, so the
    // account could never be funded without this guard. VERIFY frames carry one
    // marker byte, which sig_hash covers like any other frame field.
    'CALLDATASIZE', 'ISZERO', ['PUSHLABEL', 'funding'], 'JUMPI',

    // mem[0x00] = selector, left-aligned.
    ['PUSH', VERIFY_SELECTOR << 224n, 32], ['PUSH', 0], 'MSTORE',

    // SIGDATACOPY pops [memOffset, dataOffset, length, signatureIndex].
    // Copy the 256-byte proof out of the ARBITRARY signature entry. Those bytes
    // are elided from sig_hash, which is exactly why the proof can commit to it.
    ['PUSH', 0],          // signatureIndex
    ['PUSH', PROOF_LEN],  // length
    ['PUSH', 0],          // dataOffset
    ['PUSH', 4],          // memOffset
    'SIGDATACOPY',

    // input[0] = y
    ['PUSH', y, 32], ['PUSH', 0x0104], 'MSTORE',

    // input[1] = TXPARAM(0x08) mod R. MOD pops [a, b] and computes a % b, so R
    // goes on the stack first and the hash lands on top.
    ['PUSH', R_SCALAR, 32],
    ['PUSH', 0x08], 'TXPARAM',
    'MOD',
    ['PUSH', 0x0124], 'MSTORE',

    // STATICCALL pops [gas, address, argsOffset, argsLength, retOffset, retLength].
    // The gas figure is a literal, never the GAS opcode: during mempool
    // validation `GAS` is legal only immediately before a *CALL, and a stray one
    // would get the transaction dropped. EIP-150 caps an over-large request.
    ['PUSH', 32],         // retLength
    ['PUSH', RET_AT],     // retOffset
    ['PUSH', ARGS_LEN],   // argsLength
    ['PUSH', 0],          // argsOffset
    ['PUSH', verifier, 20],
    ['PUSH', 300000],     // gas
    'STATICCALL',
    'ISZERO', ['PUSHLABEL', 'reject'], 'JUMPI',   // the call itself failed
    ['PUSH', RET_AT], 'MLOAD',
    'ISZERO', ['PUSHLABEL', 'reject'], 'JUMPI',   // verify() returned false

    // Proof is good: approve with whatever scope this frame is allowed to grant.
    // Reading it from FRAMEPARAM rather than hardcoding 0x03 is what lets the
    // same account work self-paying (scope 3) and sponsored (scope 2).
    // FRAMEPARAM pops [frameIndex, paramId]; TXPARAM 0x0A is the current index.
    ['PUSH', 0x06],                    // paramId: allowed_scope
    ['PUSH', 0x0A], 'TXPARAM',         // frameIndex: this frame
    'FRAMEPARAM',
    // APPROVE pops [offset, length, scope]; scope is already on the stack.
    ['PUSH', 0], ['PUSH', 0],
    'APPROVE',

    ['JUMPDEST', 'funding'],
    'STOP',

    // Revert rather than fall through: an unapproved VERIFY frame would fail the
    // transaction anyway, but reverting makes the mempool reject it with a
    // validation error instead of letting it look like a successful frame.
    ['JUMPDEST', 'reject'],
    ['PUSH', 0], ['PUSH', 0], 'REVERT',
  ])
}

/**
 * The sponsor (paymaster). It approves *payment only*, and only for one
 * specific sender -- a policy check, so it is not a faucet for the whole chain.
 * A production paymaster would check far more (rate limits, a subsidised-action
 * allowlist, its own accounting), all of it under the same validation-trace
 * rules: no foreign storage, no banned opcodes.
 */
export function sponsorRuntime(sponsoredSender) {
  return assemble([
    'CALLDATASIZE', 'ISZERO', ['PUSHLABEL', 'funding'], 'JUMPI',

    // Refuse to pay for anyone but our user. TXPARAM 0x02 is tx.sender.
    ['PUSH', sponsoredSender, 20],
    ['PUSH', 0x02], 'TXPARAM',
    'EQ',
    'ISZERO', ['PUSHLABEL', 'reject'], 'JUMPI',

    ['PUSH', 0x06],
    ['PUSH', 0x0A], 'TXPARAM',
    'FRAMEPARAM',
    ['PUSH', 0], ['PUSH', 0],
    'APPROVE',

    ['JUMPDEST', 'funding'],
    'STOP',
    ['JUMPDEST', 'reject'],
    ['PUSH', 0], ['PUSH', 0], 'REVERT',
  ])
}
