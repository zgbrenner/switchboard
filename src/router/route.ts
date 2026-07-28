import type {
  CapabilitySet,
  EffortLevel,
  QualityTier,
  RoutingDecision,
  RoutingPolicy,
  RoutingReason,
  RoutingRequest,
} from '../shared/types.js';
import { policyBias, TIER_ORDER, tierAtLeast } from './policies.js';
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

/**
 * Score thresholds separating the four tiers.
 *
 * These are calibrated against benchmarks/router-cases.jsonl; `npm run benchmark` fails if a change
 * here regresses the labelled corpus, and `npm run benchmark:oracle` reports the effect against
 * measured per-model outcomes. They are not arbitrary, but they are also not learned — see the
 * Limitations section of the README.
 */
const TIER_THRESHOLDS = Object.freeze({ fast: -0.35, balanced: 2.1, deep: 5.5 });

function deterministicTier(score: number): QualityTier {
  if (score <= TIER_THRESHOLDS.fast) return 'fast';
  if (score < TIER_THRESHOLDS.balanced) return 'balanced';
  if (score < TIER_THRESHOLDS.deep) return 'deep';
  return 'max';
}

/**
 * Additive score shift applied by the caller's cost/quality policy.
 *
 * Sized against the tier thresholds above so that a policy can move a borderline request one tier in
 * either direction, which is the entire point of exposing the control. Floors are applied *after*
 * this shift, so no policy can route beneath a safety floor no matter how aggressive it is.
 */
const POLICY_SCORE_SHIFT: Readonly<Record<RoutingPolicy, number>> = Object.freeze({
  best: 1.6,
  balanced: 0,
  fast: -1.6,
  conserve: -2.4,
});

function effortFor(tier: QualityTier): EffortLevel {
  return ({ fast: 'low', balanced: 'medium', deep: 'high', max: 'max' } as const)[tier];
}

/**
 * Total absolute weight of the signals that actually fired. 'short-request' is excluded because it
 * records the *absence* of evidence, and counting it would let an empty prompt look well-evidenced.
 */
function strengthOf(signals: { reasons: RoutingReason[] }): number {
  let total = 0;
  for (const reason of signals.reasons) {
    if (reason.code !== 'short-request') total += Math.abs(reason.weight);
  }
  return total;
}

function mergeCapabilities(target: CapabilitySet, source: Partial<CapabilitySet>): void {
  for (const key of Object.keys(target) as (keyof CapabilitySet)[]) {
    if (source[key]) target[key] = true;
  }
}

