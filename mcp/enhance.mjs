const TIERS = ['fast', 'balanced', 'deep', 'max'];
const EFFORTS = ['low', 'medium', 'high', 'max'];
const API_VERSION = '2026-07-24';

function index(order, value) {
  const found = order.indexOf(value);
  return found < 0 ? 0 : found;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function tierAtLeast(left, right) {
  return index(TIERS, left) >= index(TIERS, right);
}

function maxTier(left, right) {
  return tierAtLeast(left, right) ? left : right;
}

function minTier(left, right) {
  return tierAtLeast(left, right) ? right : left;
}

export function normalizeBudget(raw = {}) {
  return {
    maxRelativeCost: raw.maxRelativeCost ?? 1,
    maxRelativeLatency: raw.maxRelativeLatency ?? 1,
    minQuality: raw.minQuality ?? 0,
    maxStages: raw.maxStages ?? 3,
  };
}

export function applyProfileFloor(decision, profile) {
  const capabilities = { ...decision.capabilities };
  for (const [key, required] of Object.entries(profile.requiredCapabilities ?? {})) {
    if (required) capabilities[key] = true;
  }
  const tier = maxTier(decision.tier, profile.minimumTier ?? 'fast');
  const effortFloor = tier === 'max' ? 'max' : tier === 'deep' ? 'high' : tier === 'balanced' ? 'medium' : 'low';
  const effort = index(EFFORTS, decision.effort) >= index(EFFORTS, effortFloor) ? decision.effort : effortFloor;
  return { ...decision, tier, effort, capabilities };
}

export function confidenceEvidence(decision) {
  const ordered = Object.entries(decision.scores ?? {}).sort((left, right) => right[1] - left[1]);
  const winner = ordered[0]?.[1] ?? decision.confidence ?? 0;
  const runnerUp = ordered[1]?.[1] ?? 0;
  const scoreMargin = clamp(winner - runnerUp);
  const reasonWeight = (decision.reasons ?? []).reduce((total, reason) => total + Math.abs(Number(reason.weight) || 0), 0);
  const deterministic = clamp(reasonWeight / 3);
  const required = Object.values(decision.capabilities ?? {}).filter(Boolean).length;
  const capabilityCertainty = required === 0 ? 1 : clamp(0.7 + required * 0.06);
  const agreement = clamp((scoreMargin * 0.55) + (deterministic * 0.25) + (capabilityCertainty * 0.2));
  return {
    overall: round(decision.confidence ?? agreement),
    scoreMargin: round(scoreMargin),
    deterministicEvidence: round(deterministic),
    capabilityCertainty: round(capabilityCertainty),
    agreement: round(agreement),
  };
}

function stage(id, purpose, tier, effort, capabilities, optional = false) {
  return { id, purpose, tier, effort, capabilities: { ...capabilities }, optional };
}

export function buildExecutionPlan(decision, { mode = 'auto', maxStages = 3 } = {}) {
  const categories = new Set(decision.taskCategories ?? []);
  const complex = ['deep', 'max'].includes(decision.tier);
  const verificationHeavy = categories.has('research') || categories.has('legal') || categories.has('security') || categories.has('high-stakes');
  if (mode === 'single' || maxStages === 1 || (!complex && mode !== 'multi')) {
    return { mode: 'single', stages: [stage('answer', 'Complete the request', decision.tier, decision.effort, decision.capabilities)] };
  }

  const stages = [];
  const draftTier = minTier(decision.tier, 'balanced');
  const draftEffort = index(EFFORTS, decision.effort) > index(EFFORTS, 'medium') ? 'medium' : decision.effort;
  stages.push(stage('analyze', 'Analyze the request and produce a working answer', draftTier, draftEffort, decision.capabilities));

  if (stages.length < maxStages) {
    stages.push(stage('refine', 'Refine the answer for completeness and correctness', decision.tier, decision.effort, decision.capabilities));
  }

  if (stages.length < maxStages && (verificationHeavy || decision.shouldUseJudge || mode === 'multi')) {
    stages.push(stage('verify', 'Independently verify high-risk claims and requirements', maxTier(decision.tier, 'deep'), 'high', decision.capabilities, !verificationHeavy));
  }

  return { mode: stages.length > 1 ? 'multi' : 'single', stages };
}

export function assessBudget(decision, modelResolution, budget) {
  const recommendation = modelResolution?.recommended;
  const estimatedCost = recommendation?.relativeCost ?? ({ fast: 0.1, balanced: 0.35, deep: 0.65, max: 1 })[decision.tier];
  const estimatedLatency = recommendation?.relativeLatency ?? ({ fast: 0.1, balanced: 0.35, deep: 0.65, max: 1 })[decision.tier];
  const quality = ({ fast: 0.35, balanced: 0.6, deep: 0.82, max: 1 })[decision.tier];
  const violations = [];
  if (estimatedCost > budget.maxRelativeCost) violations.push('cost');
  if (estimatedLatency > budget.maxRelativeLatency) violations.push('latency');
  if (quality < budget.minQuality) violations.push('quality');
  return {
    fits: violations.length === 0,
    violations,
    estimatedRelativeCost: round(estimatedCost),
    estimatedRelativeLatency: round(estimatedLatency),
    estimatedQuality: round(quality),
    constraints: { ...budget },
  };
}

export function enhanceDecision(decision, options) {
  const profiled = applyProfileFloor(decision, options.profile);
  const budget = normalizeBudget(options.budget);
  const executionPlan = buildExecutionPlan(profiled, { mode: options.planMode, maxStages: budget.maxStages });
  const budgetAssessment = assessBudget(profiled, options.modelResolution, budget);
  return {
    ...profiled,
    apiVersion: API_VERSION,
    compatibility: { additiveFrom: '0.4.0', responseContract: API_VERSION },
    effectiveProfile: options.profile.name,
    effectivePolicy: options.policy,
    confidenceEvidence: confidenceEvidence(profiled),
    executionPlan,
    budgetAssessment,
    modelResolution: options.modelResolution,
  };
}

export const SWITCHBOARD_API_VERSION = API_VERSION;
