// The two pieces of GhostPool that Solidity cannot express.
//
// solc has no spelling for APPROVE (0xAA), TXPARAM (0xB0), FRAMEPARAM (0xB3),
// FRAMEDATACOPY (0xB2) or SIGDATACOPY (0xB5), and `verbatim` is available only
// in standalone Yul. Both contracts below are therefore assembled directly.

import { keccak_256 } from '@noble/hashes/sha3.js'
import { assemble } from './asm.mjs'

export const R_SCALAR =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n

/** snarkjs' exported entry point. */
export const VERIFY_PROOF_SIGNATURE = 'verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[5])'
export const VERIFY_PROOF_SELECTOR = BigInt(
  '0x' + Buffer.from(keccak_256(Buffer.from(VERIFY_PROOF_SIGNATURE))).toString('hex').slice(0, 8),
)

// Verifier calldata, built at memory 0:
//   0x000  selector                        4
//   0x004  pA[2] pB[2][2] pC[2]          256   <- SIGDATACOPY from signatures[0]
//   0x104  pubSignals[0] = root           32   <- from this call's calldata
//   0x124  pubSignals[1] = nullifierHash  32
//   0x144  pubSignals[2] = recipient      32
//   0x164  pubSignals[3] = txHashHi       32   <- TXPARAM(sig_hash) >> 128
//   0x184  pubSignals[4] = txHashLo       32   <- TXPARAM(sig_hash) & (2^128-1)
//   total 0x1a4 = 420 bytes
const VERIFIER_ARGS_LEN = 0x1a4
const RET_AT = 0x200
const PROOF_LEN = 256

/**
 * SpendValidator: delegatecalled by GhostPool from inside the VERIFY frame.
 *
 * Delegatecall matters. APPROVE requires the executing contract to BE the
 * frame's target, and levm's DELEGATECALL keeps `to` as the caller's `to`
 * (generic_call is handed `current_call_frame.to`), so the pool remains the
 * executing contract and the APPROVE below is legal.
 *
 * Calldata is the pool's own msg.data: validateSpend(bytes32,bytes32,address),
 * hence the offsets 4 / 36 / 68 past the selector.
 */
export function spendValidatorRuntime(verifier, amountBound = false) {
  const selector = amountBound ? BigInt("0x" + Buffer.from(keccak_256(Buffer.from(VERIFY_PROOF_SIGNATURE.replace("uint256[5]", "uint256[6]")))).toString("hex").slice(0,8)) : VERIFY_PROOF_SELECTOR;
  return assemble([
    // mem[0x00] = snarkjs verifier selector, left-aligned.
    ['PUSH', selector << 224n, 32], ['PUSH', 0], 'MSTORE',

    // The proof rides in the ARBITRARY signature entry, whose bytes sig_hash
    // elides -- which is what lets the proof commit to sig_hash.
    // SIGDATACOPY pops [memOffset, dataOffset, length, signatureIndex].
    ['PUSH', 0], ['PUSH', PROOF_LEN], ['PUSH', 0], ['PUSH', 4], 'SIGDATACOPY',

    // Public signals, in the order spend.circom declares them.
    ['PUSH', 4], 'CALLDATALOAD', ['PUSH', 0x104], 'MSTORE',  // root
    ['PUSH', 36], 'CALLDATALOAD', ['PUSH', 0x124], 'MSTORE', // nullifierHash
    ['PUSH', 68], 'CALLDATALOAD', ['PUSH', 0x144], 'MSTORE', // recipient

    // The digest goes in as two 128-bit limbs, not one reduced field element:
    // sig_hash is 256 bits and the scalar field is ~254, so `mod R` would map
    // distinct transactions onto the same signal.
    // SHR pops [shift, value], so the digest is pushed first.
    ['PUSH', 0x08], 'TXPARAM',
    'DUP1',
    ['PUSH', 128], 'SHR',
    ['PUSH', amountBound ? 0x184 : 0x164], 'MSTORE',                    // txHashHi
    ['PUSH', (1n << 128n) - 1n, 16], 'AND',
    ['PUSH', amountBound ? 0x1a4 : 0x184], 'MSTORE',                    // txHashLo

    ...(amountBound ? [['PUSH', 100], 'CALLDATALOAD', ['PUSH', 0x164], 'MSTORE'] : []),
    // STATICCALL pops [gas, address, argsOffset, argsLength, retOffset, retLength].
    ['PUSH', 32], ['PUSH', RET_AT], ['PUSH', VERIFIER_ARGS_LEN + (amountBound ? 32 : 0)], ['PUSH', 0],
    ['PUSH', verifier, 20],
    ['PUSH', 400000], // literal, never the GAS opcode
    'STATICCALL',
    'ISZERO', ['PUSHLABEL', 'reject'], 'JUMPI',
    ['PUSH', RET_AT], 'MLOAD',
    'ISZERO', ['PUSHLABEL', 'reject'], 'JUMPI',

    // Approve with exactly the scope this frame is allowed to grant, so one
    // account works both self-paying (0x03) and sponsored (0x02).
    ['PUSH', 0x06], ['PUSH', 0x0A], 'TXPARAM', 'FRAMEPARAM',
    ['PUSH', 0], ['PUSH', 0],
    'APPROVE',

    // APPROVE halts the frame, so this is only reached if it somehow returns.
    'STOP',

    ['JUMPDEST', 'reject'],
    ['PUSH', 0], ['PUSH', 0], 'REVERT',
  ])
}

/**
 * FrameIntrospector: a read-only window onto the three EIP-8141 introspection
 * opcodes, for Solidity callers.
 *
 * Calldata is three raw words -- [op, a, b] -- with no selector, because a
 * dispatcher would cost more than the opcodes it wraps:
 *   op 0: TXPARAM(a)
 *   op 1: FRAMEPARAM(frame a, param b)
 *   op 2: 32 bytes of frame a's data at offset b
 *
 * These read transaction-level context, not call-frame context, so they work at
 * any call depth -- which is why the pool can call this from a SENDER frame.
 */
export function introspectorRuntime() {
  return assemble([
    ['PUSH', 0], 'CALLDATALOAD',               // op
    'DUP1', 'ISZERO', ['PUSHLABEL', 'txparam'], 'JUMPI',
    ['PUSH', 1], 'EQ', ['PUSHLABEL', 'frameparam'], 'JUMPI',

    // op 2: FRAMEDATACOPY pops [memOffset, dataOffset, length, frameIndex].
    ['PUSH', 32], 'CALLDATALOAD',              // frameIndex = a
    ['PUSH', 32],                              // length
    ['PUSH', 64], 'CALLDATALOAD',              // dataOffset = b
    ['PUSH', 0],                               // memOffset
    'FRAMEDATACOPY',
    ['PUSH', 32], ['PUSH', 0], 'RETURN',

    // op 1: FRAMEPARAM pops [frameIndex, paramId].
    ['JUMPDEST', 'frameparam'],
    ['PUSH', 64], 'CALLDATALOAD',              // paramId = b
    ['PUSH', 32], 'CALLDATALOAD',              // frameIndex = a
    'FRAMEPARAM',
    ['PUSH', 0], 'MSTORE',                     // MSTORE pops [offset, value]
    ['PUSH', 32], ['PUSH', 0], 'RETURN',

    // op 0: TXPARAM pops [paramId].
    ['JUMPDEST', 'txparam'],
    ['PUSH', 32], 'CALLDATALOAD',
    'TXPARAM',
    ['PUSH', 0], 'MSTORE',
    ['PUSH', 32], ['PUSH', 0], 'RETURN',
  ])
}
