import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { createStoredZip } from './lib/zip.mjs';

async function collectFiles(root, directory = root) {
  const output = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await collectFiles(root, absolute));
    else if (entry.isFile()) {
      output.push({
        path: relative(root, absolute).split(sep).join('/'),
        bytes: new Uint8Array(await readFile(absolute)),
      });
    }
  }
  return output;
}

const dist = resolve('dist');
const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.json'), 'utf8'));
const files = await collectFiles(dist);
const archive = createStoredZip(files);
const { inspectZipCentralDirectory } = await import('../dist/js/files/zip.js');
const entries = inspectZipCentralDirectory(archive, {
  maxEntries: 4096,
  maxUncompressedBytes: 250 * 1024 * 1024,
  maxCompressionRatio: 1,
});
if (entries.length !== files.length) throw new Error('Release archive entry count did not match the built extension.');

const release = resolve('release');
await rm(release, { recursive: true, force: true });
await mkdir(release, { recursive: true });
const filename = `switchboard-${manifest.version}.zip`;
const archivePath = resolve(release, filename);
await writeFile(archivePath, archive);
const digest = createHash('sha256').update(archive).digest('hex');
await writeFile(resolve(release, `${filename}.sha256`), `${digest}  ${filename}\n`);
console.log(`Packaged ${files.length} files at ${archivePath}`);
console.log(`SHA-256 ${digest}`);
