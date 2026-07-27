import { SWITCHBOARD_API_VERSION } from '../enhance.mjs';

export const CURRENT_PROTOCOL_VERSION = '2025-11-25';
export const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-11-25', '2025-06-18', '2025-03-26']);
export const SERVER_INFO = {
  name: 'switchboard',
  title: 'Switchboard Router',
  version: '0.5.0',
  description: 'Local privacy-first request planning, model routing, diagnostics, evaluation, and aggregate preference learning for AI hosts.',
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

export const SERVER_METADATA = {
  server: SERVER_INFO,
  api: API_METADATA,
  protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
  transports: ['stdio', 'streamable-http'],
  tools: [
    'route_request', 'explain_route', 'compare_routes', 'simulate_policy', 'validate_model_inventory', 'evaluate_router',
    'record_override', 'get_preference_state', 'reset_preference_state',
  ],
  adapterContract: ADAPTER_CONTRACT,
  privacy: {
    localRouting: true,
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
