import test from 'node:test';
import assert from 'node:assert/strict';
import { detectFileType } from '../.test-dist/files/detect.js';
import { inspectBytes } from '../.test-dist/files/inspect.js';

const encoder = new TextEncoder();

test('magic bytes override a misleading PDF extension', () => {
  const bytes = encoder.encode('plain text pretending to be a pdf');
  const result = detectFileType({ name: 'fake.pdf', declaredType: 'application/pdf', bytes });
  assert.equal(result.detectedType, 'text');
  assert.ok(result.warnings.includes('extension-mismatch'));
});

test('detects a real PDF by signature', () => {
  const bytes = encoder.encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj');
  const result = detectFileType({ name: 'document.bin', declaredType: '', bytes });
  assert.equal(result.detectedType, 'pdf');
  assert.equal(result.mediaType, 'application/pdf');
});

test('extracts text and routing metadata from plain text', async () => {
  const insight = await inspectBytes({
    name: 'notes.txt',
    declaredType: 'text/plain',
    bytes: encoder.encode('Compare the two designs and verify the security assumptions.')
  });
  assert.equal(insight.detectedType, 'text');
  assert.match(insight.excerpt, /security assumptions/);
  assert.equal(insight.capabilities.files, true);
});

test('rejects a file above the configured size limit', async () => {
  await assert.rejects(
    inspectBytes({
      name: 'large.txt',
      declaredType: 'text/plain',
      bytes: new Uint8Array(20),
      limits: { maxFileBytes: 10 }
    }),
    /exceeds the 10 byte limit/
  );
});
