import assert from 'node:assert/strict';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

process.env.SWITCHBOARD_ROUTER_MODULE = '.test-dist/router/route.js';
const { createSwitchboardMcpSession } = await import('../mcp/server.mjs');
const { startHttpServer } = await import('../mcp/http.mjs');
const { serveStdio } = await import('../mcp/stdio.mjs');

const request = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });

async function call(session, id, method, params) {
  return await session.handle(request(id, method, params));
}

async function readySession(protocolVersion = '2025-11-25') {
  const session = createSwitchboardMcpSession();
  await call(session, 0, 'initialize', { protocolVersion, capabilities: {}, clientInfo: { name: 'test-client', version: '1.0.0' } });
  await session.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return session;
}

function httpHeaders(extra = {}) {
  return { 'content-type': 'application/json', accept: 'application/json, text/event-stream', origin: 'http://localhost', ...extra };
}

test('initializes with current MCP capabilities and negotiates compatible versions', async () => {
  const session = createSwitchboardMcpSession();
  const response = await call(session, 1, 'initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  assert.deepEqual(response.result.capabilities, { tools: {}, resources: {}, prompts: {}, completions: {} });
  assert.equal(response.result.serverInfo.name, 'switchboard');
  assert.equal(response.result.serverInfo.version, '0.5.0');
  assert.match(response.result.instructions, /route_request/);

  const older = createSwitchboardMcpSession();
  const olderResponse = await call(older, 2, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'old', version: '1' },
  });
  assert.equal(olderResponse.result.protocolVersion, '2025-06-18');
});

test('lists and calls the route_request tool with structured and text content', async () => {
  const session = await readySession();
  const listed = await call(session, 1, 'tools/list', {});
  assert.equal(
    listed.result.tools.some((tool) => tool.name === 'route_request'),
    true,
  );
  assert.equal(listed.result.tools.find((tool) => tool.name === 'route_request').annotations.readOnlyHint, true);
  assert.equal(listed.result.tools.find((tool) => tool.name === 'record_override').annotations.readOnlyHint, false);
  assert.equal(listed.result.tools.find((tool) => tool.name === 'reset_preference_state').annotations.destructiveHint, true);
  assert.equal(
    listed.result.tools.every((tool) => tool.outputSchema?.$schema === 'https://json-schema.org/draft/2020-12/schema'),
    true,
  );

  const response = await call(session, 2, 'tools/call', {
    name: 'route_request',
    arguments: { prompt: 'Fix the grammar in this sentence: She go to work.' },
  });
  assert.equal(response.result.isError, false);
  assert.equal(response.result.structuredContent.tier, 'fast');
  assert.equal(response.result.structuredContent.effort, 'low');
  assert.equal(response.result.structuredContent.modelResolution.status, 'not-provided');
  assert.equal(response.result.structuredContent.apiVersion, '2026-07-24');
  assert.deepEqual(JSON.parse(response.result.content[0].text), response.result.structuredContent);
});

test('normalizes bounded context, files, policies, and category boosts', async () => {
  const session = await readySession();
  const response = await call(session, 1, 'tools/call', {
    name: 'route_request',
    arguments: {
      prompt: 'Now redo that using the other interpretation.',
      context: [{ role: 'user', text: 'Perform a detailed legal comparison.' }],
      files: [
        {
          name: 'memo.pdf',
          size: 200000,
          detectedType: 'pdf',
          textLength: 30000,
          excerpt: 'contract clauses',
          capabilities: { vision: true, longContext: true },
        },
      ],
      policy: 'best',
      categoryBoosts: { legal: 0.2 },
    },
  });
  assert.equal(response.result.structuredContent.capabilities.files, true);
  assert.equal(response.result.structuredContent.capabilities.longContext, true);
  assert.equal(response.result.structuredContent.capabilities.vision, true);
  assert.ok(['deep', 'max'].includes(response.result.structuredContent.tier));
});

test('returns tool errors for invalid arguments without crashing the MCP session', async () => {
  const session = await readySession();
  const invalid = await call(session, 1, 'tools/call', { name: 'route_request', arguments: { prompt: '' } });
  assert.equal(invalid.result.isError, true);
  assert.match(invalid.result.content[0].text, /prompt/i);

  const tooMuchContext = await call(session, 2, 'tools/call', {
    name: 'route_request',
    arguments: { prompt: 'test', context: Array.from({ length: 9 }, () => ({ role: 'user', text: 'x' })) },
  });
  assert.equal(tooMuchContext.result.isError, true);
  assert.match(tooMuchContext.result.content[0].text, /context/i);
});

