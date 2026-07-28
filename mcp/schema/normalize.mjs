import { PROFILE_NAMES } from '../profiles.mjs';
import { API_VERSIONS, CAPABILITIES, PLAN_MODES, POLICIES, TIERS } from './constants.mjs';
import {
  enumValue,
  exactKeys,
  normalizeModelInventory,
  object,
  optionalBoolean,
  parseBoosts,
  parseBudget,
  parseContext,
  parseFiles,
  stringValue,
} from './validators.mjs';

export function normalizeRouteArguments(value) {
  const args = object(value ?? {}, 'route_request arguments');
  exactKeys(
    args,
    [
      'prompt',
      'context',
      'files',
      'policy',
      'categoryBoosts',
      'availableModels',
      'currentModelId',
      'profile',
      'budget',
      'planMode',
      'apiVersion',
    ],
    'route_request arguments',
  );
  const prompt = stringValue(args.prompt, 'prompt', { min: 1, max: 64_000, nonWhitespace: true });
  const policy = enumValue(args.policy, POLICIES, 'policy', 'balanced');
  const profile = enumValue(args.profile, PROFILE_NAMES, 'profile', 'general');
  const planMode = enumValue(args.planMode, PLAN_MODES, 'planMode', 'auto');
  const apiVersion = enumValue(args.apiVersion, API_VERSIONS, 'apiVersion', API_VERSIONS[0]);
  const availableModels = normalizeModelInventory(args.availableModels);
  const currentModelId =
    args.currentModelId === undefined
      ? undefined
      : stringValue(args.currentModelId, 'currentModelId', { min: 1, max: 200, nonWhitespace: true });
  if (currentModelId !== undefined && availableModels === undefined) throw new Error('currentModelId requires availableModels.');
  const categoryBoosts = parseBoosts(args.categoryBoosts);
  return {
    request: {
      prompt,
      context: parseContext(args.context),
      files: parseFiles(args.files),
      preferences: { policy, policyExplicit: args.policy !== undefined, ...(categoryBoosts ? { categoryBoosts } : {}) },
    },
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
  exactKeys(
    args,
    ['prompt', 'context', 'files', 'availableModels', 'currentModelId', 'budget', 'planMode', 'variants'],
    'comparison arguments',
  );
  if (!Array.isArray(args.variants) || args.variants.length < 2 || args.variants.length > 8)
    throw new Error('variants must contain between 2 and 8 entries.');
  const base = {
    prompt: args.prompt,
    context: args.context,
    files: args.files,
    availableModels: args.availableModels,
    currentModelId: args.currentModelId,
    budget: args.budget,
    planMode: args.planMode,
  };
  const labels = new Set();
  return args.variants.map((raw, index) => {
    const variant = object(raw, `variants[${index}]`);
    exactKeys(variant, ['label', 'policy', 'profile'], `variants[${index}]`);
    const label = stringValue(variant.label, `variants[${index}].label`, { min: 1, max: 80, nonWhitespace: true });
    if (labels.has(label)) throw new Error(`variants contains duplicate label: ${label}.`);
    labels.add(label);
    return { label, arguments: { ...base, policy: variant.policy, profile: variant.profile } };
  });
}

export function normalizeEvaluationArguments(value) {
  const args = object(value ?? {}, 'evaluate_router arguments');
  exactKeys(args, ['cases', 'includePreferences'], 'evaluate_router arguments');
  if (!Array.isArray(args.cases) || args.cases.length < 1 || args.cases.length > 100)
    throw new Error('cases must contain between 1 and 100 entries.');
  const cases = args.cases.map((raw, index) => {
    const item = object(raw, `cases[${index}]`);
    exactKeys(item, ['id', 'prompt', 'context', 'files', 'policy', 'profile', 'expectedTier', 'requiredCapabilities'], `cases[${index}]`);
    const requiredCapabilities = item.requiredCapabilities ?? [];
    if (
      !Array.isArray(requiredCapabilities) ||
      requiredCapabilities.length > CAPABILITIES.length ||
      requiredCapabilities.some((capability) => !CAPABILITIES.includes(capability)) ||
      new Set(requiredCapabilities).size !== requiredCapabilities.length
    ) {
      throw new Error(`cases[${index}].requiredCapabilities is invalid.`);
    }
    const normalized = normalizeRouteArguments({
      prompt: item.prompt,
      context: item.context,
      files: item.files,
      policy: item.policy,
      profile: item.profile,
      planMode: 'single',
    });
    return {
      id: item.id === undefined ? String(index + 1) : stringValue(item.id, `cases[${index}].id`, { min: 1, max: 100, nonWhitespace: true }),
      ...normalized,
      expectedTier: enumValue(item.expectedTier, TIERS, `cases[${index}].expectedTier`),
      requiredCapabilities,
    };
  });
  return { cases, includePreferences: optionalBoolean(args.includePreferences, 'includePreferences', false) };
}
