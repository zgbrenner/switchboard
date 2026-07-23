import type { QualityTier, RoutingDecision } from '../shared/types.js';
import { TIER_ORDER, tierAtLeast } from '../router/policies.js';

export interface LocalScoreInputs {
  scout: Readonly<Record<QualityTier, number>>;
  arbiter?: Readonly<Partial<Record<QualityTier, number>>>;
  judgedTier?: QualityTier;
}

export interface FusedLocalDecision {
  tier: QualityTier;
  scores: Record<QualityTier, number>;
  confidence: number;
  margin: number;
}

function normalizeScores(values: Readonly<Record<QualityTier, number>>): Record<QualityTier, number> {
  const raw = TIER_ORDER.map((tier) => values[tier]);
  const max = Math.max(...raw);
  const exponentials = raw.map((value) => Math.exp(value - max));
  const total = exponentials.reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(TIER_ORDER.map((tier, index) => [tier, (exponentials[index] ?? 0) / total])) as Record<QualityTier, number>;
}

function capabilityFloor(decision: RoutingDecision): QualityTier {
  let floor: QualityTier = 'fast';
  if (decision.capabilities.files) floor = 'balanced';
  if (decision.capabilities.vision || decision.capabilities.longContext || decision.capabilities.web) floor = 'deep';
  return floor;
}

function boundedDowngrade(candidate: QualityTier, baseline: QualityTier): QualityTier {
  const candidateIndex = TIER_ORDER.indexOf(candidate);
  const baselineIndex = TIER_ORDER.indexOf(baseline);
  return candidateIndex < baselineIndex - 1 ? (TIER_ORDER[baselineIndex - 1] ?? baseline) : candidate;
}

export function fuseLocalScores(baseline: RoutingDecision, inputs: LocalScoreInputs): FusedLocalDecision {
  const raw = {} as Record<QualityTier, number>;
  for (const tier of TIER_ORDER) {
    raw[tier] = baseline.scores[tier] * 0.5 + inputs.scout[tier] * 0.28 + (inputs.arbiter?.[tier] ?? 0) * 0.22;
  }
  if (inputs.judgedTier) raw[inputs.judgedTier] += 0.45;
  const scores = normalizeScores(raw);
  const ranked = TIER_ORDER
    .map((tier) => ({ tier, score: scores[tier] }))
    .sort((left, right) => right.score - left.score);
  const candidate = ranked[0]?.tier ?? baseline.tier;
  const tier = tierAtLeast(boundedDowngrade(candidate, baseline.tier), capabilityFloor(baseline));
  const margin = (ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0);
  return {
    tier,
    scores,
    margin,
    confidence: Math.min(0.98, Math.max(baseline.confidence, 0.62 + margin * 1.6)),
  };
}
