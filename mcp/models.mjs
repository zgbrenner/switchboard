const TIER_ORDER = ['fast', 'balanced', 'deep', 'max'];
const EFFORT_ORDER = ['low', 'medium', 'high', 'max'];
const CAPABILITY_KEYS = ['web', 'files', 'vision', 'longContext', 'code'];

function indexOf(order, value) {
  const index = order.indexOf(value);
  return index < 0 ? 0 : index;
}

function closestEffort(desired, supported) {
  if (!supported.length) return desired;
  if (supported.includes(desired)) return desired;
  const target = indexOf(EFFORT_ORDER, desired);
  return (
    [...supported].sort((left, right) => {
      const leftDistance = Math.abs(indexOf(EFFORT_ORDER, left) - target);
      const rightDistance = Math.abs(indexOf(EFFORT_ORDER, right) - target);
      return leftDistance - rightDistance || indexOf(EFFORT_ORDER, right) - indexOf(EFFORT_ORDER, left);
    })[0] ?? desired
  );
}

/**
 * Scoring weights used when ranking a host-supplied model inventory.
 *
 * `above` penalises (or, when negative, rewards) picking a model above the routed tier; `cost` and
 * `latency` weight the model's normalised relativeCost and relativeLatency.
 */
const POLICY_WEIGHTS = Object.freeze({
  best: Object.freeze({ above: -6, cost: 0.5, latency: 0.5 }),
  fast: Object.freeze({ above: 6, cost: 2, latency: 6 }),
  conserve: Object.freeze({ above: 8, cost: 7, latency: 2 }),
  balanced: Object.freeze({ above: 2.5, cost: 3, latency: 2 }),
});

function policyWeights(policy) {
  return POLICY_WEIGHTS[policy] ?? POLICY_WEIGHTS.balanced;
}

function publicCandidate(candidate, score, decision, unknownCapabilities) {
  const selectedEffort = closestEffort(decision.effort, candidate.effortLevels);
  const meetsTier = indexOf(TIER_ORDER, candidate.tier) >= indexOf(TIER_ORDER, decision.tier);
  const meetsEffort =
    indexOf(EFFORT_ORDER, selectedEffort) >= indexOf(EFFORT_ORDER, decision.effort) || candidate.effortLevels.length === 0;
  return {
    id: candidate.id,
    ...(candidate.title ? { title: candidate.title } : {}),
    ...(candidate.family ? { family: candidate.family } : {}),
    tier: candidate.tier,
    effort: selectedEffort,
    meetsRequirements: meetsTier && meetsEffort && unknownCapabilities.length === 0,
    unknownCapabilities,
    relativeCost: candidate.relativeCost,
    relativeLatency: candidate.relativeLatency,
    score: Math.round(score * 1000) / 1000,
  };
}

function negotiation(decision, eligibleCount, rejected) {
  return {
    requiredCapabilities: CAPABILITY_KEYS.filter((key) => decision.capabilities?.[key]),
    eligibleCount,
    rejected,
  };
}

export function resolveModelInventory(decision, models, options = {}) {
  if (models === undefined)
    return {
      status: 'not-provided',
      recommended: null,
      alternatives: [],
      negotiation: negotiation(decision, 0, []),
    };
  if (models.length === 0)
    return {
      status: 'no-compatible-model',
      recommended: null,
      alternatives: [],
      negotiation: negotiation(decision, 0, []),
    };

  const policy = options.policy ?? 'balanced';
  const weights = policyWeights(policy);
  const requiredTier = indexOf(TIER_ORDER, decision.tier);
  const desiredEffort = indexOf(EFFORT_ORDER, decision.effort);
  const ranked = [];
  const rejected = [];

  for (const candidate of models) {
    if (candidate.available === false) {
      rejected.push({ id: candidate.id, reasons: ['unavailable'] });
      continue;
    }
    const hardMissing = [];
    const unknownCapabilities = [];
    for (const key of CAPABILITY_KEYS) {
      if (!decision.capabilities[key]) continue;
      if (candidate.capabilities[key] === false) hardMissing.push(key);
      else if (candidate.capabilities[key] !== true) unknownCapabilities.push(key);
    }
    if (hardMissing.length > 0) {
      rejected.push({ id: candidate.id, reasons: hardMissing.map((key) => `missing:${key}`) });
      continue;
    }

    const candidateTier = indexOf(TIER_ORDER, candidate.tier);
    const below = Math.max(0, requiredTier - candidateTier);
    const above = Math.max(0, candidateTier - requiredTier);
    const selectedEffort = closestEffort(decision.effort, candidate.effortLevels);
    const effortGap = Math.max(0, desiredEffort - indexOf(EFFORT_ORDER, selectedEffort));
    let score = below * 100;
    score += above * weights.above;
    score += effortGap * 18;
    score += unknownCapabilities.length * 4;
    score += candidate.relativeCost * weights.cost;
    score += candidate.relativeLatency * weights.latency;
    if (options.hasContext && options.currentModelId === candidate.id && below === 0 && effortGap === 0) score -= 5;
    ranked.push(publicCandidate(candidate, score, decision, unknownCapabilities));
  }

  ranked.sort((left, right) => left.score - right.score || left.id.localeCompare(right.id));
  const details = negotiation(decision, ranked.length, rejected);
  if (ranked.length === 0) return { status: 'no-compatible-model', recommended: null, alternatives: [], negotiation: details };
  return {
    // A candidate that survived capability rejection can still sit below the routed tier or effort.
    // Reporting that as 'recommended' told the host the model met the requirements when the same
    // object said meetsRequirements: false, so 'best-effort' names the shortfall instead. The
    // candidate is still returned, because the host is usually better off with the closest match
    // plus an honest label than with nothing.
    status: ranked[0].meetsRequirements ? 'recommended' : 'best-effort',
    recommended: ranked[0],
    alternatives: ranked.slice(1, 4),
    negotiation: details,
  };
}
