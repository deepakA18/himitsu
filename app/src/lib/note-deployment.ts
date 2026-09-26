import type { Deployment } from '../../../packages/client/src/chain';
import { importPrivateNote } from '../../../packages/client/src/private-note';

/** Resolve only shipped manifests; note contents never become a URL or leave the client. */
export async function resolveNoteDeployment(text: string, current: Deployment, request: (url: string, init?: RequestInit) => Promise<Response> = fetch) {
  let originalError: unknown;
  try {
    return { note: importPrivateNote(text, current), deployment: current };
  } catch (error) {
    originalError = error;
  }
  const response = await request('/deployments.json', { cache: 'no-store' });
  if (!response.ok) throw originalError;
  const catalog: unknown = await response.json();
  if (!Array.isArray(catalog)) throw originalError;
  for (const entry of catalog.slice(0, 100)) {
    if (!entry || typeof entry.url !== 'string' ||
      !/^\/deployments\/0x[0-9a-f]{40}\.json$/.test(entry.url)) continue;
    const manifest = await request(entry.url, { cache: 'no-store' });
    if (!manifest.ok) continue;
    const deployment = await manifest.json() as Deployment;
    if (deployment.id === current.id || deployment.chainId !== current.chainId ||
      deployment.genesisHash !== current.genesisHash) continue;
    try {
      const note = importPrivateNote(text, deployment);
      // Use the current network endpoint, even if an archived manifest predates hosting.
      return { note, deployment: { ...deployment, rpcUrl: current.rpcUrl } };
    } catch { /* Try the next known deployment. */ }
  }
  throw originalError;
}
