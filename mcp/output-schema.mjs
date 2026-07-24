import { CAPABILITIES, EFFORTS, TIERS } from './schema.mjs';
import { PROFILE_NAMES } from './profiles.mjs';

const JSON_SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const capabilitySchema = {
  type: 'object', additionalProperties: false, required: CAPABILITIES,
  properties: Object.fromEntries(CAPABILITIES.map((key) => [key, { type: 'boolean' }])),
};
const reasonSchema = {
  type: 'object', additionalProperties: false, required: ['code', 'detail', 'weight'],
  properties: { code: { type: 'string' }, detail: { type: 'string' }, weight: { type: 'number' } },
};
const modelSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'tier', 'effort', 'meetsRequirements', 'unknownCapabilities', 'relativeCost', 'relativeLatency', 'score'],
  properties: {
    id: { type: 'string' }, title: { type: 'string' }, family: { type: 'string' },
    tier: { type: 'string', enum: TIERS }, effort: { type: 'string', enum: EFFORTS },
    meetsRequirements: { type: 'boolean' },
    unknownCapabilities: { type: 'array', uniqueItems: true, items: { type: 'string', enum: CAPABILITIES } },
    relativeCost: { type: 'number', minimum: 0, maximum: 1 },
    relativeLatency: { type: 'number', minimum: 0, maximum: 1 },
    score: { type: 'number' },
  },
};
const stageSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'purpose', 'tier', 'effort', 'capabilities', 'optional'],
  properties: {
    id: { type: 'string', enum: ['answer', 'analyze', 'refine', 'verify'] },
    purpose: { type: 'string' }, tier: { type: 'string', enum: TIERS }, effort: { type: 'string', enum: EFFORTS },
    capabilities: capabilitySchema, optional: { type: 'boolean' },
  },
};
const negotiationSchema = {
  type: 'object', additionalProperties: false, required: ['requiredCapabilities', 'eligibleCount', 'rejected'],
  properties: {
    requiredCapabilities: { type: 'array', uniqueItems: true, items: { type: 'string', enum: CAPABILITIES } },
    eligibleCount: { type: 'integer', minimum: 0, maximum: 64 },
    rejected: { type: 'array', maxItems: 64, items: {
      type: 'object', additionalProperties: false, required: ['id', 'reasons'],
      properties: { id: { type: 'string' }, reasons: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } } },
    } },
  },
};
const learningSchema = {
  type: 'object', additionalProperties: false, required: ['applied', 'bias'],
  properties: {
    applied: { type: 'boolean' }, bias: { type: 'number', minimum: -0.35, maximum: 0.35 },
    reason: { type: 'string' }, fromTier: { type: 'string', enum: TIERS }, toTier: { type: 'string', enum: TIERS },
  },
};

export const ROUTE_OUTPUT_SCHEMA_V05 = {
  $schema: JSON_SCHEMA,
  type: 'object', additionalProperties: false,
  required: [
    'tier', 'effort', 'capabilities', 'confidence', 'shouldUseJudge', 'reasons', 'scores', 'taskCategories',
    'apiVersion', 'compatibility', 'effectiveProfile', 'effectivePolicy', 'learningAdjustment', 'confidenceEvidence',
    'executionPlan', 'budgetAssessment', 'modelResolution',
  ],
  properties: {
    tier: { type: 'string', enum: TIERS }, effort: { type: 'string', enum: EFFORTS }, capabilities: capabilitySchema,
    confidence: { type: 'number', minimum: 0, maximum: 1 }, shouldUseJudge: { type: 'boolean' },
    reasons: { type: 'array', items: reasonSchema },
    scores: { type: 'object', additionalProperties: false, required: TIERS, properties: Object.fromEntries(TIERS.map((tier) => [tier, { type: 'number', minimum: 0, maximum: 1 }])) },
    taskCategories: { type: 'array', items: { type: 'string' } },
    apiVersion: { type: 'string', enum: ['2026-07-24'] },
    compatibility: { type: 'object', additionalProperties: false, required: ['additiveFrom', 'responseContract'], properties: { additiveFrom: { type: 'string', const: '0.4.0' }, responseContract: { type: 'string', const: '2026-07-24' } } },
    effectiveProfile: { type: 'string', enum: PROFILE_NAMES }, effectivePolicy: { type: 'string', enum: ['best', 'balanced', 'fast', 'conserve'] },
    learningAdjustment: learningSchema,
    confidenceEvidence: { type: 'object', additionalProperties: false, required: ['overall', 'scoreMargin', 'deterministicEvidence', 'capabilityCertainty', 'agreement'], properties: Object.fromEntries(['overall', 'scoreMargin', 'deterministicEvidence', 'capabilityCertainty', 'agreement'].map((key) => [key, { type: 'number', minimum: 0, maximum: 1 }])) },
    executionPlan: { type: 'object', additionalProperties: false, required: ['mode', 'stages'], properties: { mode: { type: 'string', enum: ['single', 'multi'] }, stages: { type: 'array', minItems: 1, maxItems: 4, items: stageSchema } } },
    budgetAssessment: { type: 'object', additionalProperties: false, required: ['fits', 'violations', 'estimatedRelativeCost', 'estimatedRelativeLatency', 'estimatedQuality', 'constraints'], properties: {
      fits: { type: 'boolean' }, violations: { type: 'array', uniqueItems: true, items: { type: 'string', enum: ['cost', 'latency', 'quality'] } },
      estimatedRelativeCost: { type: 'number', minimum: 0, maximum: 1 }, estimatedRelativeLatency: { type: 'number', minimum: 0, maximum: 1 }, estimatedQuality: { type: 'number', minimum: 0, maximum: 1 },
      constraints: { type: 'object', additionalProperties: false, required: ['maxRelativeCost', 'maxRelativeLatency', 'minQuality', 'maxStages'], properties: {
        maxRelativeCost: { type: 'number', minimum: 0, maximum: 1 }, maxRelativeLatency: { type: 'number', minimum: 0, maximum: 1 }, minQuality: { type: 'number', minimum: 0, maximum: 1 }, maxStages: { type: 'integer', minimum: 1, maximum: 4 },
      } },
    } },
    modelResolution: { type: 'object', additionalProperties: false, required: ['status', 'recommended', 'alternatives', 'negotiation'], properties: {
      status: { type: 'string', enum: ['not-provided', 'recommended', 'no-compatible-model'] }, recommended: { anyOf: [modelSchema, { type: 'null' }] }, alternatives: { type: 'array', maxItems: 3, items: modelSchema }, negotiation: negotiationSchema,
    } },
  },
};
