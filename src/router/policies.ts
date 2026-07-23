import type { QualityTier, RoutingPolicy } from '../shared/types.js';

export const TIER_ORDER: readonly QualityTier[] = ['fast', 'balanced', 'deep', 'max'];

export const ROUTE_PROTOTYPES: Readonly<Record<QualityTier, string>> = {
  fast: 'simple rewrite edit grammar formatting extraction casual question short summary brainstorm low risk direct answer',
  balanced: 'general explanation moderate synthesis standard coding structured writing multi part familiar task normal analysis',
  deep: 'complex debugging comparison legal technical analysis subtle constraints difficult planning long document reasoning security review',
  max: 'deep research verify every claim current primary sources exhaustive audit highest quality ambiguous high stakes difficult multi source synthesis'
};

export function policyBias(policy: RoutingPolicy): Readonly<Record<QualityTier, number>> {
  switch (policy) {
    case 'best':
      return { fast: -0.1, balanced: 0, deep: 0.15, max: 0.2 };
    case 'fast':
      return { fast: 0.25, balanced: 0.1, deep: -0.1, max: -0.25 };
    case 'conserve':
      return { fast: 0.2, balanced: 0.15, deep: -0.05, max: -0.35 };
    case 'balanced':
    default:
      return { fast: 0, balanced: 0.1, deep: 0, max: -0.05 };
  }
}

export function tierAtLeast(tier: QualityTier, floor: QualityTier): QualityTier {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(floor) ? tier : floor;
}
