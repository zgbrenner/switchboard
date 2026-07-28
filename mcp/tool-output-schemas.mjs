import { ROUTE_OUTPUT_SCHEMA_V05 } from './output-schema.mjs';
import { PROFILE_NAMES } from './profiles.mjs';
import { CAPABILITIES, EFFORTS, TIERS } from './schema.mjs';

const JSON_SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const stringArray = { type: 'array', items: { type: 'string' } };
const tierSchema = { type: 'string', enum: TIERS };
const effortSchema = { type: 'string', enum: EFFORTS };

const confidenceEvidenceSchema = ROUTE_OUTPUT_SCHEMA_V05.properties.confidenceEvidence;
const modelResolutionSchema = ROUTE_OUTPUT_SCHEMA_V05.properties.modelResolution;
const executionPlanSchema = ROUTE_OUTPUT_SCHEMA_V05.properties.executionPlan;
const budgetAssessmentSchema = ROUTE_OUTPUT_SCHEMA_V05.properties.budgetAssessment;

export const EXPLAIN_OUTPUT_SCHEMA = {
  $schema: JSON_SCHEMA,
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'route',
    'requiredCapabilities',
    'reasons',
    'confidenceEvidence',
    'modelResolution',
    'executionPlan',
    'budgetAssessment',
  ],
  properties: {
    summary: { type: 'string' },
    route: {
      type: 'object',
      additionalProperties: false,
      required: ['tier', 'effort'],
      properties: { tier: tierSchema, effort: effortSchema },
    },
    requiredCapabilities: { type: 'array', uniqueItems: true, items: { type: 'string', enum: CAPABILITIES } },
    reasons: stringArray,
    confidenceEvidence: confidenceEvidenceSchema,
    modelResolution: modelResolutionSchema,
    executionPlan: executionPlanSchema,
    budgetAssessment: budgetAssessmentSchema,
  },
};

const comparisonRowSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'profile', 'policy', 'tier', 'effort', 'confidence', 'modelId', 'fitsBudget', 'stageCount'],
  properties: {
    label: { type: 'string' },
    profile: { type: 'string', enum: PROFILE_NAMES },
    policy: { type: 'string', enum: ['best', 'balanced', 'fast', 'conserve'] },
    tier: tierSchema,
    effort: effortSchema,
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    modelId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    fitsBudget: { type: 'boolean' },
    stageCount: { type: 'integer', minimum: 1, maximum: 4 },
  },
};

export const COMPARISON_OUTPUT_SCHEMA = {
  $schema: JSON_SCHEMA,
  type: 'object',
  additionalProperties: false,
  required: ['results', 'differences'],
  properties: {
    results: { type: 'array', minItems: 2, maxItems: 8, items: comparisonRowSchema },
    differences: {
      type: 'object',
      additionalProperties: false,
      required: ['tierSpread', 'distinctTiers', 'distinctModels', 'budgetConflicts'],
      properties: {
        tierSpread: { type: 'integer', minimum: 0, maximum: 3 },
        distinctTiers: { type: 'array', uniqueItems: true, items: tierSchema },
        distinctModels: { type: 'array', uniqueItems: true, items: { type: 'string' } },
        budgetConflicts: { type: 'array', uniqueItems: true, items: { type: 'string' } },
      },
    },
  },
};

export const INVENTORY_OUTPUT_SCHEMA = {
  $schema: JSON_SCHEMA,
  type: 'object',
  additionalProperties: false,
  required: ['valid', 'modelCount', 'availableCount', 'tiers', 'capabilityCoverage', 'unavailable', 'unknownCapabilityModels', 'warnings'],
  properties: {
    valid: { type: 'boolean', const: true },
    modelCount: { type: 'integer', minimum: 0, maximum: 64 },
    availableCount: { type: 'integer', minimum: 0, maximum: 64 },
    tiers: {
      type: 'object',
      additionalProperties: false,
      required: TIERS,
      properties: Object.fromEntries(TIERS.map((tier) => [tier, { type: 'integer', minimum: 0, maximum: 64 }])),
    },
    capabilityCoverage: {
      type: 'object',
      additionalProperties: false,
      required: CAPABILITIES,
      properties: Object.fromEntries(CAPABILITIES.map((capability) => [capability, { type: 'integer', minimum: 0, maximum: 64 }])),
    },
    unavailable: { type: 'array', uniqueItems: true, items: { type: 'string' } },
    unknownCapabilityModels: {
      type: 'array',
      maxItems: 64,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'capabilities'],
        properties: {
          id: { type: 'string' },
          capabilities: { type: 'array', uniqueItems: true, items: { type: 'string', enum: CAPABILITIES } },
        },
      },
    },
    warnings: stringArray,
  },
};

const countRateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['count', 'rate'],
  properties: { count: { type: 'integer', minimum: 0 }, rate: { type: 'number', minimum: 0, maximum: 1 } },
};

const confusionRowSchema = {
  type: 'object',
  additionalProperties: false,
  required: TIERS,
  properties: Object.fromEntries(TIERS.map((tier) => [tier, { type: 'integer', minimum: 0 }])),
};

export const EVALUATION_OUTPUT_SCHEMA = {
  $schema: JSON_SCHEMA,
  type: 'object',
  additionalProperties: false,
  required: [
    'caseCount',
    'evaluationMode',
    'preferenceAdjustedCases',
    'exactTierAccuracy',
    'harmfulUnderRouting',
    'overRouting',
    'capabilityRecall',
    'confusionMatrix',
    'cases',
    'capabilityKeys',
  ],
  properties: {
    caseCount: { type: 'integer', minimum: 1, maximum: 100 },
    evaluationMode: { type: 'string', const: 'baseline-with-preference-observation' },
    preferenceAdjustedCases: { type: 'integer', minimum: 0, maximum: 100 },
    exactTierAccuracy: { type: 'number', minimum: 0, maximum: 1 },
    harmfulUnderRouting: countRateSchema,
    overRouting: countRateSchema,
    capabilityRecall: { type: 'number', minimum: 0, maximum: 1 },
    confusionMatrix: {
      type: 'object',
      additionalProperties: false,
      required: TIERS,
      properties: Object.fromEntries(TIERS.map((tier) => [tier, confusionRowSchema])),
    },
    cases: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'expectedTier',
          'actualTier',
          'observedTier',
          'preferenceAdjusted',
          'learningApplied',
          'tierDelta',
          'missingCapabilities',
          'passed',
        ],
        properties: {
          id: { type: 'string' },
          expectedTier: tierSchema,
          actualTier: tierSchema,
          observedTier: tierSchema,
          preferenceAdjusted: { type: 'boolean' },
          learningApplied: { type: 'boolean' },
          tierDelta: { type: 'integer', minimum: -3, maximum: 3 },
          missingCapabilities: { type: 'array', uniqueItems: true, items: { type: 'string', enum: CAPABILITIES } },
          passed: { type: 'boolean' },
        },
      },
    },
    capabilityKeys: { type: 'array', uniqueItems: true, items: { type: 'string', enum: CAPABILITIES } },
  },
};

const preferenceCategorySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['bias', 'overrides', 'upgrades', 'downgrades'],
  properties: {
    bias: { type: 'number', minimum: -0.35, maximum: 0.35 },
    overrides: { type: 'integer', minimum: 0 },
    upgrades: { type: 'integer', minimum: 0 },
    downgrades: { type: 'integer', minimum: 0 },
  },
};

export const PREFERENCE_STATE_OUTPUT_SCHEMA = {
  $schema: JSON_SCHEMA,
  type: 'object',
  additionalProperties: false,
  required: ['version', 'persistent', 'updatedAt', 'totalOverrides', 'categories'],
  properties: {
    version: { type: 'integer', const: 1 },
    persistent: { type: 'boolean' },
    updatedAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    totalOverrides: { type: 'integer', minimum: 0 },
    categories: { type: 'object', additionalProperties: preferenceCategorySchema },
  },
};
