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
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const route = async () => ({
  tier: 'balanced',
  effort: 'medium',
  capabilities: { web: false, files: false, vision: false, longContext: false, code: false },
  confidence: 0.5,
  shouldUseJudge: false,
  reasons: [],
  scores: { fast: 0, balanced: 1, deep: 0, max: 0 },
  taskCategories: [],
});

test('proxy server authenticates, forwards Responses requests, and exposes privacy-safe session inspection', async () => {
  let received;
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 'response-1', usage: { input_tokens: 10, output_tokens: 4 } }));
  });
  const upstreamPort = await listen(upstream);
  const config = validateProxyConfig({
    listen: { host: '127.0.0.1', port: 0, token: 'proxy-secret' },
    routes: {
      responses: {
        balanced: {
          baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
          model: 'upstream-model',
          inputCostPerMillion: 1,
          outputCostPerMillion: 2,
        },
      },
    },
  });
  const proxy = createSwitchboardProxyServer(config, { route });
  const address = await proxy.listen();
  try {
    const unauthorized = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(unauthorized.status, 401);
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/responses`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer proxy-secret',
        'content-type': 'application/json',
        'x-switchboard-session': 'server-test',
      },
      body: JSON.stringify({ model: 'switchboard', input: [{ role: 'user', content: 'private task text' }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-switchboard-model'), 'upstream-model');
    assert.equal(received.model, 'upstream-model');
    const inspection = await fetch(`http://127.0.0.1:${address.port}/v1/switchboard/sessions/server-test`, {
      headers: { authorization: 'Bearer proxy-secret' },
    });
    assert.equal(inspection.status, 200);
    const payload = await inspection.json();
    assert.ok(payload.snapshot.relativeCost > 0);
    assert.ok(!JSON.stringify(payload).includes('private task text'));
  } finally {
    await proxy.close();
    await close(upstream);
  }
});

test('streaming responses pass through while usage is metered asynchronously', async () => {
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: {"type":"response.completed","response":{"usage":{"input_tokens":100,"output_tokens":20}}}\n\n');
    response.end('data: [DONE]\n\n');
  });
  const upstreamPort = await listen(upstream);
  const config = validateProxyConfig({
    listen: { host: '127.0.0.1', port: 0 },
    routes: {
      responses: {
        balanced: {
          baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
          model: 'stream-model',
          inputCostPerMillion: 1,
          outputCostPerMillion: 1,
        },
      },
    },
  });
  const proxy = createSwitchboardProxyServer(config, { route });
  const address = await proxy.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-switchboard-session': 'stream-test' },
      body: JSON.stringify({
        model: 'switchboard',
        stream: true,
        input: [{ role: 'user', content: 'stream it' }],
      }),
    });
    const text = await response.text();
    assert.match(text, /response\.completed/);
    await delay(30);
    const inspection = proxy.controller.inspectSession('stream-test');
    assert.ok(inspection.snapshot.relativeCost > 0);
  } finally {
    await proxy.close();
    await close(upstream);
  }
});
