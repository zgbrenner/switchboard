import { PROFILE_NAMES } from '../profiles.mjs';
import { API_VERSIONS, CAPABILITIES, EFFORTS, FILE_TYPES, JSON_SCHEMA, PLAN_MODES, POLICIES, ROLES, TIERS } from './constants.mjs';

const capabilitySchema = {
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(CAPABILITIES.map((key) => [key, { type: 'boolean' }])),
};
const contextSchema = {
  type: 'array',
  maxItems: 8,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['role', 'text'],
    properties: {
      role: { type: 'string', enum: ROLES },
      text: { type: 'string', minLength: 1, maxLength: 12_000, pattern: '.*\\S.*' },
    },
  },
};
const fileSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 512, pattern: '.*\\S.*' },
    size: { type: 'integer', minimum: 0, maximum: 1_000_000_000 },
    detectedType: { type: 'string', enum: FILE_TYPES },
    mediaType: { type: 'string', minLength: 1, maxLength: 200 },
    textLength: { type: 'integer', minimum: 0, maximum: 1_000_000 },
    excerpt: { type: 'string', maxLength: 4_000 },
    warnings: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 500 } },
    capabilities: {
      type: 'object',
      additionalProperties: false,
      properties: { vision: { type: 'boolean' }, longContext: { type: 'boolean' } },
    },
  },
};
export const MODEL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 200, pattern: '.*\\S.*' },
    title: { type: 'string', maxLength: 200 },
    family: { type: 'string', maxLength: 100 },
    tier: { type: 'string', enum: TIERS },
    effortLevels: { type: 'array', maxItems: 4, uniqueItems: true, items: { type: 'string', enum: EFFORTS } },
    capabilities: capabilitySchema,
    relativeCost: { type: 'number', minimum: 0, maximum: 1 },
    relativeLatency: { type: 'number', minimum: 0, maximum: 1 },
    available: { type: 'boolean' },
  },
};
const budgetSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    maxRelativeCost: { type: 'number', minimum: 0, maximum: 1 },
    maxRelativeLatency: { type: 'number', minimum: 0, maximum: 1 },
    minQuality: { type: 'number', minimum: 0, maximum: 1 },
    maxStages: { type: 'integer', minimum: 1, maximum: 4 },
  },
};
const routeProperties = {
  prompt: { type: 'string', minLength: 1, maxLength: 64_000, pattern: '.*\\S.*' },
  context: contextSchema,
  files: { type: 'array', maxItems: 20, items: fileSchema },
  policy: { type: 'string', enum: POLICIES },
  categoryBoosts: { type: 'object', maxProperties: 64, additionalProperties: { type: 'number', minimum: -0.35, maximum: 0.35 } },
  availableModels: { type: 'array', maxItems: 64, items: MODEL_INPUT_SCHEMA },
  currentModelId: { type: 'string', minLength: 1, maxLength: 200 },
  profile: { type: 'string', enum: PROFILE_NAMES },
  budget: budgetSchema,
  planMode: { type: 'string', enum: PLAN_MODES },
  apiVersion: { type: 'string', enum: API_VERSIONS },
};

export const ROUTE_INPUT_SCHEMA = {
  $schema: JSON_SCHEMA,
  type: 'object',
  additionalProperties: false,
  required: ['prompt'],
  properties: routeProperties,
};
export const ROUTE_OUTPUT_SCHEMA = {
  $schema: JSON_SCHEMA,
  type: 'object',
  additionalProperties: true,
  required: [
    'apiVersion',
    'tier',
    'effort',
    'capabilities',
    'confidence',
    'reasons',
    'scores',
    'taskCategories',
    'modelResolution',
    'confidenceEvidence',
    'executionPlan',
    'budgetAssessment',
  ],
  properties: {
    apiVersion: { type: 'string' },
    tier: { type: 'string', enum: TIERS },
    effort: { type: 'string', enum: EFFORTS },
    capabilities: capabilitySchema,
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    confidenceEvidence: { type: 'object' },
    executionPlan: { type: 'object' },
    budgetAssessment: { type: 'object' },
    modelResolution: { type: 'object' },
  },
};
export const INVENTORY_INPUT_SCHEMA = {
  $schema: JSON_SCHEMA,
  type: 'object',
  additionalProperties: false,
  required: ['availableModels'],
  properties: { availableModels: { type: 'array', maxItems: 64, items: MODEL_INPUT_SCHEMA } },
};
export const COMPARISON_INPUT_SCHEMA = {
  $schema: JSON_SCHEMA,
  type: 'object',
  additionalProperties: false,
  required: ['prompt', 'variants'],
  properties: {
    prompt: routeProperties.prompt,
    context: contextSchema,
    files: routeProperties.files,
    availableModels: routeProperties.availableModels,
    currentModelId: routeProperties.currentModelId,
    budget: budgetSchema,
    planMode: routeProperties.planMode,
    variants: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label'],
        properties: {
          label: { type: 'string', minLength: 1, maxLength: 80 },
          policy: { type: 'string', enum: POLICIES },
          profile: { type: 'string', enum: PROFILE_NAMES },
        },
      },
    },
  },
};
export const EVALUATION_INPUT_SCHEMA = {
  $schema: JSON_SCHEMA,
  type: 'object',
  additionalProperties: false,
  required: ['cases'],
  properties: {
    includePreferences: {
      type: 'boolean',
      default: false,
      description: 'When true, also report the observed preference-adjusted tier while baseline metrics remain preference independent.',
    },
    cases: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['prompt', 'expectedTier'],
        properties: {
          id: { type: 'string', maxLength: 100 },
          prompt: routeProperties.prompt,
          context: contextSchema,
          files: routeProperties.files,
          policy: routeProperties.policy,
          profile: routeProperties.profile,
          expectedTier: { type: 'string', enum: TIERS },
          requiredCapabilities: { type: 'array', maxItems: 5, uniqueItems: true, items: { type: 'string', enum: CAPABILITIES } },
        },
      },
    },
  },
};
