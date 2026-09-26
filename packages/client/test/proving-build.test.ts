import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { prepareProving } from '../../../app/scripts/prepare-proving.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function checkout() {
  const root = mkdtempSync(resolve(tmpdir(), 'himitsu-proving-'));
  roots.push(root);
  for (const path of [
    'app/public/deployments.json', 'app/public/deployments',
    'app/public/deployment-v1.json', 'app/public/deployment-v2.json', 'app/public/deployment-fixed.json',
    'packages/protocol/circuits/spend_js/spend.wasm', 'packages/protocol/circuits/spend_final.zkey',
    'packages/protocol/circuits/v2/spend-v2_js/spend-v2.wasm', 'packages/protocol/circuits/v2/spend-v2.zkey',
    'packages/protocol/package.json',
  ]) {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    cpSync(resolve(path), resolve(root, path), { recursive: true });
  }
  symlinkSync(resolve('packages/protocol/node_modules'), resolve(root, 'packages/protocol/node_modules'));
  return root;
}

test('a fresh hosting checkout packages matching proof files and the worker runtime', () => {
  const root = checkout();
  expect(existsSync(resolve(root, 'app/public/proving'))).toBe(false);
  expect(prepareProving(root)).toHaveLength(5);
  const deployment = JSON.parse(readFileSync(resolve(root, 'app/public/deployment-v2.json'), 'utf8'));
  for (const artifact of Object.values(deployment.artifacts) as { url: string; sha256: string }[]) {
    const bytes = readFileSync(resolve(root, 'app/public', artifact.url.slice(1)));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
  }
  expect(readFileSync(resolve(root, 'app/public/proving/snarkjs.min.js')).length).toBeGreaterThan(1000);
});

test('a missing public key fails before publishing assets', () => {
  const root = checkout();
  rmSync(resolve(root, 'packages/protocol/circuits/v2/spend-v2.zkey'));
  expect(() => prepareProving(root)).toThrow('Include the existing public proving file');
  expect(existsSync(resolve(root, 'app/public/proving'))).toBe(false);
});

test('a different key cannot silently replace the deployed pool proving key', () => {
  const root = checkout();
  writeFileSync(resolve(root, 'packages/protocol/circuits/v2/spend-v2.zkey'), 'wrong key');
  expect(() => prepareProving(root)).toThrow('does not match');
  expect(existsSync(resolve(root, 'app/public/proving'))).toBe(false);
});
