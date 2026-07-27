import { getProfile } from './profiles.mjs';

const TIERS = ['fast', 'balanced', 'deep', 'max'];
const CAPABILITIES = ['web', 'files', 'vision', 'longContext', 'code'];

function index(value) {
  const found = TIERS.indexOf(value);
  return found < 0 ? 0 : found;
}

function tierAtLeast(left, right) {
  return index(left) >= index(right);
}

function maxTier(left, right) {
  return tierAtLeast(left, right) ? left : right;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function normalizeRouted(value, testCase) {
  if (value && typeof value === 'object' && value.decision) {
    const baseline = value.decision;
    const observedTier = value.observedTier ?? baseline.tier;
    return {
      decision: baseline,
      actualTier: baseline.tier,
      observedTier,
      preferenceAdjusted: observedTier !== baseline.tier,
    };
  }

  const decision = value;
  const learnedFrom = decision.learningAdjustment?.applied ? decision.learningAdjustment.fromTier : decision.tier;
  const minimumTier = getProfile(testCase.profile ?? 'general').minimumTier;
  const actualTier = maxTier(learnedFrom, minimumTier);
  return {
    decision,
    actualTier,
    observedTier: decision.tier,
    preferenceAdjusted: decision.learningAdjustment?.applied === true,
  };
}

export async function evaluateRouter(cases, routeCase) {
  const confusionMatrix = Object.fromEntries(TIERS.map((expected) => [expected, Object.fromEntries(TIERS.map((actual) => [actual, 0]))]));
  const rows = [];
  let exact = 0;
  let harmfulUnderRouting = 0;
  let overRouting = 0;
  let requiredCapabilities = 0;
  let matchedCapabilities = 0;
  let preferenceAdjustedCases = 0;

  for (let position = 0; position < cases.length; position += 1) {
    const testCase = cases[position];
    const routed = normalizeRouted(await routeCase(testCase), testCase);
    const decision = routed.decision;
    const expectedTier = testCase.expectedTier;
    const actualTier = routed.actualTier;
    const observedTier = routed.observedTier;
    if (routed.preferenceAdjusted) preferenceAdjustedCases += 1;

    confusionMatrix[expectedTier][actualTier] += 1;
    if (expectedTier === actualTier) exact += 1;
    if (index(actualTier) < index(expectedTier)) harmfulUnderRouting += 1;
    if (index(actualTier) > index(expectedTier)) overRouting += 1;

    const missingCapabilities = [];
    for (const capability of testCase.requiredCapabilities) {
      requiredCapabilities += 1;
      if (decision.capabilities?.[capability]) matchedCapabilities += 1;
      else missingCapabilities.push(capability);
    }

    rows.push({
      id: testCase.id ?? String(position + 1),
      expectedTier,
      actualTier,
      observedTier,
      preferenceAdjusted: routed.preferenceAdjusted,
      learningApplied: routed.preferenceAdjusted,
      tierDelta: index(actualTier) - index(expectedTier),
      missingCapabilities,
      passed: index(actualTier) >= index(expectedTier) && missingCapabilities.length === 0,
    });
  }

  const count = cases.length;
  return {
    caseCount: count,
    evaluationMode: 'baseline-with-preference-observation',
    preferenceAdjustedCases,
    exactTierAccuracy: count ? round(exact / count) : 0,
    harmfulUnderRouting: { count: harmfulUnderRouting, rate: count ? round(harmfulUnderRouting / count) : 0 },
    overRouting: { count: overRouting, rate: count ? round(overRouting / count) : 0 },
    capabilityRecall: requiredCapabilities ? round(matchedCapabilities / requiredCapabilities) : 1,
    confusionMatrix,
    cases: rows,
    capabilityKeys: CAPABILITIES,
  };
}
