import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
// Keep immutable manifests so redeploying never strands old notes in the UI.
export function publishDeployment(root, config, name) {
  const publicDir = join(root, 'app/public');
  mkdirSync(join(publicDir, 'deployments'), { recursive: true });
  const entries = new Map();
  const retain = (d, label) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(d.pool)) throw new Error('Invalid deployment pool');
    const url = '/deployments/' + d.pool.toLowerCase() + '.json';
    const path = join(publicDir, url.slice(1));
    const text = JSON.stringify(d, null, 2) + '\n';
    if (existsSync(path) && JSON.parse(readFileSync(path)).id !== d.id) throw new Error('Refusing to overwrite a different deployment identity');
    writeFileSync(path, text);
    entries.set(d.id, { name: label, url, id: d.id });
  };
  if (existsSync(join(publicDir,'deployments.json'))) for (const old of JSON.parse(readFileSync(join(publicDir,'deployments.json')))) {
    if (!/^\/(deployment-v[12]\.json|deployments\/0x[0-9a-f]{40}\.json)$/.test(old.url)) throw new Error('Unexpected manifest path');
    if (existsSync(join(publicDir,old.url.slice(1)))) retain(JSON.parse(readFileSync(join(publicDir,old.url.slice(1)))), old.name);
  }
  for (const file of ['deployment.json','deployment-v1.json']) {
    if (existsSync(join(publicDir,file))) {
      const old = JSON.parse(readFileSync(join(publicDir,file)));
      if (!entries.has(old.id)) retain(old, old.noteVersion === 2 ? 'Previous market swaps · ' + old.pool.slice(0,10) : 'Original fixed notes · v1');
    }
  }
  retain(config, name);
  const ordered = [entries.get(config.id), ...[...entries.entries()].filter(([id]) => id !== config.id).map(([,v]) => v)];
  writeFileSync(join(publicDir,'deployments.json'), JSON.stringify(ordered,null,2)+'\n');
  writeFileSync(join(publicDir,'deployment.json'),JSON.stringify(config,null,2)+'\n');
}
