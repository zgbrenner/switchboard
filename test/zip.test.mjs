import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectZipCentralDirectory } from '../.test-dist/files/zip.js';

function little32(value) {
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
}
function little16(value) {
  return [value & 255, (value >>> 8) & 255];
}
function centralEntry(name, compressedSize, uncompressedSize) {
  const encoded = new TextEncoder().encode(name);
  return new Uint8Array([
    0x50,0x4b,0x01,0x02, 20,0, 20,0, 0,0, 0,0, 0,0, 0,0, 0,0,0,0,
    ...little32(compressedSize), ...little32(uncompressedSize), ...little16(encoded.length),
    0,0, 0,0, 0,0, 0,0, 0,0,0,0, 0,0,0,0,
    ...encoded
  ]);
}
function endRecord(entryCount, centralSize) {
  return new Uint8Array([
    0x50,0x4b,0x05,0x06, 0,0,0,0, ...little16(entryCount), ...little16(entryCount),
    ...little32(centralSize), 0,0,0,0, 0,0
  ]);
}

test('rejects zip bombs using central-directory sizes before extraction', () => {
  const entry = centralEntry('word/document.xml', 1, 100000000);
  const end = endRecord(1, entry.length);
  const zip = new Uint8Array(entry.length + end.length);
  zip.set(entry); zip.set(end, entry.length);
  assert.throws(
    () => inspectZipCentralDirectory(zip, { maxEntries: 10, maxUncompressedBytes: 1000, maxCompressionRatio: 100 }),
    /uncompressed size limit/
  );
});
