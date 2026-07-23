import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOverrideLearning } from '../.test-dist/router/personalization.js';

test('learns a small category boost without storing prompt text', () => {
  const next = applyOverrideLearning(
    {},
    { recommended: 'balanced', selected: 'deep', categories: ['legal', 'comparison'] }
  );
  assert.deepEqual(Object.keys(next).sort(), ['comparison', 'legal']);
  assert.ok(next.legal > 0 && next.legal <= 0.25);
  assert.equal(JSON.stringify(next).includes('prompt'), false);
});

test('bounds repeated local preference learning', () => {
  let boosts = {};
  for (let index = 0; index < 50; index += 1) {
    boosts = applyOverrideLearning(boosts, { recommended: 'fast', selected: 'max', categories: ['code'] });
  }
  assert.equal(boosts.code, 1.5);
});
