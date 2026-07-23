import test from 'node:test';
import assert from 'node:assert/strict';
import { rankModelLabels } from '../.test-dist/extension/model-selection.js';

test('ChatGPT fast routing prefers an instant option over pro', () => {
  const ranked = rankModelLabels('chatgpt', 'fast', ['GPT-5.6 Pro', 'GPT-5.6 Instant', 'Settings']);
  assert.equal(ranked[0].label, 'GPT-5.6 Instant');
  assert.equal(ranked.some((item) => item.label === 'Settings'), false);
});

test('Claude max routing prefers Opus over Haiku', () => {
  const ranked = rankModelLabels('claude', 'max', ['Claude Haiku', 'Claude Sonnet', 'Claude Opus 4.6']);
  assert.equal(ranked[0].label, 'Claude Opus 4.6');
});
