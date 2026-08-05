import assert from 'node:assert/strict';
import test from 'node:test';
import { ProxyHealthRegistry, validateProxyConfig } from '../.test-dist/proxy/index.js';

function pool() {
  const config = validateProxyConfig({
    routes: {
      responses: {
        balanced: [
          {
            id: 'fast-expensive',
            baseUrl: 'https://fast.invalid/v1',
            model: 'fast',
            weight: 1,
            inputCostPerMillion: 10,
            outputCostPerMillion: 10,
          },
          {
            id: 'slow-cheap',
            baseUrl: 'https://cheap.invalid/v1',
            model: 'cheap',
            weight: 1,
            inputCostPerMillion: 1,
            outputCostPerMillion: 1,
          },
        ],
      },
    },
  });
  return config.routes.responses.balanced;
}

function registry(profile, clock) {
  return new ProxyHealthRegistry({
    profile,
    now: () => clock.now,
    circuitBreaker: {
      failureThreshold: 2,
      cooldownMs: 1000,
      halfOpenMaxRequests: 1,
      ewmaAlpha: 0.5,
    },
  });
}

test('health state tracks EWMA latency, errors, load, and totals', () => {
  const clock = { now: 1000 };
  const health = registry('balanced', clock);
  const [route] = pool();
  health.beginAttempt(route.id);
  health.completeAttempt(route.id, { ok: true, latencyMs: 100, status: 200 });
  health.beginAttempt(route.id);
  health.completeAttempt(route.id, { ok: false, retryable: true, latencyMs: 300, status: 503 });
  const snapshot = health.snapshot(route.id);
  assert.equal(snapshot.inflight, 0);
  assert.equal(snapshot.requests, 2);
  assert.equal(snapshot.successes, 1);
  assert.equal(snapshot.failures, 1);
  assert.equal(snapshot.latencyEwmaMs, 200);
  assert.equal(snapshot.errorEwma, 0.5);
});

test('circuit opens, permits one half-open probe, closes on success, and reopens on failure', () => {
  const clock = { now: 0 };
  const health = registry('reliability', clock);
  const [route] = pool();
  for (let index = 0; index < 2; index++) {
    health.beginAttempt(route.id);
    health.completeAttempt(route.id, { ok: false, retryable: true, latencyMs: 10, status: 503 });
  }
  assert.equal(health.snapshot(route.id).circuitState, 'open');
  assert.equal(health.select([route], { seed: 'session' }), undefined);

  clock.now = 1001;
  const probe = health.select([route], { seed: 'session' });
  assert.equal(probe.id, route.id);
  health.beginAttempt(route.id);
  assert.equal(health.select([route], { seed: 'other' }), undefined);
  health.completeAttempt(route.id, { ok: true, latencyMs: 20, status: 200 });
  assert.equal(health.snapshot(route.id).circuitState, 'closed');

  for (let index = 0; index < 2; index++) {
    health.beginAttempt(route.id);
    health.completeAttempt(route.id, { ok: false, retryable: true, latencyMs: 10, status: 503 });
  }
  clock.now = 2002;
  health.beginAttempt(route.id);
  health.completeAttempt(route.id, { ok: false, retryable: true, latencyMs: 10, status: 503 });
  assert.equal(health.snapshot(route.id).circuitState, 'open');
});

test('Retry-After creates a bounded endpoint cooldown without opening unrelated endpoints', () => {
  const clock = { now: 5000 };
  const health = registry('reliability', clock);
  const routes = pool();
  health.beginAttempt(routes[0].id);
  health.completeAttempt(routes[0].id, {
    ok: false,
    retryable: true,
    rateLimited: true,
    retryAfterMs: 3000,
    latencyMs: 20,
    status: 429,
  });
  assert.equal(health.snapshot(routes[0].id).rateLimitUntil, 8000);
  assert.equal(health.select(routes, { seed: 'session' }).id, routes[1].id);
  clock.now = 8001;
  assert.ok(health.select(routes, { seed: 'session' }));
});

test('latency and cost profiles choose different healthy endpoints while ties remain session-stable', () => {
  const clock = { now: 0 };
  const routes = pool();
  const latency = registry('latency', clock);
  const cost = registry('cost', clock);
  for (const health of [latency, cost]) {
    health.beginAttempt(routes[0].id);
    health.completeAttempt(routes[0].id, { ok: true, latencyMs: 50, status: 200 });
    health.beginAttempt(routes[1].id);
    health.completeAttempt(routes[1].id, { ok: true, latencyMs: 500, status: 200 });
  }
  assert.equal(latency.select(routes, { seed: 'same-session' }).id, 'fast-expensive');
  assert.equal(cost.select(routes, { seed: 'same-session' }).id, 'slow-cheap');

  const balanced = registry('balanced', clock);
  const first = balanced.select(routes, { seed: 'stable-session' }).id;
  for (let index = 0; index < 10; index++) assert.equal(balanced.select(routes, { seed: 'stable-session' }).id, first);
});
