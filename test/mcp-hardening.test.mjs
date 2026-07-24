import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

process.env.SWITCHBOARD_ROUTER_MODULE = '.test-dist/router/route.js';
const { createSwitchboardMcpSession } = await import('../mcp/server.mjs');
const { startHttpServer } = await import('../mcp/http.mjs');

const request = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });

async function initializedSession() {
  const session = createSwitchboardMcpSession();
  const initialized = await session.handle(request(1, 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'hardening-test', version: '1.0.0' },
  }));
  assert.equal(initialized.result.protocolVersion, '2025-11-25');
  assert.equal(initialized.result.serverInfo.version, '0.5.0');
  assert.equal(await session.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  return session;
}

function httpHeaders(extra = {}) {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    origin: 'http://localhost',
    ...extra,
  };
}

test('stateful sessions enforce initialize and initialized lifecycle ordering', async () => {
  const session = createSwitchboardMcpSession();
  assert.deepEqual(await session.handle(request(1, 'ping', {})), { jsonrpc: '2.0', id: 1, result: {} });

  const beforeInitialize = await session.handle(request(2, 'tools/list', {}));
  assert.equal(beforeInitialize.error.code, -32002);
  assert.match(beforeInitialize.error.message, /not initialized/i);

  const initialize = await session.handle(request(3, 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' },
  }));
  assert.deepEqual(initialize.result.capabilities, { tools: {}, resources: {}, prompts: {}, completions: {} });

  const beforeReady = await session.handle(request(4, 'tools/list', {}));
  assert.equal(beforeReady.error.code, -32002);
  assert.match(beforeReady.error.message, /initialized notification/i);

  assert.equal(await session.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal((await session.handle(request(5, 'tools/list', {}))).result.tools[0].name, 'route_request');

  const duplicate = await session.handle(request(6, 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' },
  }));
  assert.equal(duplicate.error.code, -32600);
});

test('strict JSON-RPC validation rejects null IDs, invalid params, and malformed initialization', async () => {
  const session = createSwitchboardMcpSession();
  assert.equal((await session.handle({ jsonrpc: '2.0', id: null, method: 'ping' })).error.code, -32600);
  assert.equal((await session.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: [] })).error.code, -32602);
  const missingClient = await session.handle(request(2, 'initialize', { protocolVersion: '2025-11-25', capabilities: {} }));
  assert.equal(missingClient.error.code, -32602);
});

test('route_request resolves an optional host model inventory without selecting under-capable models', async () => {
  const session = await initializedSession();
  const response = await session.handle(request(2, 'tools/call', {
    name: 'route_request',
    arguments: {
      prompt: 'Perform a focused security review and validate subtle authentication failures.',
      availableModels: [
        { id: 'fast', title: 'Fast model', tier: 'fast', effortLevels: ['low'], capabilities: { code: true } },
        { id: 'deep-no-code', title: 'Deep text model', tier: 'deep', effortLevels: ['high'], capabilities: { code: false } },
        { id: 'deep-code', title: 'Deep code model', family: 'reasoning', tier: 'deep', effortLevels: ['medium', 'high'], capabilities: { code: true }, relativeCost: 0.5, relativeLatency: 0.5 },
      ],
    },
  }));
  const resolution = response.result.structuredContent.modelResolution;
  assert.equal(resolution.status, 'recommended');
  assert.equal(resolution.recommended.id, 'deep-code');
  assert.equal(resolution.recommended.meetsRequirements, true);
  assert.equal(resolution.alternatives.some((model) => model.id === 'deep-no-code'), false);
});

test('model resolution respects policy and existing-model continuity when choices are adequate', async () => {
  const session = await initializedSession();
  const availableModels = [
    { id: 'balanced', tier: 'balanced', effortLevels: ['medium'], capabilities: {}, relativeCost: 0.1, relativeLatency: 0.1 },
    { id: 'max', tier: 'max', effortLevels: ['high', 'max'], capabilities: {}, relativeCost: 0.95, relativeLatency: 0.9 },
  ];
  const fast = await session.handle(request(2, 'tools/call', {
    name: 'route_request', arguments: { prompt: 'Explain this familiar concept clearly.', policy: 'fast', availableModels },
  }));
  assert.equal(fast.result.structuredContent.modelResolution.recommended.id, 'balanced');

  const best = await session.handle(request(3, 'tools/call', {
    name: 'route_request', arguments: { prompt: 'Explain this familiar concept clearly.', policy: 'best', availableModels },
  }));
  assert.equal(best.result.structuredContent.modelResolution.recommended.id, 'max');

  const continuity = await session.handle(request(4, 'tools/call', {
    name: 'route_request', arguments: {
      prompt: 'Explain this familiar concept clearly.', policy: 'balanced', currentModelId: 'balanced',
      context: [{ role: 'user', text: 'We are already discussing this topic.' }], availableModels,
    },
  }));
  assert.equal(continuity.result.structuredContent.modelResolution.recommended.id, 'balanced');
});

