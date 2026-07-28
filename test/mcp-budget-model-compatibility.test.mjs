import assert from 'node:assert/strict';
import test from 'node:test';

const { assessBudget, normalizeBudget } = await import('../mcp/enhance.mjs');

const decision = {
  tier: 'deep',
  effort: 'high',
  capabilities: { web: false, files: false, vision: false, longContext: false, code: true },
};

test('budget assessment is not marked fitting when the recommended model is under-capable', () => {
  const assessment = assessBudget(
    decision,
    {
      status: 'recommended',
      recommended: {
        id: 'cheap-fast-model',
        tier: 'fast',
        effort: 'low',
        meetsRequirements: false,
        unknownCapabilities: [],
        relativeCost: 0.05,
        relativeLatency: 0.05,
        score: 100,
      },
      alternatives: [],
      negotiation: { requiredCapabilities: ['code'], eligibleCount: 1, rejected: [] },
    },
    normalizeBudget({ maxRelativeCost: 0.1, maxRelativeLatency: 0.1 }),
  );

  assert.equal(assessment.modelCompatibility, 'incompatible');
  assert.equal(assessment.fits, false);
  assert.deepEqual(assessment.violations, ['modelRequirements']);
});

test('no compatible model is surfaced as a model-requirement violation', () => {
  const assessment = assessBudget(
    decision,
    {
      status: 'no-compatible-model',
      recommended: null,
      alternatives: [],
      negotiation: { requiredCapabilities: ['code'], eligibleCount: 0, rejected: [{ id: 'text-only', reasons: ['missing:code'] }] },
    },
    normalizeBudget(),
  );

  assert.equal(assessment.modelCompatibility, 'incompatible');
  assert.equal(assessment.fits, false);
  assert.ok(assessment.violations.includes('modelRequirements'));
});

test('omitted inventories remain neutral rather than failing the budget', () => {
  const assessment = assessBudget(
    decision,
    {
      status: 'not-provided',
      recommended: null,
      alternatives: [],
      negotiation: { requiredCapabilities: ['code'], eligibleCount: 0, rejected: [] },
    },
    normalizeBudget(),
  );

  assert.equal(assessment.modelCompatibility, 'not-evaluated');
  assert.equal(assessment.fits, true);
  assert.deepEqual(assessment.violations, []);
});

test('a compatible recommendation can satisfy model and resource constraints', () => {
  const assessment = assessBudget(
    decision,
    {
      status: 'recommended',
      recommended: {
        id: 'deep-code-model',
        tier: 'deep',
        effort: 'high',
        meetsRequirements: true,
        unknownCapabilities: [],
        relativeCost: 0.6,
        relativeLatency: 0.5,
        score: 1,
      },
      alternatives: [],
      negotiation: { requiredCapabilities: ['code'], eligibleCount: 1, rejected: [] },
    },
    normalizeBudget({ maxRelativeCost: 0.7, maxRelativeLatency: 0.6, minQuality: 0.8 }),
  );

  assert.equal(assessment.modelCompatibility, 'compatible');
  assert.equal(assessment.fits, true);
  assert.deepEqual(assessment.violations, []);
});
