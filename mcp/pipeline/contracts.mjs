import { ROUTE_OUTPUT_SCHEMA_V05 } from '../output-schema.mjs';
import { JSON_SCHEMA } from '../schema/constants.mjs';
import { ROUTE_INPUT_SCHEMA } from '../schema/contracts.mjs';
import { normalizeRouteArguments } from '../schema/normalize.mjs';
import { enumValue, exactKeys, integer, numberValue, object, optionalBoolean, stringValue, ValidationError } from '../schema/validators.mjs';
import { BREVITY_LEVELS } from './brevity.mjs';

const ROUTE_KEYS = Object.freeze(Object.keys(ROUTE_INPUT_SCHEMA.properties));
const PREPARE_KEYS = Object.freeze([...ROUTE_KEYS, 'features', 'attachments', 'compression', 'brevity']);
const COMPRESSION_MODES = Object.freeze(['auto', 'model', 'deterministic']);
const PIPELINE_STATUSES = Object.freeze(['disabled', 'skipped', 'applied', 'bypassed', 'fallback', 'failed']);

const featureSchema = {
  type: 'object',
  additionalProperties: false,
  description: 'Independent pipeline switches. Routing defaults on; the three transforming stages default off.',
  properties: {
    routing: { type: 'boolean', default: true, description: 'Route the original request before any transformation.' },
    compression: { type: 'boolean', default: false, description: 'Shorten eligible prompt and converted-file text locally.' },
    brevity: { type: 'boolean', default: false, description: 'Append a stable short-answer instruction at the end.' },
    fileToMarkdown: { type: 'boolean', default: false, description: 'Convert supplied local attachments to Markdown before compression.' },
  },
};

const attachmentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 512, pattern: '.*\\S.*' },
    path: { type: 'string', minLength: 1, maxLength: 4096, pattern: '.*\\S.*' },
    contentBase64: { type: 'string', minLength: 1, maxLength: 70_000_000 },
    mediaType: { type: 'string', minLength: 1, maxLength: 200 },
  },
  oneOf: [{ required: ['path'] }, { required: ['contentBase64'] }],
};

const compressionSchema = {
  type: 'object',
  additionalProperties: false,
  description: 'Local compression controls. Auto uses the quantized model when available and a conservative deterministic fallback otherwise.',
  properties: {
    mode: { type: 'string', enum: COMPRESSION_MODES, default: 'auto' },
    minimumCharacters: { type: 'integer', minimum: 1, maximum: 64_000, default: 1 },
    maxChunkCharacters: { type: 'integer', minimum: 128, maximum: 64_000, default: 6_000 },
    minimumSavingsRatio: { type: 'number', minimum: 0, maximum: 0.95, default: 0.01 },
    threshold: { type: 'number', minimum: -5, maximum: 5, default: 0 },
    timeoutMs: { type: 'integer', minimum: 250, maximum: 120_000, default: 15_000 },
  },
};

const brevitySchema = {
  type: 'object',
  additionalProperties: false,
  description: 'Reply-length steering appended after every other transformation.',
  properties: {
    level: { type: 'string', enum: BREVITY_LEVELS, default: 'concise' },
  },
};

export const PREPARE_INPUT_SCHEMA = {
  $schema: JSON_SCHEMA,
  type: 'object',
  additionalProperties: false,
  required: ['prompt'],
  properties: {
    ...ROUTE_INPUT_SCHEMA.properties,
    features: featureSchema,
    attachments: {
      type: 'array',
      maxItems: 20,
      items: attachmentSchema,
      description:
        'Local files to convert. Each entry supplies either a local path or inline base64 bytes. URLs are rejected and paths are root-restricted.',
    },
    compression: compressionSchema,
    brevity: brevitySchema,
  },
};

const stageStatusSchema = { type: 'string', enum: PIPELINE_STATUSES };
const featureOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['routing', 'compression', 'brevity', 'fileToMarkdown'],
  properties: {
    routing: { type: 'boolean' },
    compression: { type: 'boolean' },
    brevity: { type: 'boolean' },
    fileToMarkdown: { type: 'boolean' },
  },
};

