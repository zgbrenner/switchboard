import { stableDigest } from '../runtime/digest.js';

const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

export function normalizeProxySessionId(value: string): string {
  const trimmed = value.trim();
  if (SAFE_SESSION_ID.test(trimmed)) return trimmed;
  return `sw_${stableDigest(trimmed).slice(0, 32)}`;
}
