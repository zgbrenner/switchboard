const JSON_SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const POLICIES = new Set(['best', 'balanced', 'fast', 'conserve']);
const TIERS = new Set(['fast', 'balanced', 'deep', 'max']);
const EFFORTS = new Set(['low', 'medium', 'high', 'max']);
const FILE_TYPES = new Set(['text', 'markdown', 'html', 'json', 'csv', 'pdf', 'docx', 'pptx', 'xlsx', 'zip', 'image', 'unknown']);
const ROLES = new Set(['user', 'assistant']);
const CAPABILITIES = ['web', 'files', 'vision', 'longContext', 'code'];

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function exactKeys(value, allowed, label) {
  const accepted = new Set(allowed);
  for (const key of Object.keys(value)) if (!accepted.has(key)) throw new Error(`${label} contains an unsupported property: ${key}.`);
}

function string(value, label, { min = 0, max = 64_000 } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max) throw new Error(`${label} must be a string between ${min} and ${max} characters.`);
  return value;
}

function integer(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  return value;
}

function number(value, label, { min = 0, max = 1 } = {}) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be a number between ${min} and ${max}.`);
  return value;
}

function boolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function parseContext(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error('context must be an array with at most 8 turns.');
  let total = 0;
  return value.map((raw, index) => {
    const turn = object(raw, `context[${index}]`);
    exactKeys(turn, ['role', 'text'], `context[${index}]`);
    if (!ROLES.has(turn.role)) throw new Error(`context[${index}].role must be user or assistant.`);
    const text = string(turn.text, `context[${index}].text`, { min: 1, max: 12_000 });
    total += text.length;
    if (total > 32_000) throw new Error('context text exceeds the 32000-character limit.');
    return { role: turn.role, text };
  });
}

function defaultMediaType(detectedType) {
  return ({
    text: 'text/plain', markdown: 'text/markdown', html: 'text/html', json: 'application/json', csv: 'text/csv',
    pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip',
    image: 'application/octet-stream', unknown: 'application/octet-stream',
  })[detectedType];
}

function parseFiles(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error('files must be an array with at most 20 entries.');
  return value.map((raw, index) => {
    const file = object(raw, `files[${index}]`);
    exactKeys(file, ['name', 'size', 'detectedType', 'mediaType', 'textLength', 'excerpt', 'warnings', 'capabilities'], `files[${index}]`);
    const name = string(file.name, `files[${index}].name`, { min: 1, max: 512 });
    const detectedType = FILE_TYPES.has(file.detectedType) ? file.detectedType : 'unknown';
    const size = file.size === undefined ? 0 : integer(file.size, `files[${index}].size`, { max: 1_000_000_000 });
    const textLength = file.textLength === undefined ? 0 : integer(file.textLength, `files[${index}].textLength`, { max: 1_000_000 });
    const excerpt = file.excerpt === undefined ? '' : string(file.excerpt, `files[${index}].excerpt`, { max: 4_000 });
    const mediaType = file.mediaType === undefined ? defaultMediaType(detectedType) : string(file.mediaType, `files[${index}].mediaType`, { min: 1, max: 200 });
    const caps = file.capabilities === undefined ? {} : object(file.capabilities, `files[${index}].capabilities`);
    exactKeys(caps, ['vision', 'longContext'], `files[${index}].capabilities`);
    const warnings = file.warnings === undefined ? [] : file.warnings;
    if (!Array.isArray(warnings) || warnings.length > 20 || warnings.some((warning) => typeof warning !== 'string' || warning.length > 500)) {
      throw new Error(`files[${index}].warnings must contain at most 20 short strings.`);
    }
    const vision = boolean(caps.vision, detectedType === 'image');
    const longContext = boolean(caps.longContext, textLength > 24_000 || size > 8_000_000);
    return { name, size, detectedType, mediaType, textLength, excerpt, warnings, capabilities: { files: true, vision, longContext } };
  });
}

function parseBoosts(value) {
  if (value === undefined) return undefined;
  const raw = object(value, 'categoryBoosts');
  const entries = Object.entries(raw);
  if (entries.length > 64) throw new Error('categoryBoosts may contain at most 64 entries.');
  const output = {};
  for (const [key, boost] of entries) {
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/u.test(key)) throw new Error(`categoryBoosts contains an invalid key: ${key}.`);
    output[key] = number(boost, `categoryBoosts.${key}`, { min: -0.35, max: 0.35 });
  }
  return output;
}

function parseCapabilityMap(value, label) {
  if (value === undefined) return {};
  const raw = object(value, label);
  exactKeys(raw, CAPABILITIES, label);
  const output = {};
  for (const key of CAPABILITIES) if (raw[key] !== undefined) {
    if (typeof raw[key] !== 'boolean') throw new Error(`${label}.${key} must be boolean.`);
    output[key] = raw[key];
  }
  return output;
}

function parseModels(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 64) throw new Error('availableModels must be an array with at most 64 entries.');
  const identifiers = new Set();
  return value.map((raw, index) => {
    const model = object(raw, `availableModels[${index}]`);
    exactKeys(model, ['id', 'title', 'family', 'tier', 'effortLevels', 'capabilities', 'relativeCost', 'relativeLatency', 'available'], `availableModels[${index}]`);
    const id = string(model.id, `availableModels[${index}].id`, { min: 1, max: 200 });
    if (identifiers.has(id)) throw new Error(`availableModels contains duplicate id: ${id}.`);
    identifiers.add(id);
    const tier = model.tier === undefined ? 'balanced' : model.tier;
    if (!TIERS.has(tier)) throw new Error(`availableModels[${index}].tier is invalid.`);
    const effortLevels = model.effortLevels === undefined ? [] : model.effortLevels;
    if (!Array.isArray(effortLevels) || effortLevels.length > 4 || effortLevels.some((effort) => !EFFORTS.has(effort))) throw new Error(`availableModels[${index}].effortLevels is invalid.`);
    return {
      id,
      ...(model.title === undefined ? {} : { title: string(model.title, `availableModels[${index}].title`, { min: 1, max: 200 }) }),
      ...(model.family === undefined ? {} : { family: string(model.family, `availableModels[${index}].family`, { min: 1, max: 100 }) }),
      tier,
      effortLevels: [...new Set(effortLevels)],
      capabilities: parseCapabilityMap(model.capabilities, `availableModels[${index}].capabilities`),
      relativeCost: model.relativeCost === undefined ? 0.5 : number(model.relativeCost, `availableModels[${index}].relativeCost`),
      relativeLatency: model.relativeLatency === undefined ? 0.5 : number(model.relativeLatency, `availableModels[${index}].relativeLatency`),
      available: boolean(model.available, true),
    };
  });
}

export function normalizeRouteArguments(value) {
  const args = object(value ?? {}, 'route_request arguments');
  exactKeys(args, ['prompt', 'context', 'files', 'policy', 'categoryBoosts', 'availableModels', 'currentModelId'], 'route_request arguments');
  const prompt = string(args.prompt, 'prompt', { min: 1, max: 64_000 });
  const policy = args.policy === undefined ? 'balanced' : args.policy;
  if (!POLICIES.has(policy)) throw new Error('policy must be one of best, balanced, fast, or conserve.');
  const categoryBoosts = parseBoosts(args.categoryBoosts);
  const availableModels = parseModels(args.availableModels);
  const currentModelId = args.currentModelId === undefined ? undefined : string(args.currentModelId, 'currentModelId', { min: 1, max: 200 });
  if (currentModelId !== undefined && availableModels === undefined) throw new Error('currentModelId requires availableModels.');
  return {
    request: {
      prompt,
      context: parseContext(args.context),
      files: parseFiles(args.files),
      preferences: { policy, ...(categoryBoosts ? { categoryBoosts } : {}) },
    },
    availableModels,
    currentModelId,
  };
}

const CAPABILITY_SCHEMA = {
  type: 'object', additionalProperties: false, required: CAPABILITIES,
  properties: Object.fromEntries(CAPABILITIES.map((key) => [key, { type: 'boolean' }])),
};

const MODEL_INPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 200 },
    title: { type: 'string', minLength: 1, maxLength: 200 },
    family: { type: 'string', minLength: 1, maxLength: 100 },
    tier: { type: 'string', enum: [...TIERS], default: 'balanced' },
    effortLevels: { type: 'array', maxItems: 4, uniqueItems: true, items: { type: 'string', enum: [...EFFORTS] } },
    capabilities: { type: 'object', additionalProperties: false, properties: Object.fromEntries(CAPABILITIES.map((key) => [key, { type: 'boolean' }])) },
    relativeCost: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
    relativeLatency: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
    available: { type: 'boolean', default: true },
  },
};

const MODEL_RESULT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['id', 'tier', 'effort', 'meetsRequirements', 'unknownCapabilities', 'relativeCost', 'relativeLatency', 'score'],
  properties: {
    id: { type: 'string' }, title: { type: 'string' }, family: { type: 'string' },
    tier: { type: 'string', enum: [...TIERS] }, effort: { type: 'string', enum: [...EFFORTS] },
    meetsRequirements: { type: 'boolean' },
    unknownCapabilities: { type: 'array', items: { type: 'string', enum: CAPABILITIES } },
    relativeCost: { type: 'number', minimum: 0, maximum: 1 }, relativeLatency: { type: 'number', minimum: 0, maximum: 1 }, score: { type: 'number' },
  },
};

export const ROUTE_INPUT_SCHEMA = {
  $schema: JSON_SCHEMA,
  type: 'object', additionalProperties: false, required: ['prompt'],
  properties: {
    prompt: { type: 'string', minLength: 1, maxLength: 64_000, description: 'The current user request to classify.' },
    context: {
      type: 'array', maxItems: 8, description: 'Up to eight recent turns, used only for this routing decision.',
      items: { type: 'object', additionalProperties: false, required: ['role', 'text'], properties: { role: { type: 'string', enum: ['user', 'assistant'] }, text: { type: 'string', minLength: 1, maxLength: 12_000 } } },
    },
    files: {
      type: 'array', maxItems: 20, description: 'Optional bounded file metadata and excerpts.',
      items: {
        type: 'object', additionalProperties: false, required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 512 }, size: { type: 'integer', minimum: 0, maximum: 1_000_000_000 },
          detectedType: { type: 'string', enum: [...FILE_TYPES] }, mediaType: { type: 'string', minLength: 1, maxLength: 200 },
          textLength: { type: 'integer', minimum: 0, maximum: 1_000_000 }, excerpt: { type: 'string', maxLength: 4_000 },
          warnings: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 500 } },
          capabilities: { type: 'object', additionalProperties: false, properties: { vision: { type: 'boolean' }, longContext: { type: 'boolean' } } },
        },
      },
    },
    policy: { type: 'string', enum: [...POLICIES], default: 'balanced' },
    categoryBoosts: { type: 'object', maxProperties: 64, additionalProperties: { type: 'number', minimum: -0.35, maximum: 0.35 } },
    availableModels: { type: 'array', maxItems: 64, description: 'Optional host model inventory used to recommend one concrete model.', items: MODEL_INPUT_SCHEMA },
    currentModelId: { type: 'string', minLength: 1, maxLength: 200, description: 'Current model identifier, used to avoid unnecessary switches when it remains adequate.' },
  },
};

export const ROUTE_OUTPUT_SCHEMA = {
  $schema: JSON_SCHEMA,
  type: 'object', additionalProperties: false,
  required: ['tier', 'effort', 'capabilities', 'confidence', 'shouldUseJudge', 'reasons', 'scores', 'taskCategories', 'modelResolution'],
  properties: {
    tier: { type: 'string', enum: [...TIERS] }, effort: { type: 'string', enum: [...EFFORTS] }, capabilities: CAPABILITY_SCHEMA,
    confidence: { type: 'number', minimum: 0, maximum: 1 }, shouldUseJudge: { type: 'boolean' },
    reasons: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['code', 'detail', 'weight'], properties: { code: { type: 'string' }, detail: { type: 'string' }, weight: { type: 'number' } } } },
    scores: { type: 'object', additionalProperties: false, required: [...TIERS], properties: Object.fromEntries([...TIERS].map((tier) => [tier, { type: 'number', minimum: 0, maximum: 1 }])) },
    taskCategories: { type: 'array', items: { type: 'string' } },
    modelResolution: {
      type: 'object', additionalProperties: false, required: ['status', 'recommended', 'alternatives'],
      properties: {
        status: { type: 'string', enum: ['not-provided', 'recommended', 'no-compatible-model'] },
        recommended: { anyOf: [MODEL_RESULT_SCHEMA, { type: 'null' }] },
        alternatives: { type: 'array', maxItems: 3, items: MODEL_RESULT_SCHEMA },
      },
    },
  },
};
