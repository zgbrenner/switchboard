import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createSwitchboardProxyServer, validateProxyConfig } from '../.test-dist/proxy/index.js';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function route() {
  return Promise.resolve({
    tier: 'balanced',
    effort: 'medium',
    capabilities: { web: false, files: false, vision: false, longContext: false, code: false },
    confidence: 0.5,
    shouldUseJudge: false,
    reasons: [],
    scores: { fast: 0, balanced: 1, deep: 0, max: 0 },
    taskCategories: [],
  });
}

test('live proxy retries a transient failure on another endpoint and reports the actual route', async () => {
  let primaryCalls = 0;
  let backupCalls = 0;
  let backupBody;
  const primary = createServer((_request, response) => {
    primaryCalls++;
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'temporarily unavailable' }));
  });
  const backup = createServer(async (request, response) => {
    backupCalls++;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    backupBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 'backup-response', usage: { input_tokens: 20, output_tokens: 5 } }));
  });
  const primaryPort = await listen(primary);
  const backupPort = await listen(backup);
  const config = validateProxyConfig({
    listen: { host: '127.0.0.1', port: 0 },
    routing: { profile: 'reliability' },
    reliability: { maxAttempts: 2, initialBackoffMs: 0, maxBackoffMs: 0 },
    routes: {
      responses: {
        balanced: [
          { id: 'primary', baseUrl: `http://127.0.0.1:${primaryPort}/v1`, model: 'primary-model', weight: 100 },
          { id: 'backup', baseUrl: `http://127.0.0.1:${backupPort}/v1`, model: 'backup-model', weight: 1 },
        ],
      },
    },
  });
  const proxy = createSwitchboardProxyServer(config, { route });
  const address = await proxy.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-switchboard-session': 'adaptive-server' },
      body: JSON.stringify({ model: 'switchboard', input: [{ role: 'user', content: 'private failover task' }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(primaryCalls, 1);
    assert.equal(backupCalls, 1);
    assert.equal(backupBody.model, 'backup-model');
    assert.equal(response.headers.get('x-switchboard-upstream'), 'backup');
    assert.equal(response.headers.get('x-switchboard-attempts'), '2');
    assert.equal(response.headers.get('x-switchboard-fallback'), 'true');

    const status = await fetch(`http://127.0.0.1:${address.port}/v1/switchboard/status`);
    assert.equal(status.status, 200);
    const payload = await status.json();
    assert.equal(payload.routing.profile, 'reliability');
    assert.ok(payload.retryBudget.available >= 0);
    assert.equal(payload.endpoints.find((item) => item.id === 'primary').failures, 1);
    assert.equal(payload.endpoints.find((item) => item.id === 'backup').successes, 1);
    assert.ok(!JSON.stringify(payload).includes('private failover task'));
  } finally {
    await proxy.close();
    await close(primary);
    await close(backup);
  }
});

test('a capability mismatch fails locally with 422 and never reaches an upstream', async () => {
  let calls = 0;
  const upstream = createServer((_request, response) => {
    calls++;
    response.end('unexpected');
  });
  const port = await listen(upstream);
  const config = validateProxyConfig({
    listen: { host: '127.0.0.1', port: 0 },
    routing: { strictCapabilities: true },
    routes: {
      responses: {
        balanced: {
          id: 'text-only',
          baseUrl: `http://127.0.0.1:${port}/v1`,
          model: 'text-only',
          capabilities: { tools: false },
        },
      },
    },
  });
  const proxy = createSwitchboardProxyServer(config, { route });
  const address = await proxy.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'switchboard',
        tools: [{ type: 'function', name: 'lookup' }],
        input: [{ role: 'user', content: 'use the tool' }],
      }),
    });
    assert.equal(response.status, 422);
    assert.equal(calls, 0);
    const payload = await response.json();
    assert.equal(payload.error.type, 'switchboard_no_compatible_upstream');
  } finally {
    await proxy.close();
    await close(upstream);
  }
});
