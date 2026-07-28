import { PROFILE_NAMES } from '../profiles.mjs';
import { API_VERSIONS, CAPABILITIES, EFFORTS, FILE_TYPES, JSON_SCHEMA, PLAN_MODES, POLICIES, ROLES, TIERS } from './constants.mjs';

const CAPABILITY_DESCRIPTION = {
  web: 'The task needs live web access or current sources.',
  files: 'The task needs the model to read attached files.',
  vision: 'The task needs image understanding.',
  longContext: 'The task needs a large context window.',
  code: 'The task needs code understanding or generation.',
};

const capabilitySchema = {
  type: 'object',
  additionalProperties: false,
  description: 'Capability flags. Omitted keys mean unknown, which is treated differently from an explicit false.',
  properties: Object.fromEntries(CAPABILITIES.map((key) => [key, { type: 'boolean', description: CAPABILITY_DESCRIPTION[key] }])),
};

const contextSchema = {
  type: 'array',
  maxItems: 8,
  description:
    'Up to 8 recent conversation turns, oldest first. Used only to interpret short follow-ups such as "do it again" whose difficulty is carried by the earlier turn. Capped at 32,000 characters in total.',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['role', 'text'],
    properties: {
      role: { type: 'string', enum: ROLES, description: 'Who produced this turn.' },
      text: { type: 'string', minLength: 1, maxLength: 12_000, pattern: '.*\\S.*', description: 'The turn text.' },
    },
  },
};

const fileSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  description: 'Metadata describing one attachment. Switchboard never receives file bytes.',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 512, pattern: '.*\\S.*', description: 'File name, used for type inference only.' },
    size: { type: 'integer', minimum: 0, maximum: 1_000_000_000, description: 'File size in bytes.' },
    detectedType: { type: 'string', enum: FILE_TYPES, description: 'Host-detected file type.' },
    mediaType: { type: 'string', minLength: 1, maxLength: 200, description: 'MIME type, for example application/pdf.' },
    textLength: {
      type: 'integer',
      minimum: 0,
      maximum: 1_000_000,
      description: 'Characters of text the host extracted. Drives the long-context floor.',
    },
    excerpt: {
      type: 'string',
      maxLength: 4_000,
      description: 'Short excerpt used for topic signals. Send only what you are willing to share.',
    },
    warnings: {
      type: 'array',
      maxItems: 20,
      items: { type: 'string', maxLength: 500 },
      description: 'Extraction warnings, for example truncation or a parse failure.',
    },
    capabilities: {
      type: 'object',
      additionalProperties: false,
      description: 'Capabilities this attachment requires of the model.',
      properties: {
        vision: { type: 'boolean', description: 'The attachment must be interpreted visually.' },
        longContext: { type: 'boolean', description: 'The attachment needs a large context window.' },
      },
    },
  },
};

export const MODEL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  description: 'One model the host can actually invoke. Provider-independent by design: Switchboard never assumes a vendor.',
  properties: {
    id: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
      pattern: '.*\\S.*',
      description: 'Host-side identifier, returned verbatim in the recommendation.',
    },
    title: { type: 'string', maxLength: 200, description: 'Human-readable name.' },
    family: { type: 'string', maxLength: 100, description: 'Model family, used only for grouping.' },
    tier: { type: 'string', enum: TIERS, description: 'Quality tier this model belongs to.' },
    effortLevels: {
      type: 'array',
      maxItems: 4,
      uniqueItems: true,
      items: { type: 'string', enum: EFFORTS },
      description: 'Reasoning-effort levels this model supports. An empty array means effort is not selectable.',
    },
    capabilities: capabilitySchema,
    relativeCost: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Cost normalised across your own inventory, where 1 is your most expensive model.',
    },
    relativeLatency: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Latency normalised across your own inventory, where 1 is your slowest model.',
    },
    available: { type: 'boolean', description: 'Set false to exclude the model from selection without removing it.' },
  },
};

const budgetSchema = {
  type: 'object',
  additionalProperties: false,
  description:
    'Optional ceilings. Switchboard reports whether the routed plan fits; it never silently violates a capability or safety floor to satisfy a budget.',
  properties: {
    maxRelativeCost: { type: 'number', minimum: 0, maximum: 1, description: 'Largest acceptable relativeCost.' },
    maxRelativeLatency: { type: 'number', minimum: 0, maximum: 1, description: 'Largest acceptable relativeLatency.' },
    minQuality: { type: 'number', minimum: 0, maximum: 1, description: 'Smallest acceptable normalised quality.' },
    maxStages: { type: 'integer', minimum: 1, maximum: 4, description: 'Largest acceptable number of execution-plan stages.' },
  },
};

const promptSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 64_000,
  pattern: '.*\\S.*',
  description: 'The request to route. Analysed in-process and never stored, logged, or transmitted.',
};

const policySchema = {
  type: 'string',
  enum: POLICIES,
  description:
    'Cost/quality preference. "best" biases upward, "fast" and "conserve" bias downward, "balanced" is neutral. A policy can move a borderline request one tier but can never route beneath a capability or safety floor. Default: balanced.',
};

