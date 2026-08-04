import { createHash } from 'node:crypto';

function canonicalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'undefined') return '[undefined]';
  if (typeof value === 'symbol') return `[symbol:${value.description ?? ''}]`;
  if (typeof value === 'function') return `[function:${value.name || 'anonymous'}]`;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `[bytes:${Buffer.from(value).toString('base64')}]`;
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen));
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalize((value as Record<string, unknown>)[key], seen);
    }
    seen.delete(value);
    return result;
  }
  return String(value);
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set<object>()));
}

export function stableDigest(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}
