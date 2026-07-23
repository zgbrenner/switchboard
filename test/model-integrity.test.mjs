import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex, verifyModelAsset } from '../.test-dist/models/integrity.js';

test('verifies a packaged model asset against size and SHA-256', async () => {
  const bytes = new TextEncoder().encode('switchboard model');
  const sha256 = await sha256Hex(bytes);
  assert.equal(await verifyModelAsset(bytes, { path: 'onnx/model.onnx', bytes: bytes.length, sha256 }), true);
  assert.equal(await verifyModelAsset(bytes, { path: 'onnx/model.onnx', bytes: bytes.length + 1, sha256 }), false);
});
