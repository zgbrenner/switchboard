import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoredZip } from '../scripts/lib/zip.mjs';
import { inspectZipCentralDirectory } from '../.test-dist/files/zip.js';

test('creates a deterministic ZIP readable by the Switchboard safety parser', () => {
  const files = [
    { path: 'manifest.json', bytes: new TextEncoder().encode('{"name":"Switchboard"}') },
    { path: 'js/background.js', bytes: new TextEncoder().encode('export {};') },
  ];
  const first = createStoredZip(files);
  const second = createStoredZip([...files].reverse());
  assert.deepEqual(first, second);
  const entries = inspectZipCentralDirectory(first);
  assert.deepEqual(entries.map((entry) => entry.name), ['js/background.js', 'manifest.json']);
});

test('rejects unsafe release paths', () => {
  assert.throws(
    () => createStoredZip([{ path: '../secret.txt', bytes: new Uint8Array([1]) }]),
    /Unsafe ZIP path/,
  );
});