test('empty or incompatible model inventories return explicit resolution states', async () => {
  const session = await initializedSession();
  const omitted = await session.handle(request(2, 'tools/call', { name: 'route_request', arguments: { prompt: 'Fix this grammar.' } }));
  assert.equal(omitted.result.structuredContent.modelResolution.status, 'not-provided');

  const incompatible = await session.handle(request(3, 'tools/call', {
    name: 'route_request', arguments: {
      prompt: 'Debug this TypeScript authentication vulnerability.',
      availableModels: [{ id: 'text-only', tier: 'max', capabilities: { code: false } }],
    },
  }));
  assert.equal(incompatible.result.structuredContent.modelResolution.status, 'no-compatible-model');
  assert.equal(incompatible.result.structuredContent.modelResolution.recommended, null);
});

test('server metadata resource, additive output schema, and policy completion are discoverable', async () => {
  const session = await initializedSession();
  const tools = await session.handle(request(2, 'tools/list', {}));
  const output = tools.result.tools[0].outputSchema;
  assert.equal(output.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(output.required.includes('modelResolution'), true);
  assert.equal(output.required.includes('executionPlan'), true);
  assert.equal(output.required.includes('confidenceEvidence'), true);
  assert.equal(output.properties.capabilities.additionalProperties, false);

  const resources = await session.handle(request(3, 'resources/list', {}));
  assert.equal(resources.result.resources.some((resource) => resource.uri === 'switchboard://server'), true);
  assert.equal(resources.result.resources.some((resource) => resource.uri === 'switchboard://api'), true);
  const server = await session.handle(request(4, 'resources/read', { uri: 'switchboard://server' }));
  const metadata = JSON.parse(server.result.contents[0].text);
  assert.equal(metadata.privacy.persistsPrompts, false);
  assert.equal(metadata.privacy.persistsEvaluationCases, false);
  assert.equal(metadata.protocolVersions.includes('2025-11-25'), true);
  assert.equal(metadata.api.current, '2026-07-24');

  const completion = await session.handle(request(5, 'completion/complete', {
    ref: { type: 'ref/prompt', name: 'route_before_answering' }, argument: { name: 'policy', value: 'b' },
  }));
  assert.deepEqual(completion.result.completion.values, ['balanced', 'best']);
});

test('HTTP transport creates secure sessions and requires session and protocol headers', async (t) => {
  const server = startHttpServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/mcp`;

  const initialize = await fetch(url, {
    method: 'POST', headers: httpHeaders(),
    body: JSON.stringify(request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'http', version: '1' } })),
  });
  assert.equal(initialize.status, 200);
  const sessionId = initialize.headers.get('mcp-session-id');
  assert.match(sessionId, /^[\x21-\x7e]+$/u);

  const missingSession = await fetch(url, {
    method: 'POST', headers: httpHeaders({ 'mcp-protocol-version': '2025-11-25' }),
    body: JSON.stringify(request(2, 'tools/list', {})),
  });
  assert.equal(missingSession.status, 400);

  const missingVersion = await fetch(url, {
    method: 'POST', headers: httpHeaders({ 'mcp-session-id': sessionId }),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(missingVersion.status, 400);

  const initialized = await fetch(url, {
    method: 'POST', headers: httpHeaders({ 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' }),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(initialized.status, 202);

  const listed = await fetch(url, {
    method: 'POST', headers: httpHeaders({ 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' }),
    body: JSON.stringify(request(3, 'tools/list', {})),
  });
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).result.tools[0].name, 'route_request');

  const deleted = await fetch(url, { method: 'DELETE', headers: httpHeaders({ 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' }) });
  assert.equal(deleted.status, 204);
  const expired = await fetch(url, {
    method: 'POST', headers: httpHeaders({ 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' }),
    body: JSON.stringify(request(4, 'ping', {})),
  });
  assert.equal(expired.status, 404);
});

test('HTTP transport validates Accept, authentication, expiry, and non-loopback safety', async (t) => {
  assert.throws(() => startHttpServer({ host: '0.0.0.0', port: 0 }), /authentication/i);
  const server = startHttpServer({ host: '127.0.0.1', port: 0, token: 'test-secret', sessionTtlMs: 5 });
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/mcp`;
  const body = JSON.stringify(request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'http', version: '1' } }));

  assert.equal((await fetch(url, { method: 'POST', headers: httpHeaders(), body })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers: httpHeaders({ authorization: 'Bearer wrong' }), body })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers: { ...httpHeaders({ authorization: 'Bearer test-secret' }), accept: 'application/json' }, body })).status, 406);

  const initialize = await fetch(url, { method: 'POST', headers: httpHeaders({ authorization: 'Bearer test-secret' }), body });
  assert.equal(initialize.status, 200);
  const sessionId = initialize.headers.get('mcp-session-id');
  await new Promise((resolve) => setTimeout(resolve, 12));
  const expired = await fetch(url, {
    method: 'POST',
    headers: httpHeaders({ authorization: 'Bearer test-secret', 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' }),
    body: JSON.stringify(request(2, 'ping', {})),
  });
  assert.equal(expired.status, 404);
});
