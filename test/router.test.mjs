import assert from 'node:assert/strict';
import test from 'node:test';
import { routeRequest } from '../.test-dist/router/route.js';

const base = { files: [], context: [], preferences: { policy: 'balanced' } };

test('routes a simple rewrite to fast', () => {
  const decision = routeRequest({ ...base, prompt: 'Make this sentence friendlier: Thanks for the update.' });
  assert.equal(decision.tier, 'fast');
  assert.ok(decision.confidence >= 0.7);
});

test('routes deep verified research to max and requires web', () => {
  const decision = routeRequest({
    ...base,
    prompt:
      'Research this deeply, verify every claim with current primary sources, compare the competing approaches, and produce a detailed implementation plan.',
  });
  assert.equal(decision.tier, 'max');
  assert.equal(decision.capabilities.web, true);
  assert.ok(decision.reasons.some((reason) => reason.code === 'explicit-research'));
});

test('file capability floor prevents fast routing', () => {
  const decision = routeRequest({
    ...base,
    prompt: 'Tell me what this says.',
    files: [
      {
        name: 'agreement.pdf',
        size: 120000,
        detectedType: 'pdf',
        mediaType: 'application/pdf',
        textLength: 18000,
        excerpt: 'Agreement between the parties...',
        warnings: [],
        capabilities: { files: true, vision: false, longContext: false },
      },
    ],
  });
  assert.notEqual(decision.tier, 'fast');
  assert.equal(decision.capabilities.files, true);
});

test('vague follow-up uses context and requests judge when signals conflict', () => {
  const decision = routeRequest({
    ...base,
    prompt: 'Do it again, but use the other interpretation.',
    context: [{ role: 'user', text: 'Analyze the indemnification provisions in these contracts and reconcile conflicts.' }],
  });
  assert.ok(['deep', 'max'].includes(decision.tier));
  assert.equal(decision.shouldUseJudge, true);
});
