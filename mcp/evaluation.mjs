import { getProfile } from './profiles.mjs';

const TIERS = ['fast', 'balanced', 'deep', 'max'];

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

function baselineTier(decision, testCase) {
  const learnedFrom = decision.learningAdjustment?.applied ? decision.learningAdjustment.fromTier : decision.tier;
  const minimumTier = getProfile(testCase.profile ?? 'general').minimumTier;
  return maxTier(learnedFrom, minimumTier);
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
    const decision = await routeCase(testCase);
    const expectedTier = testCase.expectedTier;
    const observedTier = decision.tier;
    const actualTier = baselineTier(decision, testCase);
    const learningApplied = decision.learningAdjustment?.applied === true;
    if (learningApplied) preferenceAdjustedCases += 1;

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
      learningApplied,
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
  };
}
