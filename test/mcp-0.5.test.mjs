import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SWITCHBOARD_ROUTER_MODULE = '.test-dist/router/route.js';
const { createSwitchboardMcpSession, SERVER_INFO } = await import('../mcp/server.mjs');
const { AggregatePreferenceStore } = await import('../mcp/learning.mjs');

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

async function session(route = async () => baseDecision(), preferenceStore = new AggregatePreferenceStore()) {
  const value = createSwitchboardMcpSession({ route, preferenceStore });
  const initialized = await value.handle(
    request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'mcp-0.5-test', version: '1' } }),
  );
  assert.equal(initialized.result.serverInfo.version, '0.7.0');
  await value.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return value;
}

async function tool(value, id, name, args = {}) {
  return await value.handle(request(id, 'tools/call', { name, arguments: args }));
}

test('publishes the full 0.5 tool surface and additive API metadata', async () => {
  assert.equal(SERVER_INFO.version, '0.7.0');
  const value = await session();
  const listed = await value.handle(request(2, 'tools/list', {}));
  assert.deepEqual(
    listed.result.tools.map((item) => item.name),
    [
      'route_request',
      'prepare_request',
      'explain_route',
      'compare_routes',
      'simulate_policy',
      'validate_model_inventory',
      'evaluate_router',
      'record_override',
      'get_preference_state',
      'reset_preference_state',
    ],
  );
  assert.equal(listed.result.tools.find((item) => item.name === 'reset_preference_state').annotations.destructiveHint, true);
  const resource = await value.handle(request(3, 'resources/read', { uri: 'switchboard://api' }));
  const metadata = JSON.parse(resource.result.contents[0].text);
  assert.equal(metadata.current, '2026-07-24');
  assert.equal(metadata.compatibility.additiveFrom, '0.4.0');
  assert.match(metadata.compatibility.deprecationNotice, /migration period/i);
});

test('route_request preserves old fields and adds confidence budget planning and learning metadata', async () => {
  const value = await session(async () =>
    baseDecision({
      tier: 'deep',
      effort: 'high',
      taskCategories: ['security', 'code'],
      capabilities: { web: false, files: false, vision: false, longContext: false, code: true },
    }),
  );
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
  assert.equal(result.learningAdjustment.applied, false);
  assert.ok(result.confidenceEvidence.scoreMargin > 0);
  assert.ok(result.executionPlan.stages.length >= 2);
  assert.equal(result.budgetAssessment.fits, true);
  assert.equal(result.modelResolution.status, 'not-provided');
});

test('profiles cannot lower safety floors and low-cost budgets report conflicts', async () => {
  const value = await session(async () => baseDecision({ tier: 'balanced', effort: 'medium' }));
  const legal = await tool(value, 2, 'route_request', {
    prompt: 'Analyze this contract.',
    profile: 'legal',
    budget: { maxRelativeCost: 0.1 },
  });
  const result = legal.result.structuredContent;
  assert.equal(result.tier, 'deep');
  assert.equal(result.effectivePolicy, 'best');
  assert.equal(result.budgetAssessment.fits, false);
  assert.ok(result.budgetAssessment.violations.includes('cost'));
});

test('host model inventories expose capability negotiation and concrete recommendations', async () => {
  const value = await session(async () =>
    baseDecision({
      tier: 'deep',
      effort: 'high',
      capabilities: { web: true, files: false, vision: false, longContext: false, code: true },
    }),
  );
  const inventory = [
    { id: 'fast', tier: 'fast', effortLevels: ['low'], capabilities: { web: false, code: true }, relativeCost: 0.1, relativeLatency: 0.1 },
    { id: 'deep', tier: 'deep', effortLevels: ['high'], capabilities: { web: true, code: true }, relativeCost: 0.6, relativeLatency: 0.5 },
  ];
  const routed = await tool(value, 2, 'route_request', { prompt: 'Research and audit this implementation.', availableModels: inventory });
  const resolution = routed.result.structuredContent.modelResolution;
  assert.equal(resolution.recommended.id, 'deep');
  assert.deepEqual(resolution.negotiation.requiredCapabilities, ['web', 'code']);
  assert.equal(resolution.negotiation.eligibleCount, 1);
  assert.deepEqual(resolution.negotiation.rejected[0], { id: 'fast', reasons: ['missing:web'] });

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
  const value = await session(async (input) =>
    baseDecision({
      tier: input.preferences.policy === 'best' ? 'deep' : 'fast',
      effort: input.preferences.policy === 'best' ? 'high' : 'low',
    }),
  );
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
  const value = await session((input) => {
    if (input.prompt.includes('under')) return baseDecision({ tier: 'fast' });
    if (input.prompt.includes('over')) return baseDecision({ tier: 'deep' });
    return baseDecision({ tier: 'balanced', capabilities: { web: true, files: false, vision: false, longContext: false, code: false } });
  });
  const response = await tool(value, 2, 'evaluate_router', {
    cases: [
      { id: 'under', prompt: 'under route case', expectedTier: 'deep' },
      { id: 'over', prompt: 'over route case', expectedTier: 'fast' },
      { id: 'exact', prompt: 'exact route case', expectedTier: 'balanced', requiredCapabilities: ['web'] },
    ],
  });
  const metrics = response.result.structuredContent;
  assert.equal(metrics.caseCount, 3);
  assert.equal(metrics.harmfulUnderRouting.count, 1);
  assert.equal(metrics.overRouting.count, 1);
  assert.equal(metrics.capabilityRecall, 1);
  assert.equal(metrics.confusionMatrix.deep.fast, 1);
});

