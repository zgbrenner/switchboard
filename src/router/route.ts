import type {
  CapabilitySet,
  EffortLevel,
  QualityTier,
  RoutingDecision,
  RoutingRequest,
} from '../shared/types.js';
import { policyBias, tierAtLeast, TIER_ORDER } from './policies.js';
import { semanticRouteScores } from './semantic.js';
import { extractSignals } from './signals.js';

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function softmax(raw: Record<QualityTier, number>): Record<QualityTier, number> {
  const max = Math.max(...Object.values(raw));
  const exp = TIER_ORDER.map((tier) => Math.exp(raw[tier] - max));
  const total = exp.reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(TIER_ORDER.map((tier, index) => [tier, (exp[index] ?? 0) / total])) as Record<QualityTier, number>;
}

function deterministicTier(score: number): QualityTier {
  if (score <= -0.35) return 'fast';
  if (score < 2.1) return 'balanced';
  if (score < 5.5) return 'deep';
  return 'max';
}

function effortFor(tier: QualityTier): EffortLevel {
  return ({ fast: 'low', balanced: 'medium', deep: 'high', max: 'max' } as const)[tier];
}

function mergeCapabilities(target: CapabilitySet, source: Partial<CapabilitySet>): void {
  for (const key of Object.keys(target) as (keyof CapabilitySet)[]) {
    if (source[key]) target[key] = true;
  }
}

export function routeRequest(request: RoutingRequest): RoutingDecision {
  const contextText = request.context.slice(-4).map((turn) => `${turn.role}: ${turn.text}`).join('\n');
  const promptSignals = extractSignals(request.prompt);
  const contextualSignals = promptSignals.vagueFollowUp && contextText ? extractSignals(contextText) : undefined;

  let score = promptSignals.score;
  const reasons = [...promptSignals.reasons];
  const categories = new Set(promptSignals.categories);
  const capabilities: CapabilitySet = { ...promptSignals.capabilities };
  let floor: QualityTier = 'fast';

  if (contextualSignals) {
    score += contextualSignals.score * 0.85;
    reasons.push({ code: 'context-dependent', detail: 'The latest prompt depends on recent conversation context.', weight: contextualSignals.score * 0.85 });
    contextualSignals.categories.forEach((category) => categories.add(category));
    mergeCapabilities(capabilities, contextualSignals.capabilities);
    if (contextualSignals.categories.some((category) => ['high-stakes', 'comparison', 'reasoning', 'code'].includes(category))) {
      floor = 'deep';
      reasons.push({ code: 'context-complexity-floor', detail: 'The referenced prior task requires deep reasoning even though the follow-up is short.', weight: 1.4 });
    }
  }

  if (capabilities.vision) {
    floor = tierAtLeast(floor, 'balanced');
    score += 0.6;
    reasons.push({ code: 'vision-floor', detail: 'Visual interpretation requires a vision-capable model and at least balanced reasoning.', weight: 0.6 });
  }

  if (categories.has('code') && (categories.has('planning') || categories.has('high-stakes'))) {
    floor = tierAtLeast(floor, 'deep');
    reasons.push({ code: 'complex-code-floor', detail: 'Code combined with architecture or high-stakes review requires deep reasoning.', weight: 1.2 });
  }

  if (request.files.length > 0) {
    capabilities.files = true;
    floor = 'balanced';
    reasons.push({ code: 'attachments', detail: `${request.files.length} attached file(s) require a file-capable model.`, weight: 0.9 });
    score += 0.9;
    categories.add('files');
    const totalText = request.files.reduce((sum, file) => sum + file.textLength, 0);
    if (totalText > 24000 || request.files.some((file) => file.capabilities.longContext)) {
      capabilities.longContext = true;
      floor = 'deep';
      score += 1.1;
      reasons.push({ code: 'large-attachments', detail: 'The extracted file content requires stronger long-context handling.', weight: 1.1 });
    }
    if (request.files.some((file) => file.capabilities.vision)) {
      capabilities.vision = true;
      floor = tierAtLeast(floor, 'deep');
      score += 1.2;
      reasons.push({ code: 'visual-attachment', detail: 'At least one attachment needs visual interpretation.', weight: 1.2 });
    }
  }

  const boosts = request.preferences.categoryBoosts ?? {};
  for (const category of categories) {
    const boost = boosts[category] ?? 0;
    if (boost !== 0) {
      score += boost;
      reasons.push({ code: 'local-preference', detail: `A local preference adjusted ${category} routing.`, weight: boost });
    }
  }

  const deterministic = tierAtLeast(deterministicTier(score), floor);
  const semanticText = [request.prompt, contextText, ...request.files.map((file) => file.excerpt)].filter(Boolean).join('\n');
  const semantic = semanticRouteScores(semanticText);
  const bias = policyBias(request.preferences.policy);
  const raw = {} as Record<QualityTier, number>;

  for (const tier of TIER_ORDER) {
    const distance = Math.abs(TIER_ORDER.indexOf(tier) - TIER_ORDER.indexOf(deterministic));
    const deterministicAffinity = 1.5 - distance * 0.9;
    raw[tier] = deterministicAffinity * 0.72 + semantic[tier] * 1.15 + bias[tier];
    if (TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(floor)) raw[tier] -= 8;
  }

  const probabilities = softmax(raw);
  const ranked = TIER_ORDER
    .map((tier) => ({ tier, score: probabilities[tier] }))
    .sort((left, right) => right.score - left.score);
  const selected = ranked[0]?.tier ?? deterministic;
  const top = ranked[0]?.score ?? 0;
  const second = ranked[1]?.score ?? 0;
  const margin = top - second;
  const explicitMax = reasons.some((reason) => reason.code === 'explicit-research') && score >= 4.5;
  const finalTier = explicitMax ? 'max' : tierAtLeast(selected, floor);
  const shouldUseJudge = promptSignals.vagueFollowUp || promptSignals.conflictingSignals || margin < 0.18;
  const confidence = clamp(explicitMax ? 0.94 : 0.58 + margin * 1.5 + Math.min(Math.abs(score), 4) * 0.045);

  return {
    tier: finalTier,
    effort: effortFor(finalTier),
    capabilities,
    confidence,
    shouldUseJudge,
    reasons: reasons.sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight)),
    scores: probabilities,
    taskCategories: [...categories],
  };
}