test('exposes routing resources and one reusable routing prompt', async () => {
  const session = await readySession();
  const resources = await call(session, 1, 'resources/list', {});
  assert.deepEqual(
    resources.result.resources.map((resource) => resource.uri),
    [
      'switchboard://policies',
      'switchboard://profiles',
      'switchboard://capabilities',
      'switchboard://api',
      'switchboard://adapter-contract',
      'switchboard://preferences',
      'switchboard://server',
    ],
  );
  const read = await call(session, 2, 'resources/read', { uri: 'switchboard://policies' });
  assert.equal(read.result.contents[0].mimeType, 'application/json');
  assert.deepEqual(Object.keys(JSON.parse(read.result.contents[0].text)), ['best', 'balanced', 'fast', 'conserve']);

  const prompts = await call(session, 3, 'prompts/list', {});
  assert.deepEqual(
    prompts.result.prompts.map((prompt) => prompt.name),
    ['route_before_answering'],
  );
  const prompt = await call(session, 4, 'prompts/get', {
    name: 'route_before_answering',
    arguments: { request: 'Audit this code.', policy: 'best', profile: 'security' },
  });
  assert.match(prompt.result.messages[0].content.text, /route_request/);
  assert.match(prompt.result.messages[0].content.text, /Audit this code/);
  assert.match(prompt.result.messages[0].content.text, /security/);
});

test('uses standard JSON-RPC errors for unknown methods and missing resources', async () => {
  const session = await readySession();
  const unknown = await call(session, 1, 'unknown/method', {});
  assert.equal(unknown.error.code, -32601);
  // -32602, not -32002: this server uses -32002 for "not initialized", and one code cannot mean
  // two different things to a client trying to react to the failure.
  const missing = await call(session, 2, 'resources/read', { uri: 'switchboard://missing' });
  assert.equal(missing.error.code, -32602);
  assert.equal(await session.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('serves stateful Streamable HTTP on localhost and rejects untrusted origins', async (t) => {
  const server = startHttpServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/mcp`;

  const initialize = await fetch(url, {
    method: 'POST',
    headers: httpHeaders(),
    body: JSON.stringify(
      request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'http-test', version: '1' } }),
    ),
  });
  assert.equal(initialize.status, 200);
  assert.equal((await initialize.clone().json()).result.serverInfo.name, 'switchboard');
  const sessionId = initialize.headers.get('mcp-session-id');

  const initialized = await fetch(url, {
    method: 'POST',
    headers: httpHeaders({ 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' }),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(initialized.status, 202);

  const blocked = await fetch(url, {
    method: 'POST',
    headers: httpHeaders({ origin: 'https://attacker.example', 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' }),
    body: JSON.stringify(request(2, 'ping', {})),
  });
  assert.equal(blocked.status, 403);
});

test('stdio transport emits only newline-delimited JSON-RPC and recovers after parse errors', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const errors = new PassThrough();
  let text = '';
  output.setEncoding('utf8');
  output.on('data', (chunk) => {
    text += chunk;
  });
  const serving = serveStdio({ input, output, error: errors });
  input.write('{not json}\n');
  input.write(`${JSON.stringify(request(3, 'ping', {}))}\n`);
  input.end();
  await serving;
  const lines = text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(lines[0].error.code, -32700);
  assert.deepEqual(lines[1], { jsonrpc: '2.0', id: 3, result: {} });
});

test('HTTP transport rejects unsupported protocol headers and non-POST polling', async (t) => {
  const server = startHttpServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/mcp`;
  const initialize = await fetch(url, {
    method: 'POST',
    headers: httpHeaders(),
    body: JSON.stringify(
      request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'http-test', version: '1' } }),
    ),
  });
  const sessionId = initialize.headers.get('mcp-session-id');
  const invalidVersion = await fetch(url, {
    method: 'POST',
    headers: httpHeaders({ 'mcp-session-id': sessionId, 'mcp-protocol-version': '1999-01-01' }),
    body: JSON.stringify(request(2, 'ping', {})),
  });
  assert.equal(invalidVersion.status, 400);
  assert.equal((await fetch(url)).status, 405);
});
