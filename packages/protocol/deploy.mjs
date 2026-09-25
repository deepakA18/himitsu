// Deployment, with the post-deploy bytecode check kept from the last milestone.
//
// That check exists because a 2-byte error in my init-code header once deployed
// every account shifted by two bytes, and the only symptom was a uniform
// "validation prefix did not establish a payer" from the node. Comparing what
// landed on chain against what was meant to land turns that class of bug into a
// one-line failure.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initcode, toHex } from './asm.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

export function makeDeployer({ rpcUrl, privateKey }) {
  const cast = (...args) => execFileSync('cast', args, { encoding: 'utf8' }).trim()
  const send = (...args) =>
    JSON.parse(cast('send', '--rpc-url', rpcUrl, '--private-key', privateKey, '--json', ...args))
  const code = (address) => cast('code', '--rpc-url', rpcUrl, address)

  const artifact = (name) =>
    JSON.parse(readFileSync(join(HERE, `contracts/out/${name}.sol/${name}.json`)))

  /** Deploy hand-assembled runtime and assert the chain holds exactly it. */
  function deployAsm(name, runtime) {
    const { contractAddress } = send('--create', toHex(initcode(runtime)))
    const onChain = code(contractAddress).toLowerCase()
    const expected = toHex(runtime).toLowerCase()
    if (onChain !== expected) {
      throw new Error(
        `${name}: deployed code does not match the assembler's output\n` +
          `  expected ${expected.length / 2 - 1} bytes: ${expected.slice(0, 50)}...\n` +
          `  on chain ${onChain.length / 2 - 1} bytes: ${onChain.slice(0, 50)}...`,
      )
    }
    return contractAddress
  }

  /**
   * Deploy a compiled contract and compare against solc's `deployedBytecode`,
   * masking the immutable ranges solc records (their values are only known once
   * the constructor has run).
   */
  function deploySol(name, { args = null, value = null } = {}) {
    const art = artifact(name)
    const extra = []
    if (value) extra.push('--value', value)
    const initHex =
      art.bytecode.object + (args ? cast('abi-encode', args.signature, ...args.values).replace(/^0x/, '') : '')
    const { contractAddress } = send('--create', initHex, ...extra)

    const onChain = Buffer.from(code(contractAddress).replace(/^0x/, ''), 'hex')
    const expected = Buffer.from(art.deployedBytecode.object.replace(/^0x/, ''), 'hex')
    if (onChain.length !== expected.length) {
      throw new Error(
        `${name}: deployed ${onChain.length} bytes, artifact says ${expected.length}`,
      )
    }
    const masked = new Set()
    for (const ranges of Object.values(art.deployedBytecode.immutableReferences ?? {})) {
      for (const { start, length } of ranges) {
        for (let i = start; i < start + length; i++) masked.add(i)
      }
    }
    for (let i = 0; i < expected.length; i++) {
      if (!masked.has(i) && onChain[i] !== expected[i]) {
        throw new Error(`${name}: deployed code differs from the artifact at byte ${i}`)
      }
    }
    return contractAddress
  }

  /** Deploy raw bytecode produced by a generator (circomlibjs' Poseidon). */
  function deployRaw(name, bytecode) {
    const { contractAddress } = send('--create', bytecode)
    if (code(contractAddress) === '0x') throw new Error(`${name}: nothing deployed`)
    return contractAddress
  }

  return { cast, send, code, artifact, deployAsm, deploySol, deployRaw }
}
