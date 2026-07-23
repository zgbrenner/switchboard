import { TIER_ORDER } from '../router/policies.js';
import type { CapabilitySet, ConversationTurn, FileInsight, QualityTier, RoutingDecision } from '../shared/types.js';

export type CapabilityName = keyof CapabilitySet;

export interface BenchmarkExpectation {
  minTier: QualityTier;
  maxTier: QualityTier;
  capabilities: CapabilityName[];
}

export interface BenchmarkCase {
  id: string;
  prompt: string;
  context?: ConversationTurn[];
  files?: FileInsight[];
  tags?: string[];
  expected: BenchmarkExpectation;
}

export interface EvaluatedRoutingCase {
  case: BenchmarkCase;
  decision: Pick<RoutingDecision, 'tier' | 'capabilities'>;
}

export interface RoutingEvaluation {
  total: number;
  inRange: number;
  harmfulUnderRoutes: number;
  wastefulOverRoutes: number;
  capabilityMisses: number;
  exactTierMatches: number;
  inRangeRate: number;
  harmfulUnderRouteRate: number;
  capabilityMissRate: number;
  failures: Array<{ id: string; kind: 'under' | 'over' | 'capability'; detail: string }>;
}

const TIERS = new Set<QualityTier>(TIER_ORDER);
const CAPABILITIES = new Set<CapabilityName>(['web', 'files', 'vision', 'longContext', 'code']);

function tierIndex(tier: QualityTier): number {
  return TIER_ORDER.indexOf(tier);
}

export function validateBenchmarkCase(value: unknown): BenchmarkCase {
  if (typeof value !== 'object' || value === null) throw new Error('Benchmark case must be an object.');
  const item = value as Partial<BenchmarkCase>;
  if (!item.id || !/^[a-z0-9][a-z0-9._-]+$/i.test(item.id)) throw new Error('Benchmark case id is invalid.');
  if (!item.prompt || typeof item.prompt !== 'string') throw new Error(`Benchmark case ${item.id} is missing a prompt.`);
  if (typeof item.expected !== 'object' || item.expected === null) throw new Error(`Benchmark case ${item.id} is missing expected routing.`);
  const expected = item.expected as Partial<BenchmarkExpectation>;
  if (!TIERS.has(expected.minTier as QualityTier) || !TIERS.has(expected.maxTier as QualityTier)) {
    throw new Error(`Benchmark case ${item.id} has an invalid tier.`);
  }
  if (tierIndex(expected.minTier as QualityTier) > tierIndex(expected.maxTier as QualityTier)) {
    throw new Error(`Benchmark case ${item.id} minTier cannot be stronger than maxTier.`);
  }
  if (!Array.isArray(expected.capabilities) || expected.capabilities.some((capability) => !CAPABILITIES.has(capability))) {
    throw new Error(`Benchmark case ${item.id} has invalid capabilities.`);
  }
  return item as BenchmarkCase;
}

export function evaluateRoutingCases(items: EvaluatedRoutingCase[]): RoutingEvaluation {
  let inRange = 0;
  let harmfulUnderRoutes = 0;
  let wastefulOverRoutes = 0;
  let capabilityMisses = 0;
  let exactTierMatches = 0;
  const failures: RoutingEvaluation['failures'] = [];

  for (const item of items) {
    const benchmarkCase = validateBenchmarkCase(item.case);
    const actual = tierIndex(item.decision.tier);
    const minimum = tierIndex(benchmarkCase.expected.minTier);
    const maximum = tierIndex(benchmarkCase.expected.maxTier);
    if (actual < minimum) {
      harmfulUnderRoutes += 1;
      failures.push({ id: benchmarkCase.id, kind: 'under', detail: `${item.decision.tier} is below ${benchmarkCase.expected.minTier}.` });
    } else if (actual > maximum) {
      wastefulOverRoutes += 1;
      failures.push({ id: benchmarkCase.id, kind: 'over', detail: `${item.decision.tier} is above ${benchmarkCase.expected.maxTier}.` });
    } else {
      inRange += 1;
    }
    if (benchmarkCase.expected.minTier === benchmarkCase.expected.maxTier && item.decision.tier === benchmarkCase.expected.minTier) {
      exactTierMatches += 1;
    }
    const missing = benchmarkCase.expected.capabilities.filter((capability) => !item.decision.capabilities[capability]);
    if (missing.length > 0) {
      capabilityMisses += 1;
      failures.push({ id: benchmarkCase.id, kind: 'capability', detail: `Missing ${missing.join(', ')}.` });
    }
  }

  const total = items.length;
  const rate = (count: number): number => total === 0 ? 0 : count / total;
  return {
    total,
    inRange,
    harmfulUnderRoutes,
    wastefulOverRoutes,
    capabilityMisses,
    exactTierMatches,
    inRangeRate: rate(inRange),
    harmfulUnderRouteRate: rate(harmfulUnderRoutes),
    capabilityMissRate: rate(capabilityMisses),
    failures,
  };
}