export const PREPARE_OUTPUT_SCHEMA = {
  $schema: JSON_SCHEMA,
  type: 'object',
  additionalProperties: false,
  required: ['pipelineVersion', 'features', 'route', 'preparedPrompt', 'convertedAttachments', 'stages', 'warnings', 'transforms', 'receipt'],
  properties: {
    pipelineVersion: { type: 'string', const: '2026-07-31' },
    features: featureOutputSchema,
    route: { anyOf: [ROUTE_OUTPUT_SCHEMA_V05, { type: 'null' }] },
    preparedPrompt: { type: 'string', maxLength: 8_000_000 },
    convertedAttachments: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'mediaType', 'markdown', 'characters', 'warnings'],
        properties: {
          name: { type: 'string' },
          mediaType: { type: 'string' },
          markdown: { type: 'string', maxLength: 8_000_000 },
          characters: { type: 'integer', minimum: 0, maximum: 8_000_000 },
          warnings: { type: 'array', maxItems: 20, items: { type: 'string' } },
        },
      },
    },
    stages: {
      type: 'object',
      additionalProperties: false,
      required: ['routing', 'fileToMarkdown', 'compression', 'brevity'],
      properties: {
        routing: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled', 'status'],
          properties: { enabled: { type: 'boolean' }, status: stageStatusSchema },
        },
        fileToMarkdown: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled', 'status', 'inputCount', 'convertedCount'],
          properties: {
            enabled: { type: 'boolean' },
            status: stageStatusSchema,
            inputCount: { type: 'integer', minimum: 0, maximum: 20 },
            convertedCount: { type: 'integer', minimum: 0, maximum: 20 },
          },
        },
        compression: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled', 'status', 'model', 'originalCharacters', 'preparedCharacters', 'savingsRatio', 'chunkCount'],
          properties: {
            enabled: { type: 'boolean' },
            status: stageStatusSchema,
            model: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            originalCharacters: { type: 'integer', minimum: 0, maximum: 8_000_000 },
            preparedCharacters: { type: 'integer', minimum: 0, maximum: 8_000_000 },
            savingsRatio: { type: 'number', minimum: 0, maximum: 1 },
            chunkCount: { type: 'integer', minimum: 0 },
          },
        },
        brevity: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled', 'status', 'level'],
          properties: {
            enabled: { type: 'boolean' },
            status: stageStatusSchema,
            level: { anyOf: [{ type: 'string', enum: BREVITY_LEVELS }, { type: 'null' }] },
          },
        },
      },
    },
    warnings: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 1_000 } },
    transforms: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 200 } },
    receipt: {
      type: 'object',
      additionalProperties: false,
      required: ['algorithm', 'originalHash', 'preparedHash'],
      properties: {
        algorithm: { type: 'string', const: 'sha256' },
        originalHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        preparedHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      },
    },
  },
};

function inferDetectedType(name) {
  const extension = name.toLowerCase().split('.').pop();
  return (
    {
      txt: 'text',
      log: 'text',
      rst: 'text',
      md: 'markdown',
      markdown: 'markdown',
      html: 'html',
      htm: 'html',
      json: 'json',
      jsonl: 'json',
      ipynb: 'json',
      csv: 'csv',
      tsv: 'csv',
      pdf: 'pdf',
      docx: 'docx',
      pptx: 'pptx',
      xlsx: 'xlsx',
      xls: 'xlsx',
      zip: 'zip',
    }[extension] ?? 'unknown'
  );
}

function estimatedBase64Bytes(value) {
  return Math.max(0, Math.floor((value.replace(/\s/gu, '').length * 3) / 4));
}

function normalizeAttachment(raw, index) {
  const label = `attachments[${index}]`;
  const attachment = object(raw, label);
  exactKeys(attachment, ['name', 'path', 'contentBase64', 'mediaType'], label);
  const name = stringValue(attachment.name, `${label}.name`, { min: 1, max: 512, nonWhitespace: true });
  const hasPath = attachment.path !== undefined;
  const hasContent = attachment.contentBase64 !== undefined;
  if (hasPath === hasContent) throw new ValidationError(`${label} requires exactly one of path or contentBase64.`);
  const path = hasPath ? stringValue(attachment.path, `${label}.path`, { min: 1, max: 4096, nonWhitespace: true }) : undefined;
  if (path && /^(?:https?|ftp|data|file):/iu.test(path)) throw new ValidationError(`${label}.path must be a local path.`);
  const contentBase64 = hasContent
    ? stringValue(attachment.contentBase64, `${label}.contentBase64`, { min: 1, max: 70_000_000, nonWhitespace: true })
    : undefined;
  const mediaType =
    attachment.mediaType === undefined
      ? undefined
      : stringValue(attachment.mediaType, `${label}.mediaType`, { min: 1, max: 200, nonWhitespace: true });
  return {
    name,
    ...(path === undefined ? {} : { path }),
    ...(contentBase64 === undefined ? {} : { contentBase64 }),
    ...(mediaType === undefined ? {} : { mediaType }),
  };
}

