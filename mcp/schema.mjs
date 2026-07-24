const POLICIES = new Set(['best', 'balanced', 'fast', 'conserve']);
const FILE_TYPES = new Set(['text', 'markdown', 'html', 'json', 'csv', 'pdf', 'docx', 'pptx', 'xlsx', 'zip', 'image', 'unknown']);
const ROLES = new Set(['user', 'assistant']);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function string(value, label, { min = 0, max = 64_000 } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max) throw new Error(`${label} must be a string between ${min} and ${max} characters.`);
  return value;
}

function integer(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer between ${min} and ${max}.`);
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
    const name = string(file.name, `files[${index}].name`, { min: 1, max: 512 });
    const detectedType = FILE_TYPES.has(file.detectedType) ? file.detectedType : 'unknown';
    const size = file.size === undefined ? 0 : integer(file.size, `files[${index}].size`, { max: 1_000_000_000 });
    const textLength = file.textLength === undefined ? 0 : integer(file.textLength, `files[${index}].textLength`, { max: 1_000_000 });
    const excerpt = file.excerpt === undefined ? '' : string(file.excerpt, `files[${index}].excerpt`, { max: 4_000 });
    const mediaType = file.mediaType === undefined ? defaultMediaType(detectedType) : string(file.mediaType, `files[${index}].mediaType`, { min: 1, max: 200 });
    const caps = file.capabilities === undefined ? {} : object(file.capabilities, `files[${index}].capabilities`);
    const warnings = file.warnings === undefined ? [] : file.warnings;
    if (!Array.isArray(warnings) || warnings.length > 20 || warnings.some((warning) => typeof warning !== 'string' || warning.length > 500)) {
      throw new Error(`files[${index}].warnings must contain at most 20 short strings.`);
    }
    const vision = boolean(caps.vision, detectedType === 'image');
    const longContext = boolean(caps.longContext, textLength > 24_000 || size > 8_000_000);
    return {
      name,
      size,
      detectedType,
      mediaType,
      textLength,
      excerpt,
      warnings,
      capabilities: { files: true, vision, longContext },
    };
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
    if (!Number.isFinite(boost) || boost < -0.35 || boost > 0.35) throw new Error(`categoryBoosts.${key} must be between -0.35 and 0.35.`);
    output[key] = boost;
  }
  return output;
}

export function normalizeRouteArguments(value) {
  const args = object(value ?? {}, 'route_request arguments');
  const prompt = string(args.prompt, 'prompt', { min: 1, max: 64_000 });
  const policy = args.policy === undefined ? 'balanced' : args.policy;
  if (!POLICIES.has(policy)) throw new Error('policy must be one of best, balanced, fast, or conserve.');
  const categoryBoosts = parseBoosts(args.categoryBoosts);
  return {
    prompt,
    context: parseContext(args.context),
    files: parseFiles(args.files),
    preferences: { policy, ...(categoryBoosts ? { categoryBoosts } : {}) },
  };
}

export const ROUTE_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt'],
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
          name: { type: 'string', minLength: 1, maxLength: 512 },
          size: { type: 'integer', minimum: 0, maximum: 1_000_000_000 },
          detectedType: { type: 'string', enum: [...FILE_TYPES] },
          mediaType: { type: 'string', minLength: 1, maxLength: 200 },
          textLength: { type: 'integer', minimum: 0, maximum: 1_000_000 },
          excerpt: { type: 'string', maxLength: 4_000 },
          warnings: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 500 } },
          capabilities: { type: 'object', additionalProperties: false, properties: { vision: { type: 'boolean' }, longContext: { type: 'boolean' } } },
        },
      },
    },
    policy: { type: 'string', enum: ['best', 'balanced', 'fast', 'conserve'], default: 'balanced' },
    categoryBoosts: { type: 'object', maxProperties: 64, additionalProperties: { type: 'number', minimum: -0.35, maximum: 0.35 } },
  },
};

export const ROUTE_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['tier', 'effort', 'capabilities', 'confidence', 'shouldUseJudge', 'reasons', 'scores', 'taskCategories'],
  properties: {
    tier: { type: 'string', enum: ['fast', 'balanced', 'deep', 'max'] },
    effort: { type: 'string', enum: ['low', 'medium', 'high', 'max'] },
    capabilities: { type: 'object' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    shouldUseJudge: { type: 'boolean' },
    reasons: { type: 'array' },
    scores: { type: 'object' },
    taskCategories: { type: 'array' },
  },
};
