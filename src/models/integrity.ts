import type { ModelAsset } from './manifest.js';

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function verifyModelAsset(bytes: Uint8Array, expected: ModelAsset): Promise<boolean> {
  if (bytes.byteLength !== expected.bytes) return false;
  return (await sha256Hex(bytes)).toLowerCase() === expected.sha256.toLowerCase();
}
