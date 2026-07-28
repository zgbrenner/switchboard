import type { QualityTier, RoutingPolicy } from '../shared/types.js';

export const TIER_ORDER: readonly QualityTier[] = ['fast', 'balanced', 'deep', 'max'];

export const ROUTE_PROTOTYPES: Readonly<Record<QualityTier, string>> = {
  fast: 'simple rewrite edit grammar formatting extraction casual question short summary brainstorm low risk direct answer',
  balanced: 'general explanation moderate synthesis standard coding structured writing multi part familiar task normal analysis',
  deep: 'complex debugging comparison legal technical analysis subtle constraints difficult planning long document reasoning security review',
  max: 'deep research verify every claim current primary sources exhaustive audit highest quality ambiguous high stakes difficult multi source synthesis',
};

/**
 * Additive per-tier bias applied to the blended routing score.
 *
 * The magnitudes are deliberately larger than the deterministic tier affinity gap so that a policy can
 * move the decision by one tier, but smaller than the below-floor penalty so that a policy can never
 * push a decision beneath a safety floor. See docs/architecture/routing.md for the derivation.
 */
const POLICY_BIAS: Readonly<Record<RoutingPolicy, Readonly<Record<QualityTier, number>>>> = Object.freeze({
  best: Object.freeze({ fast: -0.1, balanced: 0, deep: 0.15, max: 0.2 }),
  fast: Object.freeze({ fast: 0.25, balanced: 0.1, deep: -0.1, max: -0.25 }),
  conserve: Object.freeze({ fast: 0.2, balanced: 0.15, deep: -0.05, max: -0.35 }),
  balanced: Object.freeze({ fast: 0, balanced: 0.1, deep: 0, max: -0.05 }),
});

export function policyBias(policy: RoutingPolicy): Readonly<Record<QualityTier, number>> {
  return POLICY_BIAS[policy] ?? POLICY_BIAS.balanced;
}

export function tierAtLeast(tier: QualityTier, floor: QualityTier): QualityTier {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(floor) ? tier : floor;
}
