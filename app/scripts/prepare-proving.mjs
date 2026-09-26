import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sources = {
  '/proving/spend.wasm': 'packages/protocol/circuits/spend_js/spend.wasm',
  '/proving/spend.zkey': 'packages/protocol/circuits/spend_final.zkey',
  '/proving/spend-v2.wasm': 'packages/protocol/circuits/v2/spend-v2_js/spend-v2.wasm',
  '/proving/spend-v2.zkey': 'packages/protocol/circuits/v2/spend-v2.zkey',
};

// Publish existing public proving material; never generate keys or deploy contracts here.
export function prepareProving(root = repoRoot) {
  const publicDir = resolve(root, 'app/public');
  const files = new Map();
  for (const [url, source] of Object.entries(sources)) {
    const path = resolve(root, source);
    if (!existsSync(path)) {
      throw new Error(`Missing ${source}. Include the existing public proving file in the repository before deploying. Do not generate a replacement key for an existing pool.`);
    }
    files.set(url, readFileSync(path));
  }

  const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
  const catalog = readJson(resolve(publicDir, 'deployments.json'));
  const activeUrl = catalog[0]?.url;
  if (!/^\/deployments\/0x[0-9a-fA-F]+\.json$/.test(activeUrl ?? '')) {
    throw new Error('The deployment catalog must identify the active pool manifest.');
  }
  const manifests = new Set([activeUrl.slice(1), 'deployment-v1.json', 'deployment-v2.json', 'deployment-fixed.json']);
  if (existsSync(resolve(publicDir, 'deployment.json'))) manifests.add('deployment.json');
  for (const name of manifests) {
    const manifest = readJson(resolve(publicDir, name));
    for (const kind of ['wasm', 'zkey']) {
      const artifact = manifest.artifacts?.[kind];
      const bytes = files.get(artifact?.url);
      if (!bytes || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
        throw new Error(`Proving ${kind} does not match ${name}. Restore the matching existing artifact; do not change the manifest hash or regenerate keys.`);
      }
    }
  }

  const require = createRequire(resolve(root, 'packages/protocol/package.json'));
  files.set('/proving/snarkjs.min.js', readFileSync(resolve(dirname(require.resolve('snarkjs')), 'snarkjs.min.js')));
  // Validate everything before writing any public output.
  mkdirSync(resolve(publicDir, 'proving'), { recursive: true });
  for (const [url, bytes] of files) writeFileSync(resolve(publicDir, url.slice(1)), bytes);
  return [...files.keys()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Prepared ${prepareProving().length} public proving files; current deployment hashes verified.`);
  } catch (error) {
    console.error(`Cannot package proving files: ${error.message}`);
    process.exitCode = 1;
  }
}
