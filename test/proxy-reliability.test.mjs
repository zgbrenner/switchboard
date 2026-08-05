import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ProxyHealthRegistry,
  RetryTokenBucket,
  executeReliableFetch,
  isRetryableStatus,
  retryAfterMilliseconds,
  validateProxyConfig,
} from '../.test-dist/proxy/index.js';

function setup(overrides = {}) {
  const config = validateProxyConfig({
    routing: { profile: 'reliability' },
    reliability: {
      maxAttempts: 3,
      requestTimeoutMs: 1000,
      initialBackoffMs: 100,
      maxBackoffMs: 1000,
      maxRetryAfterMs: 5000,
      retryBudget: { capacity: 5, refillPerSecond: 1 },
      ...overrides,
    },
    routes: {
      responses: {
        balanced: [
          { id: 'one', baseUrl: 'https://one.invalid/v1', model: 'one' },
          { id: 'two', baseUrl: 'https://two.invalid/v1', model: 'two' },
        ],
      },
    },
  });
  let now = 0;
  const health = new ProxyHealthRegistry({
    profile: config.routing.profile,
    circuitBreaker: config.reliability.circuitBreaker,
    now: () => now,
  });
  const sleeps = [];
  return {
    config,
    health,
    now: () => now,
    sleep: (milliseconds) => {
      sleeps.push(milliseconds);
      now += milliseconds;
      return Promise.resolve();
    },
    random: () => 0.5,
    sleeps,
  };
}

test('retry classification matches transient official SDK classes', () => {
  for (const status of [408, 409, 429, 500, 502, 503, 599]) assert.equal(isRetryableStatus(status), true);
  for (const status of [400, 401, 403, 404, 422]) assert.equal(isRetryableStatus(status), false);
});

test('Retry-After supports seconds and dates and is bounded by configuration', () => {
  const now = Date.parse('2026-08-04T00:00:00Z');
  assert.equal(retryAfterMilliseconds(new Headers({ 'retry-after': '2' }), now, 5000), 2000);
  assert.equal(retryAfterMilliseconds(new Headers({ 'retry-after': 'Tue, 04 Aug 2026 00:00:04 GMT' }), now, 5000), 4000);
  assert.equal(retryAfterMilliseconds(new Headers({ 'retry-after': '100' }), now, 5000), 5000);
  assert.equal(retryAfterMilliseconds(new Headers({ 'retry-after': 'nonsense' }), now, 5000), undefined);
});

test('retry token bucket refills over time and prevents retry storms', () => {
  let now = 0;
  const bucket = new RetryTokenBucket({ capacity: 2, refillPerSecond: 1, now: () => now });
  assert.equal(bucket.tryTake(), true);
  assert.equal(bucket.tryTake(), true);
  assert.equal(bucket.tryTake(), false);
  now = 1000;
  assert.equal(bucket.tryTake(), true);
  assert.equal(bucket.tryTake(), false);
});

test('retryable upstream failure falls back to a different healthy endpoint with full jitter', async () => {
  const harness = setup();
  const attempts = [];
  const result = await executeReliableFetch({
    upstreams: harness.config.routes.responses.balanced,
    health: harness.health,
    selection: { seed: 'session' },
    reliability: harness.config.reliability,
    now: harness.now,
    sleep: harness.sleep,
    random: harness.random,
    request: (upstream) => {
      attempts.push(upstream.id);
      if (attempts.length === 1) return Promise.resolve(new Response('unavailable', { status: 503 }));
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.attempts.length, 2);
  assert.notEqual(attempts[0], attempts[1]);
  assert.deepEqual(harness.sleeps, [50]);
});

test('terminal client errors return immediately without consuming retry budget', async () => {
  const harness = setup();
  let calls = 0;
  const result = await executeReliableFetch({
    upstreams: harness.config.routes.responses.balanced,
    health: harness.health,
    selection: { seed: 'session' },
    reliability: harness.config.reliability,
    now: harness.now,
    sleep: harness.sleep,
    random: harness.random,
    request: () => {
      calls++;
      return Promise.resolve(new Response('bad request', { status: 400 }));
    },
  });
  assert.equal(result.response.status, 400);
  assert.equal(calls, 1);
  assert.equal(harness.sleeps.length, 0);
});

test('rate limits honor Retry-After before fallback', async () => {
  const harness = setup();
  let calls = 0;
  const result = await executeReliableFetch({
    upstreams: harness.config.routes.responses.balanced,
    health: harness.health,
    selection: { seed: 'session' },
    reliability: harness.config.reliability,
    now: harness.now,
    sleep: harness.sleep,
    random: harness.random,
    request: () => {
      calls++;
      if (calls === 1) return Promise.resolve(new Response('limited', { status: 429, headers: { 'retry-after': '1' } }));
      return Promise.resolve(new Response('ok', { status: 200 }));
    },
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(harness.sleeps, [1000]);
});

test('per-attempt timeout aborts a hung request and can recover on another endpoint', async () => {
  const harness = setup({ requestTimeoutMs: 5, initialBackoffMs: 1 });
  let calls = 0;
  const result = await executeReliableFetch({
    upstreams: harness.config.routes.responses.balanced,
    health: harness.health,
    selection: { seed: 'timeout' },
    reliability: harness.config.reliability,
    now: harness.now,
    sleep: harness.sleep,
    random: () => 0,
    request: (_upstream, signal) => {
      calls++;
      if (calls > 1) return Promise.resolve(new Response('ok', { status: 200 }));
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  });
  assert.equal(result.response.status, 200);
  assert.equal(calls, 2);
});

test('a successful streaming response is returned intact and never spliced with a retry', async () => {
  const harness = setup();
  let calls = 0;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: first\n\n'));
      controller.close();
    },
  });
  const result = await executeReliableFetch({
    upstreams: harness.config.routes.responses.balanced,
    health: harness.health,
    selection: { seed: 'stream' },
    reliability: harness.config.reliability,
    now: harness.now,
    sleep: harness.sleep,
    random: harness.random,
    request: () => {
      calls++;
      return Promise.resolve(new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    },
  });
  assert.equal(calls, 1);
  assert.match(await result.response.text(), /first/u);
});
