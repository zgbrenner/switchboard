import { build } from 'esbuild';
import { access, cp, mkdir, readdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function findFiles(directory, predicate) {
  if (!await exists(directory)) return [];
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await findFiles(path, predicate));
    else if (predicate(path)) output.push(path);
  }
  return output;
}

await rm('dist', { recursive: true, force: true });
await mkdir('dist/styles', { recursive: true });

await build({
  entryPoints: {
    'js/extension/background': 'src/extension/background.ts',
    'js/extension/content': 'src/extension/content.ts',
    'js/extension/options': 'src/extension/options.ts',
    'js/extension/popup': 'src/extension/popup.ts',
    'file-worker': 'src/files/worker.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome109'],
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
});

await cp('extension/manifest.json', 'dist/manifest.json');
await cp('extension/content-loader.js', 'dist/content-loader.js');
await cp('extension/popup.html', 'dist/popup.html');
await cp('extension/options.html', 'dist/options.html');
await cp('styles', 'dist/styles', { recursive: true });

if (await exists('model-packs/local')) {
  await cp('model-packs/local', 'dist/models', { recursive: true });
}

const wasmFiles = await findFiles('node_modules/@huggingface/transformers', (path) => path.endsWith('.wasm'));
if (wasmFiles.length === 0) throw new Error('Transformers.js WASM assets were not found. Run npm install first.');
await mkdir('dist/wasm', { recursive: true });
for (const path of wasmFiles) await cp(path, join('dist/wasm', basename(path)));

console.log(`Built unpacked extension in dist/ with ${wasmFiles.length} packaged WASM runtime asset(s).`);
