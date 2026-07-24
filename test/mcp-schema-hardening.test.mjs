import assert from 'node:assert/strict';
import test from 'node:test';

const { normalizeRouteArguments } = await import('../mcp/schema.mjs');

test('manual validation rejects inputs that contradict the advertised JSON Schema', () => {
  assert.throws(() => normalizeRouteArguments({ prompt: '   ' }), /prompt/i);
  assert.throws(() => normalizeRouteArguments({ prompt: 'x', files: [{ name: 'x', detectedType: 'executable' }] }), /detectedType/i);
  assert.throws(() => normalizeRouteArguments({ prompt: 'x', files: [{ name: 'x', capabilities: { vision: 'yes' } }] }), /vision/i);
  assert.throws(() => normalizeRouteArguments({
    prompt: 'x',
    availableModels: [{ id: 'model', effortLevels: ['high', 'high'] }],
  }), /effortLevels/i);
  assert.throws(() => normalizeRouteArguments({
    prompt: 'x',
    availableModels: [{ id: 'model', available: 'yes' }],
  }), /available/i);
  assert.throws(() => normalizeRouteArguments({
    prompt: 'x',
    availableModels: [{ id: '   ' }],
  }), /id/i);
});
