#!/usr/bin/env node
// Compile the official Uniswap V2 core contracts with solc-js 0.5.16.
//
// forge wants to fetch a native solc 0.5.16 binary and that host is unreachable
// from this sandbox, which is why an earlier pass used a hand-written port. The
// npm-distributed compiler needs no download at build time, so the canonical
// sources compile here and the port is no longer on the critical path.
//
//   npm install --save-dev --save-exact solc-v2@npm:solc@0.5.16 @uniswap/v2-core@1.0.1
//
// Output: uniswap.json, with the deployable bytecode and ABI of
// UniswapV2Factory and UniswapV2Pair.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const solc = require('solc-v2')
const HERE = dirname(fileURLToPath(import.meta.url))
const V2_CORE = dirname(require.resolve('@uniswap/v2-core/package.json'))

const ENTRIES = ['contracts/UniswapV2Factory.sol', 'contracts/UniswapV2Pair.sol']

/**
 * Resolve the relative imports the v2-core sources use (`./interfaces/...`,
 * `./libraries/...`) against the package root.
 */
function findImport(importPath) {
  const candidates = [
    resolve(V2_CORE, importPath),
    resolve(V2_CORE, 'contracts', importPath),
    resolve(join(HERE, 'node_modules'), importPath),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { contents: readFileSync(candidate, 'utf8') }
  }
  return { error: `not found: ${importPath}` }
}

const sources = {}
const queue = [...ENTRIES]
const seen = new Set()
// solc's standard JSON wants every source up front unless we use the import
// callback; we use the callback, so only the entry points go in `sources`.
for (const entry of queue) {
  if (seen.has(entry)) continue
  seen.add(entry)
  sources[entry] = { content: readFileSync(join(V2_CORE, entry), 'utf8') }
}

const input = {
  language: 'Solidity',
  sources,
  settings: {
    // Uniswap's own build settings, so the bytecode matches what they ship.
    optimizer: { enabled: true, runs: 999999 },
    evmVersion: 'istanbul',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
}

const output = JSON.parse(
  solc.compile(JSON.stringify(input), { import: findImport }),
)

const errors = (output.errors ?? []).filter((e) => e.severity === 'error')
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage)
  process.exit(1)
}

const pick = (file, name) => {
  const c = output.contracts?.[file]?.[name]
  if (!c) throw new Error(`missing ${name} in ${file}`)
  return {
    abi: c.abi,
    bytecode: '0x' + c.evm.bytecode.object,
    deployedBytecode: '0x' + c.evm.deployedBytecode.object,
  }
}

const artifacts = {
  solcVersion: solc.version(),
  UniswapV2Factory: pick('contracts/UniswapV2Factory.sol', 'UniswapV2Factory'),
  UniswapV2Pair: pick('contracts/UniswapV2Pair.sol', 'UniswapV2Pair'),
}
writeFileSync(join(HERE, 'uniswap.json'), JSON.stringify(artifacts, null, 2))

console.log(`solc ${artifacts.solcVersion}`)
for (const name of ['UniswapV2Factory', 'UniswapV2Pair']) {
  console.log(`  ${name.padEnd(18)} ${artifacts[name].deployedBytecode.length / 2 - 1} bytes deployed`)
}
console.log('wrote uniswap.json')
