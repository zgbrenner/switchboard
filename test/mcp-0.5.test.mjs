import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SWITCHBOARD_ROUTER_MODULE = '.test-dist/router/route.js';
const { createSwitchboardMcpSession, SERVER_INFO } = await import('../mcp/server.mjs');

const request = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });

function baseDecision(overrides = {}) {
  return {
    tier: 'balanced',
    effort: 'medium',
    capabilities: { web: false, files: false, vision: false, longContext: false, code: false },
    confidence: 0.8,
    shouldUseJudge: false,
    reasons: [{ code: 'complexity', detail: 'Moderate complexity', weight: 1 }],
    scores: { fast: 0.1, balanced: 0.7, deep: 0.15, max: 0.05 },
    taskCategories: ['analysis'],
    ...overrides,
  };
}

async function session(route = async () => baseDecision()) {
  const value = createSwitchboardMcpSession({ route });
  const initialized = await value.handle(request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'mcp-0.5-test', version: '1' } }));
  assert.equal(initialized.result.serverInfo.version, '0.5.0');
  await value.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return value;
}

async function tool(value, id, name, args) {
  return await value.handle(request(id, 'tools/call', { name, arguments: args }));
}

test('publishes the 0.5 tool surface and additive API metadata', async () => {
  assert.equal(SERVER_INFO.version, '0.5.0');
  const value = await session();
  const listed = await value.handle(request(2, 'tools/list', {}));
  assert.deepEqual(listed.result.tools.map((item) => item.name), [
    'route_request', 'explain_route', 'compare_routes', 'simulate_policy', 'validate_model_inventory', 'evaluate_router',
  ]);
  const resource = await value.handle(request(3, 'resources/read', { uri: 'switchboard://api' }));
  const metadata = JSON.parse(resource.result.contents[0].text);
  assert.equal(metadata.current, '2026-07-24');
  assert.equal(metadata.compatibility.additiveFrom, '0.4.0');
});

test('route_request preserves old fields and adds confidence budget and execution planning', async () => {
  const value = await session(async () => baseDecision({ tier: 'deep', effort: 'high', taskCategories: ['security', 'code'], capabilities: { web: false, files: false, vision: false, longContext: false, code: true } }));
  const response = await tool(value, 2, 'route_request', {
    prompt: 'Audit this authentication implementation.',
    profile: 'security',
    budget: { maxRelativeCost: 0.8, maxRelativeLatency: 0.8, minQuality: 0.7, maxStages: 3 },
    planMode: 'multi',
  });
  const result = response.result.structuredContent;
  assert.equal(result.apiVersion, '2026-07-24');
  assert.equal(result.tier, 'deep');
  assert.equal(result.effort, 'high');
  assert.equal(result.effectiveProfile, 'security');
  assert.equal(result.capabilities.code, true);
  assert.ok(result.confidenceEvidence.scoreMargin > 0);
  assert.ok(result.executionPlan.stages.length >= 2);
  assert.equal(result.budgetAssessment.fits, true);
  assert.equal(result.modelResolution.status, 'not-provided');
});

test('profiles cannot lower safety floors and low-cost budgets report conflicts', async () => {
  const value = await session(async () => baseDecision({ tier: 'balanced', effort: 'medium' }));
  const legal = await tool(value, 2, 'route_request', { prompt: 'Analyze this contract.', profile: 'legal', budget: { maxRelativeCost: 0.1 } });
  const result = legal.result.structuredContent;
  assert.equal(result.tier, 'deep');
  assert.equal(result.effectivePolicy, 'best');
  assert.equal(result.budgetAssessment.fits, false);
  assert.ok(result.budgetAssessment.violations.includes('cost'));
});

