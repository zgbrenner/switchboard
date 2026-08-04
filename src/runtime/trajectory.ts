import { stableDigest, stableSerialize } from './digest.js';
import type { RuntimeEvidenceStep, RuntimeNormalizationOptions, RuntimeObservationInput } from './types.js';

const DEFAULT_PREVIEW_CHARACTERS = 160;
const MAX_PREVIEW_CHARACTERS = 1024;

function finiteNonNegative(value: number | undefined, field: string): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${field} must be a finite non-negative number.`);
  return value;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty string.`);
  return normalized;
}

function previewOf(value: unknown, limit: number): string {
  const serialized = typeof value === 'string' ? value : stableSerialize(value);
  return serialized.replace(/[\r\n\t]+/gu, ' ').slice(0, limit);
}

export function normalizeRuntimeObservation(
  input: RuntimeObservationInput,
  options: RuntimeNormalizationOptions = {},
): RuntimeEvidenceStep {
  const sequence = input.sequence ?? 0;
  if (!Number.isInteger(sequence) || sequence < 0) throw new TypeError('sequence must be a non-negative integer.');
  const timestamp = input.timestamp ?? Date.now();
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new TypeError('timestamp must be a finite non-negative number.');
  const tool = requiredText(input.tool, 'tool');
  const errorClass = input.errorClass?.trim();
  if (input.status === 'failure' && errorClass !== undefined && !errorClass)
    throw new TypeError('errorClass must be non-empty when provided.');

  const previewCharacters = Math.min(
    MAX_PREVIEW_CHARACTERS,
    Math.max(1, Math.floor(options.previewCharacters ?? DEFAULT_PREVIEW_CHARACTERS)),
  );
  const outputDigest = input.status === 'pending' || input.output === undefined ? undefined : stableDigest(input.output);
  const previewValue = input.output === undefined ? input.arguments : input.output;
  const preview = options.includePreview && previewValue !== undefined ? previewOf(previewValue, previewCharacters) : undefined;
  const metadata = input.metadata === undefined ? {} : { ...input.metadata };
  const id = stableDigest({ sequence, tool, kind: input.kind, arguments: input.arguments ?? null, timestamp }).slice(0, 20);

  return {
    id,
    sequence,
    timestamp,
    tool,
    kind: input.kind,
    status: input.status,
    argumentsDigest: stableDigest(input.arguments ?? null),
    ...(outputDigest === undefined ? {} : { outputDigest }),
    ...(preview === undefined ? {} : { preview }),
    ...(errorClass === undefined ? {} : { errorClass }),
    relativeCost: finiteNonNegative(input.relativeCost, 'relativeCost'),
    contextTokens: finiteNonNegative(input.contextTokens, 'contextTokens'),
    metadata,
  };
}
