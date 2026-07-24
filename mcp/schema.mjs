import { PROFILE_NAMES } from './profiles.mjs';

const JSON_SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
export const POLICIES = ['best', 'balanced', 'fast', 'conserve'];
export const TIERS = ['fast', 'balanced', 'deep', 'max'];
export const EFFORTS = ['low', 'medium', 'high', 'max'];
export const CAPABILITIES = ['web', 'files', 'vision', 'longContext', 'code'];
const FILE_TYPES = ['text', 'markdown', 'html', 'json', 'csv', 'pdf', 'docx', 'pptx', 'xlsx', 'zip', 'image', 'unknown'];
const ROLES = ['user', 'assistant'];
const PLAN_MODES = ['single', 'auto', 'multi'];
const API_VERSIONS = ['2026-07-24'];

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function exactKeys(value, allowed, label) {
  const accepted = new Set(allowed);
  for (const key of Object.keys(value)) if (!accepted.has(key)) throw new Error(`${label} contains an unsupported property: ${key}.`);
}

function string(value, label, { min = 0, max = 64_000, nonWhitespace = false } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max || (nonWhitespace && !value.trim())) {
    throw new Error(`${label} must be a string between ${min} and ${max} characters${nonWhitespace ? ' and contain a non-whitespace character' : ''}.`);
  }
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