const profileSchema = {
  type: 'string',
  enum: PROFILE_NAMES,
  description: 'Domain profile. A profile may raise a tier or capability floor; it can never lower one. Default: general.',
};

const filesSchema = {
  type: 'array',
  maxItems: 20,
  items: fileSchema,
  description: 'Attachment metadata. Any attachment requires a file-capable model and raises the floor to at least balanced.',
};

const availableModelsSchema = {
  type: 'array',
  maxItems: 64,
  items: MODEL_INPUT_SCHEMA,
  description: 'Your model inventory. Supply it to receive a concrete model recommendation; omit it to receive a tier recommendation only.',
};

const currentModelIdSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 200,
  description: 'Model already in use, preferred on ties to avoid pointless switching mid-conversation. Requires availableModels.',
};

const planModeSchema = {
  type: 'string',
  enum: PLAN_MODES,
  description: '"single" forces a one-stage plan, "multi" forces staged execution, "auto" decides from difficulty. Default: auto.',
};

const routeProperties = {
  prompt: promptSchema,
  context: contextSchema,
  files: filesSchema,
  policy: policySchema,
  categoryBoosts: {
    type: 'object',
    maxProperties: 64,
    additionalProperties: { type: 'number', minimum: -0.35, maximum: 0.35 },
    description:
      'Per-category score nudges, keyed by task category (for example "code" or "high-stakes"). Bounded to +/-0.35 so a boost can influence a borderline decision without overriding a floor.',
  },
  availableModels: availableModelsSchema,
  currentModelId: currentModelIdSchema,
  profile: profileSchema,
  budget: budgetSchema,
  planMode: planModeSchema,
  apiVersion: { type: 'string', enum: API_VERSIONS, description: 'Pin the response contract version. Defaults to the current contract.' },
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
    apiVersion: { type: 'string', description: 'Response contract version.' },
    tier: { type: 'string', enum: TIERS, description: 'Recommended quality tier.' },
    effort: { type: 'string', enum: EFFORTS, description: 'Recommended reasoning-effort level.' },
    capabilities: capabilitySchema,
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description:
        'Strength of the evidence behind this decision, from 0.25 when nothing matched to about 0.97 when many strong signals agree. This is NOT a calibrated probability and should not be thresholded as one.',
    },
    confidenceEvidence: { type: 'object', description: 'Breakdown of what the confidence figure is composed of.' },
    executionPlan: { type: 'object', description: 'Single- or multi-stage plan for carrying out the request.' },
    budgetAssessment: { type: 'object', description: 'Whether the plan fits the supplied budget, and which constraints it violates.' },
    modelResolution: {
      type: 'object',
      description:
        'Model selected from availableModels. status is "recommended" only when the model meets the routed tier, effort and capabilities; "best-effort" when the closest candidate falls short; "no-compatible-model" when nothing qualifies.',
    },
  },
};

export const INVENTORY_INPUT_SCHEMA = {
  $schema: JSON_SCHEMA,
  type: 'object',
  additionalProperties: false,
  required: ['availableModels'],
  properties: {
    availableModels: {
      type: 'array',
      maxItems: 64,
      items: MODEL_INPUT_SCHEMA,
      description: 'Inventory to validate. Reports structural problems and coverage gaps without routing anything.',
    },
  },
};

export const COMPARISON_INPUT_SCHEMA = {
  $schema: JSON_SCHEMA,
  type: 'object',
  additionalProperties: false,
  required: ['prompt', 'variants'],
  properties: {
    prompt: promptSchema,
    context: contextSchema,
    files: filesSchema,
    availableModels: availableModelsSchema,
    currentModelId: currentModelIdSchema,
    budget: budgetSchema,
    planMode: planModeSchema,
    variants: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      description:
        'Between 2 and 8 policy/profile combinations to route the same prompt under, so their outcomes can be compared side by side.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label'],
        properties: {
          label: { type: 'string', minLength: 1, maxLength: 80, description: 'Name for this variant, echoed in the results.' },
          policy: policySchema,
          profile: profileSchema,
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
      description:
        'Between 1 and 100 labelled cases. Reports accuracy, under-routing, over-routing, capability recall and a confusion matrix.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['prompt', 'expectedTier'],
        properties: {
          id: { type: 'string', maxLength: 100, description: 'Identifier echoed back so failures can be traced to a case.' },
          prompt: promptSchema,
          context: contextSchema,
          files: filesSchema,
          policy: policySchema,
          profile: profileSchema,
          expectedTier: { type: 'string', enum: TIERS, description: 'The tier this case should route to.' },
          requiredCapabilities: {
            type: 'array',
            maxItems: 5,
            uniqueItems: true,
            items: { type: 'string', enum: CAPABILITIES },
            description: 'Capabilities the routing decision must detect for this case.',
          },
        },
      },
    },
  },
};
