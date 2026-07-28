import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SWITCHBOARD_ROUTER_MODULE = '.test-dist/router/route.js';
const { createSwitchboardMcpSession } = await import('../mcp/server.mjs');
const { AggregatePreferenceStore } = await import('../mcp/learning.mjs');

const request = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
const baseDecision = {
  tier: 'balanced',
  effort: 'medium',
  capabilities: { web: false, files: false, vision: false, longContext: false, code: false },
  confidence: 0.8,
  shouldUseJudge: false,
  reasons: [{ code: 'analysis', detail: 'Routine analysis', weight: 1 }],
  scores: { fast: 0.1, balanced: 0.7, deep: 0.15, max: 0.05 },
  taskCategories: ['analysis'],
};

async function readySession() {
  const preferenceStore = new AggregatePreferenceStore();
  const session = createSwitchboardMcpSession({ route: async () => ({ ...baseDecision }), preferenceStore });
  await session.handle(
    request(1, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'evaluation-isolation', version: '1' },
    }),
  );
  await session.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  for (let index = 0; index < 3; index += 1) {
    await session.handle(
      request(2 + index, 'tools/call', {
        name: 'record_override',
        arguments: { categories: ['analysis'], recommendedTier: 'balanced', selectedTier: 'deep' },
      }),
    );
  }
  return session;
}

function evaluationArguments(includePreferences) {
  return {
    cases: [{ id: 'analysis-case', prompt: 'Analyze this request.', expectedTier: 'balanced' }],
    ...(includePreferences === undefined ? {} : { includePreferences }),
  };
}

test('evaluate_router excludes aggregate preferences from baseline metrics by default', async () => {
  const session = await readySession();
  const response = await session.handle(
    request(10, 'tools/call', {
      name: 'evaluate_router',
      arguments: evaluationArguments(undefined),
    }),
  );
  const result = response.result.structuredContent;
  assert.equal(result.exactTierAccuracy, 1);
  assert.equal(result.preferenceAdjustedCases, 0);
  assert.equal(result.cases[0].actualTier, 'balanced');
  assert.equal(result.cases[0].observedTier, 'balanced');
});

test('evaluate_router can observe preference-adjusted tiers without contaminating baseline metrics', async () => {
  const session = await readySession();
  const response = await session.handle(
    request(11, 'tools/call', {
      name: 'evaluate_router',
      arguments: evaluationArguments(true),
    }),
  );
  const result = response.result.structuredContent;
  assert.equal(result.exactTierAccuracy, 1);
  assert.equal(result.preferenceAdjustedCases, 1);
  assert.equal(result.cases[0].actualTier, 'balanced');
  assert.equal(result.cases[0].observedTier, 'deep');
  assert.equal(result.cases[0].preferenceAdjusted, true);
});