test('aggregate override learning stores categories only and can upgrade one tier', async () => {
  const store = new AggregatePreferenceStore();
  const value = await session(async () => baseDecision({ tier: 'balanced', effort: 'medium', taskCategories: ['analysis'] }), store);
  for (let index = 0; index < 3; index += 1) {
    const recorded = await tool(value, 2 + index, 'record_override', {
      categories: ['analysis'],
      recommendedTier: 'balanced',
      selectedTier: 'deep',
    });
    assert.equal(recorded.result.structuredContent.persistent, false);
    assert.equal(Object.hasOwn(recorded.result.structuredContent, 'prompt'), false);
  }
  const routed = await tool(value, 6, 'route_request', { prompt: 'Analyze this request.' });
  assert.equal(routed.result.structuredContent.tier, 'deep');
  assert.equal(routed.result.structuredContent.learningAdjustment.applied, true);
  assert.equal(routed.result.structuredContent.learningAdjustment.fromTier, 'balanced');
  assert.equal(routed.result.structuredContent.learningAdjustment.toTier, 'deep');
  const state = await tool(value, 7, 'get_preference_state');
  assert.equal(state.result.structuredContent.categories.analysis.overrides, 3);
  const reset = await tool(value, 8, 'reset_preference_state');
  assert.deepEqual(reset.result.structuredContent.categories, {});
});

test('aggregate learning cannot downgrade high-stakes or capability-bound routes', async () => {
  const store = new AggregatePreferenceStore();
  for (let index = 0; index < 4; index += 1) {
    await store.record({ categories: ['security'], recommendedTier: 'deep', selectedTier: 'balanced' });
  }
  const value = await session(
    async () =>
      baseDecision({
        tier: 'deep',
        effort: 'high',
        taskCategories: ['security'],
        capabilities: { web: false, files: false, vision: false, longContext: false, code: true },
      }),
    store,
  );
  const routed = await tool(value, 2, 'route_request', { prompt: 'Audit this authentication code.', profile: 'security' });
  assert.equal(routed.result.structuredContent.tier, 'deep');
  assert.equal(routed.result.structuredContent.learningAdjustment.applied, false);
  assert.equal(routed.result.structuredContent.learningAdjustment.reason, 'downward-safety-floor');
});

test('aggregate learning cannot downgrade a context-complexity floor even with no hard capability', async () => {
  // route.ts's context-complexity-floor (src/router/route.ts) raises the floor to 'deep' for
  // 'comparison' and 'reasoning' categories alone, with no capability set. The learning guard has to
  // recognize these as floor-protected too, or enough recorded downgrades erase a floor the router
  // deliberately raised.
  const store = new AggregatePreferenceStore();
  for (let index = 0; index < 4; index += 1) {
    await store.record({ categories: ['reasoning', 'comparison'], recommendedTier: 'deep', selectedTier: 'fast' });
  }
  const value = await session(
    async () =>
      baseDecision({
        tier: 'deep',
        effort: 'high',
        taskCategories: ['reasoning', 'comparison'],
        capabilities: { web: false, files: false, vision: false, longContext: false, code: false },
      }),
    store,
  );
  const routed = await tool(value, 2, 'route_request', { prompt: 'same as before' });
  assert.equal(routed.result.structuredContent.tier, 'deep');
  assert.equal(routed.result.structuredContent.learningAdjustment.applied, false);
  assert.equal(routed.result.structuredContent.learningAdjustment.reason, 'downward-safety-floor');
});

test('record_override rejects raw prompt fields and strict bounds reject invalid inputs', async () => {
  const value = await session();
  const raw = await tool(value, 2, 'record_override', {
    categories: ['analysis'],
    recommendedTier: 'balanced',
    selectedTier: 'deep',
    prompt: 'must not be accepted',
  });
  assert.equal(raw.result.isError, true);
  assert.match(raw.result.content[0].text, /unsupported property/i);

  const profile = await tool(value, 3, 'route_request', { prompt: 'test', profile: 'unknown' });
  assert.equal(profile.result.isError, true);
  assert.match(profile.result.content[0].text, /profile/i);

  const budget = await tool(value, 4, 'route_request', { prompt: 'test', budget: { maxStages: 5 } });
  assert.equal(budget.result.isError, true);
  assert.match(budget.result.content[0].text, /maxStages/i);

  const evaluation = await tool(value, 5, 'evaluate_router', {
    cases: Array.from({ length: 101 }, (_, index) => ({ prompt: `case ${index}`, expectedTier: 'fast' })),
  });
  assert.equal(evaluation.result.isError, true);
  assert.match(evaluation.result.content[0].text, /100/);
});
