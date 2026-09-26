// A 60-line EVM assembler with labels. The Himitsu account's code has to use
// opcodes solc has never heard of (TXPARAM, FRAMEPARAM, SIGDATACOPY, APPROVE),
// and `verbatim` is only available in standalone Yul, so the account is written
// here directly. Two passes: size the instructions, then resolve labels.

const OPCODES = {
  STOP: 0x00, ADD: 0x01, MUL: 0x02, SUB: 0x03, DIV: 0x04, MOD: 0x06,
  LT: 0x10, GT: 0x11, EQ: 0x14, ISZERO: 0x15, AND: 0x16, OR: 0x17, XOR: 0x18, NOT: 0x19,
  SHL: 0x1b, SHR: 0x1c,
  KECCAK256: 0x20,
  CALLER: 0x33, CALLVALUE: 0x34, CALLDATALOAD: 0x35, CALLDATASIZE: 0x36, CALLDATACOPY: 0x37,
  ADDRESS: 0x30, RETURNDATASIZE: 0x3d, RETURNDATACOPY: 0x3e,
  POP: 0x50, MLOAD: 0x51, MSTORE: 0x52, MSTORE8: 0x53,
  JUMP: 0x56, JUMPI: 0x57, PC: 0x58, MSIZE: 0x59, JUMPDEST: 0x5b,
  LOG0: 0xa0, LOG1: 0xa1,
  DUP1: 0x80, DUP2: 0x81, DUP3: 0x82, DUP4: 0x83,
  SWAP1: 0x90, SWAP2: 0x91, SWAP3: 0x92,
  RETURN: 0xf3, REVERT: 0xfd, STATICCALL: 0xfa,
  // EIP-8141
  APPROVE: 0xaa, TXPARAM: 0xb0, FRAMEDATALOAD: 0xb1, FRAMEDATACOPY: 0xb2,
  FRAMEPARAM: 0xb3, SIGPARAM: 0xb4, SIGDATACOPY: 0xb5,
}

const toBytes = (value) => {
  let hex = BigInt(value).toString(16)
  if (hex.length % 2) hex = '0' + hex
  return hex === '0' || hex === '00' ? [0] : [...Buffer.from(hex, 'hex')]
}

/**
 * `program` is a flat list of:
 *   'OPCODE'                    a bare opcode
 *   ['PUSH', value]             minimal PUSH of a literal (PUSH0 for 0)
 *   ['PUSH', value, width]      PUSH padded to `width` bytes (for addresses)
 *   ['PUSHLABEL', name]         2-byte PUSH of a label's offset, back-patched
 *   ['LABEL', name]             marks a position; does NOT emit JUMPDEST
 *   ['JUMPDEST', name]          marks a position AND emits JUMPDEST
 */
export function assemble(program) {
  const sized = []
  const labels = new Map()
  let pc = 0

  for (const item of program) {
    if (Array.isArray(item) && item[0] === 'LABEL') {
      labels.set(item[1], pc)
      continue
    }
    if (Array.isArray(item) && item[0] === 'JUMPDEST') {
      labels.set(item[1], pc)
      sized.push({ bytes: [OPCODES.JUMPDEST] })
      pc += 1
      continue
    }
    if (Array.isArray(item) && item[0] === 'PUSHLABEL') {
      sized.push({ label: item[1] })
      pc += 3 // PUSH2 + two bytes
      continue
    }
    if (Array.isArray(item) && item[0] === 'PUSH') {
      const [, value, width] = item
      let body = toBytes(value)
      if (width) body = [...new Array(width - body.length).fill(0), ...body]
      else if (BigInt(value) === 0n) {
        sized.push({ bytes: [0x5f] }) // PUSH0
        pc += 1
        continue
      }
      sized.push({ bytes: [0x5f + body.length, ...body] })
      pc += 1 + body.length
      continue
    }
    const op = OPCODES[item]
    if (op === undefined) throw new Error(`unknown opcode ${item}`)
    sized.push({ bytes: [op] })
    pc += 1
  }

  const out = []
  for (const piece of sized) {
    if (piece.label !== undefined) {
      const target = labels.get(piece.label)
      if (target === undefined) throw new Error(`undefined label ${piece.label}`)
      out.push(0x61, (target >> 8) & 0xff, target & 0xff) // PUSH2 <target>
    } else {
      out.push(...piece.bytes)
    }
  }
  return Uint8Array.from(out)
}

export const toHex = (bytes) => '0x' + Buffer.from(bytes).toString('hex')

/**
 * Wrap runtime code in init code that returns it. The length PUSHes are
 * fixed-width PUSH2, so the header is always the same size and the runtime
 * offset is a constant -- no back-patching, and the deployed code is
 * byte-identical to `runtime`.
 *
 *   PUSH2 len  PUSH2 off  PUSH1 0  CODECOPY  PUSH2 len  PUSH1 0  RETURN
 *      3     +     3    +    2   +    1    +     3    +    2   +   1  = 15
 */
export function initcode(runtime) {
  const len = runtime.length
  const hi = (n) => (n >> 8) & 0xff
  const lo = (n) => n & 0xff
  const HEADER_LEN = 15 // must equal the byte length of the header below
  return Uint8Array.from([
    // CODECOPY pops [destOffset, srcOffset, length], destOffset on top.
    0x61, hi(len), lo(len),               // PUSH2 len       (length)
    0x61, hi(HEADER_LEN), lo(HEADER_LEN), // PUSH2 13        (srcOffset)
    0x60, 0x00,                           // PUSH1 0         (destOffset)
    0x39,                                 // CODECOPY
    // RETURN pops [offset, length], offset on top.
    0x61, hi(len), lo(len),               // PUSH2 len       (length)
    0x60, 0x00,                           // PUSH1 0         (offset)
    0xf3,                                 // RETURN
    ...runtime,
  ])
}
