import assert from 'node:assert/strict';
import test from 'node:test';

const { evaluateRouter } = await import('../mcp/evaluation.mjs');

const capabilities = { web: false, files: false, vision: false, longContext: false, code: false };

test('evaluation metrics use the pre-learning tier while reporting the observed tier', async () => {
  const result = await evaluateRouter([
    { id: 'learned-upgrade', expectedTier: 'balanced', requiredCapabilities: [], profile: 'general' },
  ], async () => ({
    tier: 'deep',
    capabilities,
    learningAdjustment: { applied: true, bias: 0.2, fromTier: 'balanced', toTier: 'deep' },
  }));

  assert.equal(result.evaluationMode, 'baseline-with-preference-observation');
  assert.equal(result.preferenceAdjustedCases, 1);
  assert.equal(result.exactTierAccuracy, 1);
  assert.equal(result.overRouting.count, 0);
  assert.equal(result.cases[0].actualTier, 'balanced');
  assert.equal(result.cases[0].observedTier, 'deep');
  assert.equal(result.cases[0].learningApplied, true);
});

test('profile floors remain part of baseline evaluation', async () => {
  const result = await evaluateRouter([
    { id: 'legal-floor', expectedTier: 'deep', requiredCapabilities: [], profile: 'legal' },
  ], async () => ({
    tier: 'deep',
    capabilities,
    learningAdjustment: { applied: true, bias: -0.2, fromTier: 'balanced', toTier: 'fast' },
  }));

  assert.equal(result.exactTierAccuracy, 1);
  assert.equal(result.cases[0].actualTier, 'deep');
  assert.equal(result.cases[0].observedTier, 'deep');
});

test('unadjusted evaluations preserve observed routing behavior', async () => {
  const result = await evaluateRouter([
    { id: 'plain', expectedTier: 'deep', requiredCapabilities: ['code'], profile: 'general' },
  ], async () => ({
    tier: 'balanced',
    capabilities: { ...capabilities, code: false },
    learningAdjustment: { applied: false, bias: 0, reason: 'no-category-history' },
  }));

  assert.equal(result.preferenceAdjustedCases, 0);
  assert.equal(result.harmfulUnderRouting.count, 1);
  assert.equal(result.capabilityRecall, 0);
  assert.equal(result.cases[0].actualTier, 'balanced');
  assert.equal(result.cases[0].observedTier, 'balanced');
});
