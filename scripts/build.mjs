import { cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

await rm('dist', { recursive: true, force: true });
const compile = spawnSync('tsc', ['-p', 'tsconfig.json'], { stdio: 'inherit' });
if (compile.status !== 0) process.exit(compile.status ?? 1);
await mkdir('dist/styles', { recursive: true });
await cp('extension/manifest.json', 'dist/manifest.json');
await cp('extension/content-loader.js', 'dist/content-loader.js');
await cp('extension/popup.html', 'dist/popup.html');
await cp('extension/options.html', 'dist/options.html');
await cp('styles', 'dist/styles', { recursive: true });
console.log('Built unpacked extension in dist/.');