function optionalBoolean(value, label, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`);
  return value;
}

function enumValue(value, values, label, fallback) {
  if (value === undefined) return fallback;
  if (!values.includes(value)) throw new Error(`${label} must be one of ${values.join(', ')}.`);
  return value;
}

function parseContext(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error('context must be an array with at most 8 turns.');
  let total = 0;
  return value.map((raw, index) => {
    const turn = object(raw, `context[${index}]`);
    exactKeys(turn, ['role', 'text'], `context[${index}]`);
    const role = enumValue(turn.role, ROLES, `context[${index}].role`);
    const text = string(turn.text, `context[${index}].text`, { min: 1, max: 12_000, nonWhitespace: true });
    total += text.length;
    if (total > 32_000) throw new Error('context text exceeds the 32000-character limit.');
    return { role, text };
  });
}

function defaultMediaType(type) {
  return ({ text: 'text/plain', markdown: 'text/markdown', html: 'text/html', json: 'application/json', csv: 'text/csv', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip', image: 'application/octet-stream', unknown: 'application/octet-stream' })[type];
}

function parseFiles(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error('files must be an array with at most 20 entries.');
  return value.map((raw, index) => {
    const file = object(raw, `files[${index}]`);
    exactKeys(file, ['name', 'size', 'detectedType', 'mediaType', 'textLength', 'excerpt', 'warnings', 'capabilities'], `files[${index}]`);
    const name = string(file.name, `files[${index}].name`, { min: 1, max: 512, nonWhitespace: true });
    const detectedType = enumValue(file.detectedType, FILE_TYPES, `files[${index}].detectedType`, 'unknown');
    const size = file.size === undefined ? 0 : integer(file.size, `files[${index}].size`, { max: 1_000_000_000 });
    const textLength = file.textLength === undefined ? 0 : integer(file.textLength, `files[${index}].textLength`, { max: 1_000_000 });
    const excerpt = file.excerpt === undefined ? '' : string(file.excerpt, `files[${index}].excerpt`, { max: 4_000 });
    const mediaType = file.mediaType === undefined ? defaultMediaType(detectedType) : string(file.mediaType, `files[${index}].mediaType`, { min: 1, max: 200, nonWhitespace: true });
    const caps = file.capabilities === undefined ? {} : object(file.capabilities, `files[${index}].capabilities`);
    exactKeys(caps, ['vision', 'longContext'], `files[${index}].capabilities`);
    const warnings = file.warnings === undefined ? [] : file.warnings;
    if (!Array.isArray(warnings) || warnings.length > 20 || warnings.some((warning) => typeof warning !== 'string' || warning.length > 500)) throw new Error(`files[${index}].warnings must contain at most 20 short strings.`);
    return { name, size, detectedType, mediaType, textLength, excerpt, warnings, capabilities: { files: true, vision: optionalBoolean(caps.vision, `files[${index}].capabilities.vision`, detectedType === 'image'), longContext: optionalBoolean(caps.longContext, `files[${index}].capabilities.longContext`, textLength > 24_000 || size > 8_000_000) } };
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
  for (const key of CAPABILITIES) if (raw[key] !== undefined) output[key] = optionalBoolean(raw[key], `${label}.${key}`);
  return output;
}

export function normalizeModelInventory(value, label = 'availableModels') {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 64) throw new Error(`${label} must be an array with at most 64 entries.`);
  const identifiers = new Set();
  return value.map((raw, index) => {
    const prefix = `${label}[${index}]`;
    const model = object(raw, prefix);
    exactKeys(model, ['id', 'title', 'family', 'tier', 'effortLevels', 'capabilities', 'relativeCost', 'relativeLatency', 'available'], prefix);
    const id = string(model.id, `${prefix}.id`, { min: 1, max: 200, nonWhitespace: true });
    if (identifiers.has(id)) throw new Error(`${label} contains duplicate id: ${id}.`);
    identifiers.add(id);
    const tier = enumValue(model.tier, TIERS, `${prefix}.tier`, 'balanced');
    const effortLevels = model.effortLevels === undefined ? [] : model.effortLevels;
    if (!Array.isArray(effortLevels) || effortLevels.length > 4 || effortLevels.some((effort) => !EFFORTS.includes(effort)) || new Set(effortLevels).size !== effortLevels.length) throw new Error(`${prefix}.effortLevels is invalid or contains duplicates.`);
    return {
      id,
      ...(model.title === undefined ? {} : { title: string(model.title, `${prefix}.title`, { min: 1, max: 200, nonWhitespace: true }) }),
      ...(model.family === undefined ? {} : { family: string(model.family, `${prefix}.family`, { min: 1, max: 100, nonWhitespace: true }) }),
      tier,
      effortLevels,
      capabilities: parseCapabilityMap(model.capabilities, `${prefix}.capabilities`),
      relativeCost: model.relativeCost === undefined ? 0.5 : number(model.relativeCost, `${prefix}.relativeCost`),
      relativeLatency: model.relativeLatency === undefined ? 0.5 : number(model.relativeLatency, `${prefix}.relativeLatency`),
      available: optionalBoolean(model.available, `${prefix}.available`, true),
    };
  });
}

function parseBudget(value) {
  if (value === undefined) return undefined;
  const budget = object(value, 'budget');
  exactKeys(budget, ['maxRelativeCost', 'maxRelativeLatency', 'minQuality', 'maxStages'], 'budget');
  return {
    ...(budget.maxRelativeCost === undefined ? {} : { maxRelativeCost: number(budget.maxRelativeCost, 'budget.maxRelativeCost') }),
    ...(budget.maxRelativeLatency === undefined ? {} : { maxRelativeLatency: number(budget.maxRelativeLatency, 'budget.maxRelativeLatency') }),
    ...(budget.minQuality === undefined ? {} : { minQuality: number(budget.minQuality, 'budget.minQuality') }),
    ...(budget.maxStages === undefined ? {} : { maxStages: integer(budget.maxStages, 'budget.maxStages', { min: 1, max: 4 }) }),
  };
}

export function normalizeRouteArguments(value) {
  const args = object(value ?? {}, 'route_request arguments');
  exactKeys(args, ['prompt', 'context', 'files', 'policy', 'categoryBoosts', 'availableModels', 'currentModelId', 'profile', 'budget', 'planMode', 'apiVersion'], 'route_request arguments');
  const prompt = string(args.prompt, 'prompt', { min: 1, max: 64_000, nonWhitespace: true });
  const policy = enumValue(args.policy, POLICIES, 'policy', 'balanced');
  const profile = enumValue(args.profile, PROFILE_NAMES, 'profile', 'general');
  const planMode = enumValue(args.planMode, PLAN_MODES, 'planMode', 'auto');
  const apiVersion = enumValue(args.apiVersion, API_VERSIONS, 'apiVersion', API_VERSIONS[0]);
  const availableModels = normalizeModelInventory(args.availableModels);
  const currentModelId = args.currentModelId === undefined ? undefined : string(args.currentModelId, 'currentModelId', { min: 1, max: 200, nonWhitespace: true });
  if (currentModelId !== undefined && availableModels === undefined) throw new Error('currentModelId requires availableModels.');
  return {
    request: { prompt, context: parseContext(args.context), files: parseFiles(args.files), preferences: { policy, policyExplicit: args.policy !== undefined, ...(parseBoosts(args.categoryBoosts) ? { categoryBoosts: parseBoosts(args.categoryBoosts) } : {}) } },
    availableModels,
    currentModelId,
    profile,
    budget: parseBudget(args.budget),
    planMode,
    apiVersion,
  };
}

export function normalizeInventoryArguments(value) {
  const args = object(value ?? {}, 'validate_model_inventory arguments');
  exactKeys(args, ['availableModels'], 'validate_model_inventory arguments');
  return { availableModels: normalizeModelInventory(args.availableModels ?? []) };
}

export function normalizeComparisonArguments(value) {
  const args = object(value ?? {}, 'comparison arguments');
  exactKeys(args, ['prompt', 'context', 'files', 'availableModels', 'currentModelId', 'budget', 'planMode', 'variants'], 'comparison arguments');
  if (!Array.isArray(args.variants) || args.variants.length < 2 || args.variants.length > 8) throw new Error('variants must contain between 2 and 8 entries.');
  const base = { prompt: args.prompt, context: args.context, files: args.files, availableModels: args.availableModels, currentModelId: args.currentModelId, budget: args.budget, planMode: args.planMode };
  const labels = new Set();
  const variants = args.variants.map((raw, index) => {
    const variant = object(raw, `variants[${index}]`);
    exactKeys(variant, ['label', 'policy', 'profile'], `variants[${index}]`);
    const label = string(variant.label, `variants[${index}].label`, { min: 1, max: 80, nonWhitespace: true });
    if (labels.has(label)) throw new Error(`variants contains duplicate label: ${label}.`);
    labels.add(label);
    return { label, arguments: { ...base, policy: variant.policy, profile: variant.profile } };
  });
  return variants;
}

export function normalizeEvaluationArguments(value) {
  const args = object(value ?? {}, 'evaluate_router arguments');
  exactKeys(args, ['cases'], 'evaluate_router arguments');
  if (!Array.isArray(args.cases) || args.cases.length < 1 || args.cases.length > 100) throw new Error('cases must contain between 1 and 100 entries.');
  return args.cases.map((raw, index) => {
    const item = object(raw, `cases[${index}]`);
    exactKeys(item, ['id', 'prompt', 'context', 'files', 'policy', 'profile', 'expectedTier', 'requiredCapabilities'], `cases[${index}]`);
    const requiredCapabilities = item.requiredCapabilities ?? [];
    if (!Array.isArray(requiredCapabilities) || requiredCapabilities.length > CAPABILITIES.length || requiredCapabilities.some((capability) => !CAPABILITIES.includes(capability)) || new Set(requiredCapabilities).size !== requiredCapabilities.length) throw new Error(`cases[${index}].requiredCapabilities is invalid.`);
    const normalized = normalizeRouteArguments({ prompt: item.prompt, context: item.context, files: item.files, policy: item.policy, profile: item.profile, planMode: 'single' });
    return { id: item.id === undefined ? String(index + 1) : string(item.id, `cases[${index}].id`, { min: 1, max: 100, nonWhitespace: true }), ...normalized, expectedTier: enumValue(item.expectedTier, TIERS, `cases[${index}].expectedTier`), requiredCapabilities };
  });
}

const capabilitySchema = { type: 'object', additionalProperties: false, properties: Object.fromEntries(CAPABILITIES.map((key) => [key, { type: 'boolean' }])) };
const contextSchema = { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['role', 'text'], properties: { role: { type: 'string', enum: ROLES }, text: { type: 'string', minLength: 1, maxLength: 12_000, pattern: '.*\\S.*' } } };
const fileSchema = { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 512, pattern: '.*\\S.*' }, size: { type: 'integer', minimum: 0, maximum: 1_000_000_000 }, detectedType: { type: 'string', enum: FILE_TYPES }, mediaType: { type: 'string', minLength: 1, maxLength: 200 }, textLength: { type: 'integer', minimum: 0, maximum: 1_000_000 }, excerpt: { type: 'string', maxLength: 4_000 }, warnings: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 500 } }, capabilities: { type: 'object', additionalProperties: false, properties: { vision: { type: 'boolean' }, longContext: { type: 'boolean' } } } } };
export const MODEL_INPUT_SCHEMA = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 200, pattern: '.*\\S.*' }, title: { type: 'string', maxLength: 200 }, family: { type: 'string', maxLength: 100 }, tier: { type: 'string', enum: TIERS }, effortLevels: { type: 'array', maxItems: 4, uniqueItems: true, items: { type: 'string', enum: EFFORTS } }, capabilities: capabilitySchema, relativeCost: { type: 'number', minimum: 0, maximum: 1 }, relativeLatency: { type: 'number', minimum: 0, maximum: 1 }, available: { type: 'boolean' } } };
const budgetSchema = { type: 'object', additionalProperties: false, properties: { maxRelativeCost: { type: 'number', minimum: 0, maximum: 1 }, maxRelativeLatency: { type: 'number', minimum: 0, maximum: 1 }, minQuality: { type: 'number', minimum: 0, maximum: 1 }, maxStages: { type: 'integer', minimum: 1, maximum: 4 } } };
const routeProperties = { prompt: { type: 'string', minLength: 1, maxLength: 64_000, pattern: '.*\\S.*' }, context: contextSchema, files: { type: 'array', maxItems: 20, items: fileSchema }, policy: { type: 'string', enum: POLICIES }, categoryBoosts: { type: 'object', maxProperties: 64, additionalProperties: { type: 'number', minimum: -0.35, maximum: 0.35 } }, availableModels: { type: 'array', maxItems: 64, items: MODEL_INPUT_SCHEMA }, currentModelId: { type: 'string', minLength: 1, maxLength: 200 }, profile: { type: 'string', enum: PROFILE_NAMES }, budget: budgetSchema, planMode: { type: 'string', enum: PLAN_MODES }, apiVersion: { type: 'string', enum: API_VERSIONS } };

export const ROUTE_INPUT_SCHEMA = { $schema: JSON_SCHEMA, type: 'object', additionalProperties: false, required: ['prompt'], properties: routeProperties };
export const ROUTE_OUTPUT_SCHEMA = { $schema: JSON_SCHEMA, type: 'object', additionalProperties: true, required: ['apiVersion', 'tier', 'effort', 'capabilities', 'confidence', 'reasons', 'scores', 'taskCategories', 'modelResolution', 'confidenceEvidence', 'executionPlan', 'budgetAssessment'], properties: { apiVersion: { type: 'string' }, tier: { type: 'string', enum: TIERS }, effort: { type: 'string', enum: EFFORTS }, capabilities: capabilitySchema, confidence: { type: 'number', minimum: 0, maximum: 1 }, confidenceEvidence: { type: 'object' }, executionPlan: { type: 'object' }, budgetAssessment: { type: 'object' }, modelResolution: { type: 'object' } } };
export const INVENTORY_INPUT_SCHEMA = { $schema: JSON_SCHEMA, type: 'object', additionalProperties: false, required: ['availableModels'], properties: { availableModels: { type: 'array', maxItems: 64, items: MODEL_INPUT_SCHEMA } } };
export const COMPARISON_INPUT_SCHEMA = { $schema: JSON_SCHEMA, type: 'object', additionalProperties: false, required: ['prompt', 'variants'], properties: { prompt: routeProperties.prompt, context: contextSchema, files: routeProperties.files, availableModels: routeProperties.availableModels, currentModelId: routeProperties.currentModelId, budget: budgetSchema, planMode: routeProperties.planMode, variants: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['label'], properties: { label: { type: 'string', minLength: 1, maxLength: 80 }, policy: { type: 'string', enum: POLICIES }, profile: { type: 'string', enum: PROFILE_NAMES } } } } } };
export const EVALUATION_INPUT_SCHEMA = { $schema: JSON_SCHEMA, type: 'object', additionalProperties: false, required: ['cases'], properties: { cases: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['prompt', 'expectedTier'], properties: { id: { type: 'string', maxLength: 100 }, prompt: routeProperties.prompt, context: contextSchema, files: routeProperties.files, policy: routeProperties.policy, profile: routeProperties.profile, expectedTier: { type: 'string', enum: TIERS }, requiredCapabilities: { type: 'array', maxItems: 5, uniqueItems: true, items: { type: 'string', enum: CAPABILITIES } } } } } } };
