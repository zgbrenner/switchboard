import test from 'node:test';
import assert from 'node:assert/strict';
import { validateModelPackManifest } from '../.test-dist/models/manifest.js';

const valid = {
  schemaVersion: 1,
  id: 'switchboard-scout-q8',
  stage: 'scout',
  sourceRepository: 'jhu-clsp/ettin-encoder-17m',
  sourceRevision: '2b9f592',
  runtime: 'transformers-js',
  quantization: 'q8',
  assets: [{ path: 'onnx/model_quantized.onnx', sha256: 'a'.repeat(64), bytes: 1234 }],
};

test('accepts immutable and hashed model packs', () => {
  assert.equal(validateModelPackManifest(valid).id, valid.id);
});

test('rejects moving model revisions', () => {
  assert.throws(() => validateModelPackManifest({ ...valid, sourceRevision: 'main' }), /immutable Git commit/);
});

test('rejects unsafe model asset paths', () => {
  assert.throws(() => validateModelPackManifest({ ...valid, assets: [{ ...valid.assets[0], path: '../model.onnx' }] }), /unsafe/);
});
