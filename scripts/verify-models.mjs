import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = process.argv[2] ?? 'model-packs/local';

async function findManifests(directory) {
  try { await access(directory); } catch { return []; }
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await findManifests(path));
    else if (entry.name === 'switchboard-model-pack.json') output.push(path);
  }
  return output;
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

const manifests = await findManifests(root);
if (manifests.length === 0) {
  console.log(`No local model packs found under ${root}; deterministic routing remains available.`);
  process.exit(0);
}

for (const path of manifests) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error(`${path} has an unsupported schema.`);
  if (!/^[0-9a-f]{7,40}$/i.test(manifest.sourceRevision ?? '')) throw new Error(`${path} is not pinned to a Git revision.`);
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) throw new Error(`${path} has no assets.`);
  for (const asset of manifest.assets) {
    if (!asset.path || asset.path.startsWith('/') || asset.path.split('/').includes('..')) throw new Error(`${path} contains an unsafe asset path.`);
    const assetPath = join(dirname(path), asset.path);
    const details = await stat(assetPath);
    if (details.size !== asset.bytes) throw new Error(`${assetPath} has ${details.size} bytes, expected ${asset.bytes}.`);
    const digest = await sha256(assetPath);
    if (digest !== asset.sha256) throw new Error(`${assetPath} failed SHA-256 verification.`);
  }
  console.log(`Verified ${manifest.id} (${manifest.assets.length} assets).`);
}
