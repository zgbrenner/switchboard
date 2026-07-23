import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
const required = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...(manifest.content_scripts ?? []).flatMap((entry) => [...(entry.js ?? []), ...(entry.css ?? [])]),
  'file-worker.js',
].filter(Boolean);

for (const path of required) await access(join('dist', path));
if (JSON.stringify(manifest.permissions) !== JSON.stringify(['storage'])) throw new Error('Unexpected extension permissions.');
const expectedHosts = ['https://chatgpt.com/*', 'https://claude.ai/*'];
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(expectedHosts)) throw new Error('Unexpected host permissions.');
if (!manifest.content_security_policy?.extension_pages?.includes("'wasm-unsafe-eval'")) throw new Error('Packaged ONNX WASM execution is not permitted by the extension CSP.');

async function files(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await files(path)); else output.push(path);
  }
  return output;
}

const builtFiles = await files('dist');
if (!builtFiles.some((path) => path.endsWith('.wasm'))) throw new Error('Packaged Transformers.js WASM assets are missing.');
for (const path of builtFiles) {
  if (!/\.(?:js|html)$/.test(path)) continue;
  const content = await readFile(path, 'utf8');
  if (/\bimport\s*\(\s*["']https?:\/\//i.test(content) || /<script\b[^>]+src=["']https?:\/\//i.test(content)) {
    throw new Error(`Extension asset imports executable code from a remote origin: ${path}`);
  }
}

const runtimeSource = await readFile('src/models/runtime.ts', 'utf8');
if (!/allowRemoteModels\s*=\s*false/.test(runtimeSource)) throw new Error('The local model runtime does not explicitly disable remote model loading.');
if (!/localModelPath\s*=\s*chrome\.runtime\.getURL\(['"]models\//.test(runtimeSource)) throw new Error('The local model runtime is not pinned to packaged extension assets.');

console.log(`Verified ${required.length} manifest resources, isolated file worker, packaged WASM runtime, least-privilege permissions, local-only model configuration, and no remote executable imports.`);