export function routeRequest(request: RoutingRequest): RoutingDecision {
  const contextText = request.context
    .slice(-4)
    .map((turn) => `${turn.role}: ${turn.text}`)
    .join('\n');
  const promptSignals = extractSignals(request.prompt);
  const contextualSignals = promptSignals.vagueFollowUp && contextText ? extractSignals(contextText) : undefined;

  let score = promptSignals.score;
  const reasons = [...promptSignals.reasons];
  const categories = new Set(promptSignals.categories);
  const capabilities: CapabilitySet = { ...promptSignals.capabilities };
  let floor: QualityTier = 'fast';

  if (promptSignals.unreadableScript) {
    // The keyword signals are English-only. Defaulting an unanalysable prompt to the cheapest tier
    // would silently under-serve every non-English user, so hold a mid floor and ask for a judge.
    floor = tierAtLeast(floor, 'balanced');
  }

  if (contextualSignals) {
    score += contextualSignals.score * 0.85;
    reasons.push({
      code: 'context-dependent',
      detail: 'The latest prompt depends on recent conversation context.',
      weight: contextualSignals.score * 0.85,
    });
    for (const category of contextualSignals.categories) categories.add(category);
    mergeCapabilities(capabilities, contextualSignals.capabilities);
    if (contextualSignals.categories.some((category) => ['high-stakes', 'comparison', 'reasoning', 'code'].includes(category))) {
      floor = 'deep';
      reasons.push({
        code: 'context-complexity-floor',
        detail: 'The referenced prior task requires deep reasoning even though the follow-up is short.',
        weight: 1.4,
      });
    }
  }

  if (capabilities.vision) {
    floor = tierAtLeast(floor, 'balanced');
    score += 0.6;
    reasons.push({
      code: 'vision-floor',
      detail: 'Visual interpretation requires a vision-capable model and at least balanced reasoning.',
      weight: 0.6,
    });
  }

  if (categories.has('code') && (categories.has('planning') || categories.has('high-stakes'))) {
    floor = tierAtLeast(floor, 'deep');
    reasons.push({
      code: 'complex-code-floor',
      detail: 'Code combined with architecture or high-stakes review requires deep reasoning.',
      weight: 1.2,
    });
  }

  if (request.files.length > 0) {
    capabilities.files = true;
    // tierAtLeast, not assignment: an attachment must never lower a floor established by the prompt.
    floor = tierAtLeast(floor, 'balanced');
    categories.add('files');
    const totalText = request.files.reduce((sum, file) => sum + file.textLength, 0);
    // An attachment always requires a file-capable model, but a 100-byte note is not evidence of a
    // harder reasoning task. Scale the difficulty contribution with the content actually attached
    // instead of charging a flat premium that can push an already-deep request to the top tier.
    const attachmentWeight = Math.min(0.9, 0.15 + totalText / 20000);
    reasons.push({
      code: 'attachments',
      detail: `${request.files.length} attached file(s) require a file-capable model.`,
      weight: attachmentWeight,
    });
    score += attachmentWeight;
    if (totalText > 24000 || request.files.some((file) => file.capabilities.longContext)) {
      capabilities.longContext = true;
      floor = tierAtLeast(floor, 'deep');
      score += 1.1;
      reasons.push({
        code: 'large-attachments',
        detail: 'The extracted file content requires stronger long-context handling.',
        weight: 1.1,
      });
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

  // The caller's policy shifts the score before thresholding, so it can genuinely move a borderline
  // request between tiers. Floors are applied after, and therefore always win.
  const policyShift = POLICY_SCORE_SHIFT[request.preferences.policy] ?? 0;
  if (policyShift !== 0) {
    score += policyShift;
    reasons.push({
      code: 'policy-adjustment',
      detail: `The ${request.preferences.policy} policy shifted the routing score by ${policyShift > 0 ? '+' : ''}${policyShift}.`,
      weight: policyShift,
    });
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

  // `scores` is a reported distribution over tiers used for margin and explanation. The decision
  // itself is the deterministic ladder above, clamped by the floor -- not this distribution's argmax.
  // Keeping the two separate is what makes a routing decision explainable after the fact.
  const probabilities = softmax(raw);
  const ranked = TIER_ORDER.map((tier) => ({ tier, score: probabilities[tier] })).sort((left, right) => right.score - left.score);
  const margin = (ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0);
  const explicitMax = reasons.some((reason) => reason.code === 'explicit-research') && score >= 4.5;
  const finalTier = explicitMax ? tierAtLeast('max', floor) : deterministic;
  const shouldUseJudge =
    promptSignals.vagueFollowUp || promptSignals.conflictingSignals || promptSignals.unreadableScript || margin < 0.18;

  // Confidence reflects how much evidence the decision actually rests on, measured as the total
  // absolute weight of the signals that fired -- not how many fired, since one unambiguous signal
  // ("make this friendlier") is stronger evidence than three weak ones. The curve saturates, so
  // piling on more signals cannot manufacture certainty. A prompt that matched nothing must not
  // report high confidence merely because the tier ladder has a default.
  //
  // This is an evidence score, NOT a calibrated probability. See the README's Limitations section.
  const evidenceStrength = strengthOf(promptSignals) + (contextualSignals ? strengthOf(contextualSignals) : 0);
  const confidence =
    evidenceStrength === 0
      ? 0.25
      : clamp(
          0.3 + 0.6 * (1 - Math.exp(-evidenceStrength / 1.8)) + margin * 0.07 - (promptSignals.unreadableScript ? 0.22 : 0),
          0.05,
          0.97,
        );

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
