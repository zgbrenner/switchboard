import test from 'node:test';
import assert from 'node:assert/strict';
import { metadataOnlyInsight } from '../.test-dist/files/worker-client.js';

test('metadata fallback preserves useful PDF routing signals', () => {
  const insight = metadataOnlyInsight({
    name: 'agreement.pdf',
    size: 3_000_000,
    type: 'application/pdf',
  }, 'inspection timed out');
  assert.equal(insight.detectedType, 'pdf');
  assert.equal(insight.capabilities.files, true);
  assert.equal(insight.capabilities.longContext, true);
  assert.ok(insight.warnings.includes('metadata-only-routing'));
});

test('metadata fallback marks images as vision work', () => {
  const insight = metadataOnlyInsight({
    name: 'diagram.png',
    size: 500_000,
    type: 'image/png',
  }, 'unsupported parser');
  assert.equal(insight.detectedType, 'image');
  assert.equal(insight.capabilities.vision, true);
});
