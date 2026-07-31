import { SWITCHBOARD_API_VERSION } from '../enhance.mjs';

export const CURRENT_PROTOCOL_VERSION = '2025-11-25';
export const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-11-25', '2025-06-18', '2025-03-26']);
export const SERVER_INFO = {
  name: 'switchboard',
  title: 'Switchboard Request Preflight',
  version: '0.7.0',
  description:
    'Local privacy-first request routing, prompt compression, reply-brevity steering, file-to-Markdown conversion, diagnostics, and evaluation for AI hosts.',
  websiteUrl: 'https://github.com/zgbrenner/switchboard',
};

export const POLICY_DESCRIPTIONS = {
  best: 'Prefer higher-quality routes when they can materially improve the result.',
  balanced: 'Balance quality, latency, and premium model usage.',
  fast: 'Prefer the fastest adequate route while preserving hard capability floors.',
  conserve: 'Conserve stronger or premium model usage unless it is required.',
};

export const CAPABILITY_DESCRIPTIONS = {
  web: 'Requires current web research or externally verified information.',
  files: 'Requires a host or model that can access attached files.',
  vision: 'Requires visual understanding of an image, screenshot, chart, or visual document.',
  longContext: 'Requires substantial context capacity for a long prompt, conversation, or document.',
  code: 'Requires code-aware reasoning or software-development capability.',
};

export const API_METADATA = {
  current: SWITCHBOARD_API_VERSION,
  supported: [SWITCHBOARD_API_VERSION],
  compatibility: {
    additiveFrom: '0.4.0',
    policy: 'Existing request fields and response fields are retained. New response fields are additive.',
    deprecationNotice: 'Fields will not be removed from this contract without a new contract version and an announced migration period.',
  },
};

export const ADAPTER_CONTRACT = {
  type: 'host-supplied-model-inventory',
  providerSpecificCodeRequired: false,
  fields: ['id', 'title', 'family', 'tier', 'effortLevels', 'capabilities', 'relativeCost', 'relativeLatency', 'available'],
};

export const PIPELINE_METADATA = {
  version: '2026-07-31',
  order: ['routing', 'fileToMarkdown', 'compression', 'brevity'],
  defaults: { routing: true, compression: false, brevity: false, fileToMarkdown: false },
  compressor: {
    preferredModel: 'chopratejas/kompress-small',
    runtime: 'local-onnx-int8-sidecar',
    fallback: 'lossless deterministic phrase compaction',
    bypassesShortInputs: true,
    preservesProtectedCodeFences: true,
  },
  fileConversion: {
    runtime: 'local MarkItDown-compatible sidecar with built-in text converters',
    remoteUrls: false,
    rootRestrictedByDefault: true,
  },
  brevity: {
    levels: ['brief', 'concise', 'minimal'],
    appendedLast: true,
    idempotent: true,
  },
};

export const SERVER_METADATA = {
  server: SERVER_INFO,
  api: API_METADATA,
  protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
  transports: ['stdio', 'streamable-http'],
  tools: [
    'route_request',
    'prepare_request',
    'explain_route',
    'compare_routes',
    'simulate_policy',
    'validate_model_inventory',
    'evaluate_router',
    'record_override',
    'get_preference_state',
    'reset_preference_state',
  ],
  adapterContract: ADAPTER_CONTRACT,
  pipeline: PIPELINE_METADATA,
  privacy: {
    localRouting: true,
    localCompression: true,
    localFileConversion: true,
    followsRemoteFileUrls: false,
    persistsPrompts: false,
    persistsContext: false,
    persistsFileExcerpts: false,
    persistsModelInventories: false,
    persistsEvaluationCases: false,
    persistsAggregatePreferencesOnlyWhenConfigured: true,
    telemetry: false,
    remoteInference: false,
  },
};
