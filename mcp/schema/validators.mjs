import { CAPABILITIES, EFFORTS, FILE_TYPES, ROLES, TIERS } from './constants.mjs';

export function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

export function exactKeys(value, allowed, label) {
  const accepted = new Set(allowed);
  for (const key of Object.keys(value)) if (!accepted.has(key)) throw new Error(`${label} contains an unsupported property: ${key}.`);
}

export function stringValue(value, label, { min = 0, max = 64_000, nonWhitespace = false } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max || (nonWhitespace && !value.trim())) {
    throw new Error(`${label} must be a string between ${min} and ${max} characters${nonWhitespace ? ' and contain a non-whitespace character' : ''}.`);
  }
  return value;
}

export function integer(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  return value;
}

export function numberValue(value, label, { min = 0, max = 1 } = {}) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be a number between ${min} and ${max}.`);
  return value;
}

export function optionalBoolean(value, label, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`);
  return value;
}

export function enumValue(value, values, label, fallback) {
  if (value === undefined) return fallback;
  if (!values.includes(value)) throw new Error(`${label} must be one of ${values.join(', ')}.`);
  return value;
}

export function parseContext(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error('context must be an array with at most 8 turns.');
  let total = 0;
  return value.map((raw, index) => {
    const turn = object(raw, `context[${index}]`);
    exactKeys(turn, ['role', 'text'], `context[${index}]`);
    const role = enumValue(turn.role, ROLES, `context[${index}].role`);
    const text = stringValue(turn.text, `context[${index}].text`, { min: 1, max: 12_000, nonWhitespace: true });
    total += text.length;
    if (total > 32_000) throw new Error('context text exceeds the 32000-character limit.');
    return { role, text };
  });
}

function defaultMediaType(type) {
  return ({
    text: 'text/plain', markdown: 'text/markdown', html: 'text/html', json: 'application/json', csv: 'text/csv',
    pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip',
    image: 'application/octet-stream', unknown: 'application/octet-stream',
  })[type];
}

export function parseFiles(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error('files must be an array with at most 20 entries.');
  return value.map((raw, index) => {
    const label = `files[${index}]`;
    const file = object(raw, label);
    exactKeys(file, ['name', 'size', 'detectedType', 'mediaType', 'textLength', 'excerpt', 'warnings', 'capabilities'], label);
    const name = stringValue(file.name, `${label}.name`, { min: 1, max: 512, nonWhitespace: true });
    const detectedType = enumValue(file.detectedType, FILE_TYPES, `${label}.detectedType`, 'unknown');
    const size = file.size === undefined ? 0 : integer(file.size, `${label}.size`, { max: 1_000_000_000 });
    const textLength = file.textLength === undefined ? 0 : integer(file.textLength, `${label}.textLength`, { max: 1_000_000 });
    const excerpt = file.excerpt === undefined ? '' : stringValue(file.excerpt, `${label}.excerpt`, { max: 4_000 });
    const mediaType = file.mediaType === undefined
      ? defaultMediaType(detectedType)
      : stringValue(file.mediaType, `${label}.mediaType`, { min: 1, max: 200, nonWhitespace: true });
    const caps = file.capabilities === undefined ? {} : object(file.capabilities, `${label}.capabilities`);
    exactKeys(caps, ['vision', 'longContext'], `${label}.capabilities`);
    const warnings = file.warnings === undefined ? [] : file.warnings;
    if (!Array.isArray(warnings) || warnings.length > 20 || warnings.some((warning) => typeof warning !== 'string' || warning.length > 500)) {
      throw new Error(`${label}.warnings must contain at most 20 short strings.`);
    }
    return {
      name, size, detectedType, mediaType, textLength, excerpt, warnings,
      capabilities: {
        files: true,
        vision: optionalBoolean(caps.vision, `${label}.capabilities.vision`, detectedType === 'image'),
        longContext: optionalBoolean(caps.longContext, `${label}.capabilities.longContext`, textLength > 24_000 || size > 8_000_000),
      },
    };
  });
}

export function parseBoosts(value) {
  if (value === undefined) return undefined;
  const raw = object(value, 'categoryBoosts');
  const entries = Object.entries(raw);
  if (entries.length > 64) throw new Error('categoryBoosts may contain at most 64 entries.');
  const output = {};
  for (const [key, boost] of entries) {
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/u.test(key)) throw new Error(`categoryBoosts contains an invalid key: ${key}.`);
    output[key] = numberValue(boost, `categoryBoosts.${key}`, { min: -0.35, max: 0.35 });
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
    const id = stringValue(model.id, `${prefix}.id`, { min: 1, max: 200, nonWhitespace: true });
    if (identifiers.has(id)) throw new Error(`${label} contains duplicate id: ${id}.`);
    identifiers.add(id);
    const tier = enumValue(model.tier, TIERS, `${prefix}.tier`, 'balanced');
    const effortLevels = model.effortLevels === undefined ? [] : model.effortLevels;
    if (!Array.isArray(effortLevels) || effortLevels.length > 4 || effortLevels.some((effort) => !EFFORTS.includes(effort)) || new Set(effortLevels).size !== effortLevels.length) {
      throw new Error(`${prefix}.effortLevels is invalid or contains duplicates.`);
    }
    return {
      id,
      ...(model.title === undefined ? {} : { title: stringValue(model.title, `${prefix}.title`, { min: 1, max: 200, nonWhitespace: true }) }),
      ...(model.family === undefined ? {} : { family: stringValue(model.family, `${prefix}.family`, { min: 1, max: 100, nonWhitespace: true }) }),
      tier,
      effortLevels,
      capabilities: parseCapabilityMap(model.capabilities, `${prefix}.capabilities`),
      relativeCost: model.relativeCost === undefined ? 0.5 : numberValue(model.relativeCost, `${prefix}.relativeCost`),
      relativeLatency: model.relativeLatency === undefined ? 0.5 : numberValue(model.relativeLatency, `${prefix}.relativeLatency`),
      available: optionalBoolean(model.available, `${prefix}.available`, true),
    };
  });
}

export function parseBudget(value) {
  if (value === undefined) return undefined;
  const budget = object(value, 'budget');
  exactKeys(budget, ['maxRelativeCost', 'maxRelativeLatency', 'minQuality', 'maxStages'], 'budget');
  return {
    ...(budget.maxRelativeCost === undefined ? {} : { maxRelativeCost: numberValue(budget.maxRelativeCost, 'budget.maxRelativeCost') }),
    ...(budget.maxRelativeLatency === undefined ? {} : { maxRelativeLatency: numberValue(budget.maxRelativeLatency, 'budget.maxRelativeLatency') }),
    ...(budget.minQuality === undefined ? {} : { minQuality: numberValue(budget.minQuality, 'budget.minQuality') }),
    ...(budget.maxStages === undefined ? {} : { maxStages: integer(budget.maxStages, 'budget.maxStages', { min: 1, max: 4 }) }),
  };
}
