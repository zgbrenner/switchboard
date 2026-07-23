import test from 'node:test';
import assert from 'node:assert/strict';
import { fuseLocalScores } from '../.test-dist/models/fusion.js';

function baseline(overrides = {}) {
  return {
    tier: 'deep',
    effort: 'high',
    capabilities: { web: false, files: false, vision: false, longContext: false, code: false },
    confidence: 0.72,
    shouldUseJudge: false,
    reasons: [],
    scores: { fast: 0.05, balanced: 0.15, deep: 0.7, max: 0.1 },
    taskCategories: [],
    ...overrides,
  };
}

test('local models cannot under-route vision work below deep', () => {
  const decision = fuseLocalScores(
    baseline({ capabilities: { web: false, files: true, vision: true, longContext: false, code: false } }),
    {
      scout: { fast: 0.98, balanced: 0.01, deep: 0.005, max: 0.005 },
      arbiter: { fast: 0.99, balanced: 0.005, deep: 0.003, max: 0.002 },
    },
  );
  assert.equal(decision.tier, 'deep');
});

test('a local ensemble may downgrade by at most one tier', () => {
  const decision = fuseLocalScores(
    baseline({ tier: 'max', effort: 'max', scores: { fast: 0.01, balanced: 0.04, deep: 0.15, max: 0.8 } }),
    {
      scout: { fast: 0.99, balanced: 0.005, deep: 0.003, max: 0.002 },
      arbiter: { fast: 0.99, balanced: 0.005, deep: 0.003, max: 0.002 },
    },
  );
  assert.equal(decision.tier, 'deep');
});

test('the Judge can break a close decision toward max', () => {
  const base = baseline({ tier: 'balanced', effort: 'medium', scores: { fast: 0.2, balanced: 0.35, deep: 0.3, max: 0.15 } });
  const inputs = {
    scout: { fast: 0.15, balanced: 0.3, deep: 0.3, max: 0.25 },
    arbiter: { fast: 0.1, balanced: 0.3, deep: 0.3, max: 0.3 },
  };
  const withoutJudge = fuseLocalScores(base, inputs);
  const withJudge = fuseLocalScores(base, { ...inputs, judgedTier: 'max' });
  assert.ok(withJudge.scores.max > withoutJudge.scores.max);
  assert.equal(withJudge.tier, 'max');
});

test('fused scores remain normalized', () => {
  const decision = fuseLocalScores(baseline(), {
    scout: { fast: 0.1, balanced: 0.2, deep: 0.6, max: 0.1 },
  });
  const total = Object.values(decision.scores).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.ok(decision.confidence >= 0.72 && decision.confidence <= 0.98);
});