function normalizeAttachments(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new ValidationError('attachments must contain at most 20 entries.');
  return value.map(normalizeAttachment);
}

function normalizeFeatures(value) {
  if (value === undefined) return { routing: true, compression: false, brevity: false, fileToMarkdown: false };
  const features = object(value, 'features');
  exactKeys(features, ['routing', 'compression', 'brevity', 'fileToMarkdown'], 'features');
  return {
    routing: optionalBoolean(features.routing, 'features.routing', true),
    compression: optionalBoolean(features.compression, 'features.compression', false),
    brevity: optionalBoolean(features.brevity, 'features.brevity', false),
    fileToMarkdown: optionalBoolean(features.fileToMarkdown, 'features.fileToMarkdown', false),
  };
}

function normalizeCompression(value) {
  if (value === undefined) {
    return { mode: 'auto', minimumCharacters: 1, maxChunkCharacters: 6_000, minimumSavingsRatio: 0.01, threshold: 0, timeoutMs: 15_000 };
  }
  const compression = object(value, 'compression');
  exactKeys(compression, ['mode', 'minimumCharacters', 'maxChunkCharacters', 'minimumSavingsRatio', 'threshold', 'timeoutMs'], 'compression');
  return {
    mode: enumValue(compression.mode, COMPRESSION_MODES, 'compression.mode', 'auto'),
    minimumCharacters:
      compression.minimumCharacters === undefined
        ? 1
        : integer(compression.minimumCharacters, 'compression.minimumCharacters', { min: 1, max: 64_000 }),
    maxChunkCharacters:
      compression.maxChunkCharacters === undefined
        ? 6_000
        : integer(compression.maxChunkCharacters, 'compression.maxChunkCharacters', { min: 128, max: 64_000 }),
    minimumSavingsRatio:
      compression.minimumSavingsRatio === undefined
        ? 0.01
        : numberValue(compression.minimumSavingsRatio, 'compression.minimumSavingsRatio', { min: 0, max: 0.95 }),
    threshold:
      compression.threshold === undefined ? 0 : numberValue(compression.threshold, 'compression.threshold', { min: -5, max: 5 }),
    timeoutMs:
      compression.timeoutMs === undefined ? 15_000 : integer(compression.timeoutMs, 'compression.timeoutMs', { min: 250, max: 120_000 }),
  };
}

function normalizeBrevity(value) {
  if (value === undefined) return { level: 'concise' };
  const brevity = object(value, 'brevity');
  exactKeys(brevity, ['level'], 'brevity');
  return { level: enumValue(brevity.level, BREVITY_LEVELS, 'brevity.level', 'concise') };
}

function routeArguments(args, attachments) {
  const route = {};
  for (const key of ROUTE_KEYS) if (args[key] !== undefined) route[key] = args[key];
  const fileMetadata = attachments.map((attachment) => ({
    name: attachment.name,
    size: attachment.contentBase64 ? estimatedBase64Bytes(attachment.contentBase64) : 0,
    detectedType: inferDetectedType(attachment.name),
    ...(attachment.mediaType ? { mediaType: attachment.mediaType } : {}),
  }));
  if (fileMetadata.length > 0) route.files = [...(args.files ?? []), ...fileMetadata];
  return route;
}

export function normalizePrepareArguments(value) {
  const args = object(value ?? {}, 'prepare_request arguments');
  exactKeys(args, PREPARE_KEYS, 'prepare_request arguments');
  const attachments = normalizeAttachments(args.attachments);
  return {
    route: normalizeRouteArguments(routeArguments(args, attachments)),
    features: normalizeFeatures(args.features),
    attachments,
    compression: normalizeCompression(args.compression),
    brevity: normalizeBrevity(args.brevity),
  };
}
