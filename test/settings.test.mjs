import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings } from '../.test-dist/extension/settings.js';

test('settings preserve explicit false values', () => {
  const settings = normalizeSettings({
    enabled: false,
    autoSwitch: false,
    semanticModels: false,
    judgeEnabled: true,
  });
  assert.equal(settings.enabled, false);
  assert.equal(settings.autoSwitch, false);
  assert.equal(settings.semanticModels, false);
  assert.equal(settings.judgeEnabled, true);
});

test('settings reject malformed booleans and policies', () => {
  const settings = normalizeSettings({ enabled: 'no', semanticModels: 1, policy: 'unlimited' });
  assert.equal(settings.enabled, DEFAULT_SETTINGS.enabled);
  assert.equal(settings.semanticModels, DEFAULT_SETTINGS.semanticModels);
  assert.equal(settings.policy, DEFAULT_SETTINGS.policy);
});

test('settings retain only finite numeric personalization boosts', () => {
  const settings = normalizeSettings({ categoryBoosts: { legal: 0.2, code: Number.NaN, research: 'high' } });
  assert.deepEqual(settings.categoryBoosts, { legal: 0.2 });
});
