import test from 'node:test';
import assert from 'node:assert/strict';
import { isModelSelectionConfirmed, rankModelLabels } from '../.test-dist/extension/model-selection.js';

test('ChatGPT balanced routing prefers Auto over Instant, Thinking, and Pro', () => {
  const ranked = rankModelLabels('chatgpt', 'balanced', [
    'GPT-5.6 Instant',
    'GPT-5.6 Thinking',
    'GPT-5.6 Pro',
    'Auto',
  ]);
  assert.equal(ranked[0].label, 'Auto');
});

test('confirms a model selection only when the visible picker matches the requested route', () => {
  assert.equal(isModelSelectionConfirmed('chatgpt', 'deep', 'GPT-5.6 Instant', 'GPT-5.6 Thinking'), true);
  assert.equal(isModelSelectionConfirmed('chatgpt', 'deep', 'GPT-5.6 Instant', 'GPT-5.6 Instant'), false);
});

test('accepts an already-selected route even when the picker label does not change', () => {
  assert.equal(isModelSelectionConfirmed('claude', 'balanced', 'Claude Sonnet 4.5', 'Claude Sonnet 4.5'), true);
});

test('model picker discovery rejects profile and settings menus', async () => {
  const { scoreModelPickerLabel } = await import('../.test-dist/extension/model-selection.js');
  assert.ok(scoreModelPickerLabel('Model selector GPT-5.6 Thinking') > 0);
  assert.ok(scoreModelPickerLabel('Claude Sonnet') > 0);
  assert.ok(scoreModelPickerLabel('Open profile menu') < 0);
  assert.ok(scoreModelPickerLabel('Settings') < 0);
});
