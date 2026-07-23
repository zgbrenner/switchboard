export type ModelStage = 'scout' | 'arbiter' | 'judge';

export interface ModelAsset {
  path: string;
  sha256: string;
  bytes: number;
}

export interface ModelPackManifest {
  schemaVersion: 1;
  id: string;
  stage: ModelStage;
  sourceRepository: string;
  sourceRevision: string;
  runtime: 'transformers-js';
  quantization: string;
  assets: ModelAsset[];
}

const REVISION_PATTERN = /^[0-9a-f]{7,40}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export function validateModelPackManifest(value: unknown): ModelPackManifest {
  if (typeof value !== 'object' || value === null) throw new Error('Model-pack manifest must be an object.');
  const manifest = value as Partial<ModelPackManifest>;
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported model-pack schema version.');
  if (!manifest.id || !/^[a-z0-9][a-z0-9._-]+$/i.test(manifest.id)) throw new Error('Model-pack id is invalid.');
  if (!['scout', 'arbiter', 'judge'].includes(manifest.stage ?? '')) throw new Error('Model-pack stage is invalid.');
  if (!manifest.sourceRepository || !manifest.sourceRepository.includes('/')) throw new Error('Model-pack source repository is invalid.');
  if (!manifest.sourceRevision || !REVISION_PATTERN.test(manifest.sourceRevision)) throw new Error('Model-pack source revision must be an immutable Git commit.');
  if (manifest.runtime !== 'transformers-js') throw new Error('Model-pack runtime is unsupported.');
  if (!manifest.quantization) throw new Error('Model-pack quantization is required.');
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) throw new Error('Model-pack assets are required.');
  for (const asset of manifest.assets) {
    if (!asset.path || asset.path.startsWith('/') || asset.path.split('/').includes('..')) throw new Error('Model-pack asset path is unsafe.');
    if (!SHA256_PATTERN.test(asset.sha256)) throw new Error(`Model-pack asset ${asset.path} is missing a valid SHA-256 digest.`);
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0) throw new Error(`Model-pack asset ${asset.path} has an invalid size.`);
  }
  return manifest as ModelPackManifest;
}