test('host model inventories produce concrete recommendations and can be validated independently', async () => {
  const value = await session(async () => baseDecision({ tier: 'deep', effort: 'high', capabilities: { web: true, files: false, vision: false, longContext: false, code: true } }));
  const inventory = [
    { id: 'fast', tier: 'fast', effortLevels: ['low'], capabilities: { web: false, code: true }, relativeCost: 0.1, relativeLatency: 0.1 },
    { id: 'deep', tier: 'deep', effortLevels: ['high'], capabilities: { web: true, code: true }, relativeCost: 0.6, relativeLatency: 0.5 },
  ];
  const routed = await tool(value, 2, 'route_request', { prompt: 'Research and audit this implementation.', availableModels: inventory });
  assert.equal(routed.result.structuredContent.modelResolution.recommended.id, 'deep');

  const validated = await tool(value, 3, 'validate_model_inventory', { availableModels: inventory });
  assert.equal(validated.result.structuredContent.valid, true);
  assert.equal(validated.result.structuredContent.modelCount, 2);
  assert.equal(validated.result.structuredContent.capabilityCoverage.web, 1);
});

test('explain_route returns concise structured evidence', async () => {
  const value = await session();
  const response = await tool(value, 2, 'explain_route', { prompt: 'Summarize this paragraph.' });
  const explanation = response.result.structuredContent;
  assert.match(explanation.summary, /Route: balanced/);
  assert.equal(explanation.route.effort, 'medium');
  assert.ok(explanation.confidenceEvidence);
});

test('compare_routes and simulate_policy compare bounded variants deterministically', async () => {
  const value = await session(async (input) => baseDecision({ tier: input.preferences.policy === 'best' ? 'deep' : 'fast', effort: input.preferences.policy === 'best' ? 'high' : 'low' }));
  const args = {
    prompt: 'Draft and review this response.',
    variants: [
      { label: 'quality', policy: 'best' },
      { label: 'speed', policy: 'fast' },
    ],
  };
  const compared = await tool(value, 2, 'compare_routes', args);
  assert.equal(compared.result.structuredContent.differences.tierSpread, 2);
  assert.deepEqual(compared.result.structuredContent.differences.distinctTiers, ['deep', 'fast']);
  const simulated = await tool(value, 3, 'simulate_policy', args);
  assert.deepEqual(simulated.result.structuredContent, compared.result.structuredContent);
});

test('evaluate_router reports under-routing over-routing capability recall and confusion matrix', async () => {
  const value = await session(async (input) => {
    if (input.prompt.includes('under')) return baseDecision({ tier: 'fast' });
    if (input.prompt.includes('over')) return baseDecision({ tier: 'deep' });
    return baseDecision({ tier: 'balanced', capabilities: { web: true, files: false, vision: false, longContext: false, code: false } });
  });
  const response = await tool(value, 2, 'evaluate_router', { cases: [
    { id: 'under', prompt: 'under route case', expectedTier: 'deep' },
    { id: 'over', prompt: 'over route case', expectedTier: 'fast' },
    { id: 'exact', prompt: 'exact route case', expectedTier: 'balanced', requiredCapabilities: ['web'] },
  ] });
  const metrics = response.result.structuredContent;
  assert.equal(metrics.caseCount, 3);
  assert.equal(metrics.harmfulUnderRouting.count, 1);
  assert.equal(metrics.overRouting.count, 1);
  assert.equal(metrics.capabilityRecall, 1);
  assert.equal(metrics.confusionMatrix.deep.fast, 1);
});

test('strict bounds reject unknown profiles invalid budgets and oversized evaluation batches', async () => {
  const value = await session();
  const profile = await tool(value, 2, 'route_request', { prompt: 'test', profile: 'unknown' });
  assert.equal(profile.result.isError, true);
  assert.match(profile.result.content[0].text, /profile/i);

  const budget = await tool(value, 3, 'route_request', { prompt: 'test', budget: { maxStages: 5 } });
  assert.equal(budget.result.isError, true);
  assert.match(budget.result.content[0].text, /maxStages/i);

  const evaluation = await tool(value, 4, 'evaluate_router', { cases: Array.from({ length: 101 }, (_, index) => ({ prompt: `case ${index}`, expectedTier: 'fast' })) });
  assert.equal(evaluation.result.isError, true);
  assert.match(evaluation.result.content[0].text, /100/);
});
