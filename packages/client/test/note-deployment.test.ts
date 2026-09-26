import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { Deployment } from '../src/chain';
import { createPrivateNote, exportPrivateNote } from '../src/private-note';
import { resolveNoteDeployment } from '../../../app/src/lib/note-deployment';

const current = JSON.parse(readFileSync('app/public/deployment.json', 'utf8')) as Deployment;
test('current note imports without fetching a catalog', async () => {
  const note = createPrivateNote(current, current.pool);
  const result = await resolveNoteDeployment(exportPrivateNote(note, current), current, (async () => {
    throw new Error('Unexpected fetch');
  }));
  expect(result.note.id).toBe(note.id);
  expect(result.deployment).toBe(current);
});

test('old note resolves only a shipped same-chain deployment, using the current RPC', async () => {
  const old = { ...current, id: 'archived-deployment', rpcUrl: 'http://obsolete.invalid' };
  const note = createPrivateNote(old, old.pool);
  const text = exportPrivateNote(note, old);
  const path = `/deployments/${old.pool.toLowerCase()}.json`;
  const requested: string[] = [];
  const request = async (url: string | URL | Request) => {
    requested.push(String(url));
    return Response.json(String(url) === '/deployments.json'
      ? [{ url: 'https://untrusted.invalid' }, { url: path }]
      : old);
  };
  const resolved = await resolveNoteDeployment(text, current, request);
  expect(resolved.note.id).toBe(note.id);
  expect(resolved.deployment.id).toBe(old.id);
  expect(resolved.deployment.rpcUrl).toBe(current.rpcUrl);
  expect(requested).toEqual(['/deployments.json', path]);
  await expect(resolveNoteDeployment(text, { ...current, genesisHash: `0x${'00'.repeat(32)}` }, request)).rejects.toThrow('different network');
});
