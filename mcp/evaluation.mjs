const TIERS = ['fast', 'balanced', 'deep', 'max'];
const CAPABILITIES = ['web', 'files', 'vision', 'longContext', 'code'];

function index(value) {
  const found = TIERS.indexOf(value);
  return found < 0 ? 0 : found;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

export async function evaluateRouter(cases, routeCase) {
  const confusionMatrix = Object.fromEntries(TIERS.map((expected) => [expected, Object.fromEntries(TIERS.map((actual) => [actual, 0]))]));
  const rows = [];
  let exact = 0;
  let harmfulUnderRouting = 0;
  let overRouting = 0;
  let requiredCapabilities = 0;
  let matchedCapabilities = 0;

  for (let position = 0; position < cases.length; position += 1) {
    const testCase = cases[position];
    const decision = await routeCase(testCase);
    const expectedTier = testCase.expectedTier;
    const actualTier = decision.tier;
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
      tierDelta: index(actualTier) - index(expectedTier),
      missingCapabilities,
      passed: index(actualTier) >= index(expectedTier) && missingCapabilities.length === 0,
    });
  }

  const count = cases.length;
  return {
    caseCount: count,
    exactTierAccuracy: count ? round(exact / count) : 0,
    harmfulUnderRouting: { count: harmfulUnderRouting, rate: count ? round(harmfulUnderRouting / count) : 0 },
    overRouting: { count: overRouting, rate: count ? round(overRouting / count) : 0 },
    capabilityRecall: requiredCapabilities ? round(matchedCapabilities / requiredCapabilities) : 1,
    confusionMatrix,
    cases: rows,
  };
}
