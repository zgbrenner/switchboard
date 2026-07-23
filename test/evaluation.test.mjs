import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRoutingCases, validateBenchmarkCase } from '../.test-dist/evaluation/metrics.js';

test('benchmark schema rejects an inverted tier range', () => {
  assert.throws(() => validateBenchmarkCase({
    id: 'bad-range',
    prompt: 'Analyze this.',
    expected: { minTier: 'max', maxTier: 'balanced', capabilities: [] }
  }), /minTier cannot be stronger than maxTier/);
});

test('evaluation separates harmful under-routing from wasteful over-routing', () => {
  const result = evaluateRoutingCases([
    {
      case: { id: 'under', prompt: 'Audit this', expected: { minTier: 'deep', maxTier: 'max', capabilities: ['code'] } },
      decision: { tier: 'balanced', capabilities: { web: false, files: false, vision: false, longContext: false, code: false } }
    },
    {
      case: { id: 'over', prompt: 'Rewrite this', expected: { minTier: 'fast', maxTier: 'balanced', capabilities: [] } },
      decision: { tier: 'max', capabilities: { web: false, files: false, vision: false, longContext: false, code: false } }
    },
    {
      case: { id: 'ok', prompt: 'Explain this', expected: { minTier: 'balanced', maxTier: 'deep', capabilities: [] } },
      decision: { tier: 'balanced', capabilities: { web: false, files: false, vision: false, longContext: false, code: false } }
    }
  ]);

  assert.equal(result.total, 3);
  assert.equal(result.harmfulUnderRoutes, 1);
  assert.equal(result.wastefulOverRoutes, 1);
  assert.equal(result.capabilityMisses, 1);
  assert.equal(result.inRange, 1);
});
