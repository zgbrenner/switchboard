import assert from 'node:assert/strict';
import test from 'node:test';
import { validateProxyConfig } from '../.test-dist/proxy/index.js';

function route(model, overrides = {}) {
  return { baseUrl: 'https://upstream.invalid/v1', model, ...overrides };
}

test('legacy single-route configuration normalizes to a stable one-endpoint pool', () => {
  const config = validateProxyConfig({
    routes: { responses: { balanced: route('primary') } },
  });
  const pool = config.routes.responses.balanced;
  assert.equal(Array.isArray(pool), true);
  assert.equal(pool.length, 1);
  assert.match(pool[0].id, /^responses-balanced-[a-f0-9]{12}$/u);
  assert.equal(pool[0].model, 'primary');
  assert.equal(pool[0].weight, 1);
  assert.equal(config.routing.profile, 'balanced');
  assert.equal(config.routing.sessionStickiness, true);
});

test('endpoint arrays preserve order, resolve secrets, and reject duplicate IDs', () => {
  const config = validateProxyConfig(
    {
      routing: { profile: 'reliability' },
      routes: {
        responses: {
          balanced: [
            route('primary', { id: 'primary', apiKeyEnv: 'PRIMARY_KEY', weight: 3 }),
            route('backup', { id: 'backup', apiKeyEnv: 'BACKUP_KEY', weight: 1 }),
          ],
        },
      },
    },
    { PRIMARY_KEY: 'one', BACKUP_KEY: 'two' },
  );
  const pool = config.routes.responses.balanced;
  assert.deepEqual(
    pool.map((item) => item.id),
    ['primary', 'backup'],
  );
  assert.deepEqual(
    pool.map((item) => item.apiKey),
    ['one', 'two'],
  );
  assert.equal(config.reliability.maxAttempts, 3);

  assert.throws(
    () =>
      validateProxyConfig({
        routes: { responses: { balanced: [route('one', { id: 'same' }), route('two', { id: 'same' })] } },
      }),
    /duplicate.*same/iu,
  );
});

test('profiles keep a simple surface while producing bounded advanced defaults', () => {
  for (const profile of ['balanced', 'reliability', 'latency', 'cost']) {
    const config = validateProxyConfig({
      routing: { profile },
      routes: { responses: { balanced: route('primary') } },
    });
    assert.equal(config.routing.profile, profile);
    assert.ok(config.reliability.maxAttempts >= 1 && config.reliability.maxAttempts <= 5);
    assert.ok(config.reliability.requestTimeoutMs >= 1000);
    assert.ok(config.reliability.maxBackoffMs >= config.reliability.initialBackoffMs);
    assert.ok(config.reliability.retryBudget.capacity >= 1);
    assert.ok(config.reliability.circuitBreaker.failureThreshold >= 1);
  }
});

test('capability and privacy metadata are strictly normalized', () => {
  const config = validateProxyConfig({
    routes: {
      responses: {
        balanced: route('capable', {
          capabilities: {
            tools: true,
            vision: false,
            json: true,
            reasoning: true,
            maxContextTokens: 128000,
            maxOutputTokens: 16000,
            dataRetention: 'zero',
          },
        }),
      },
    },
  });
  assert.deepEqual(config.routes.responses.balanced[0].capabilities, {
    tools: true,
    vision: false,
    json: true,
    reasoning: true,
    maxContextTokens: 128000,
    maxOutputTokens: 16000,
    dataRetention: 'zero',
  });
  assert.throws(
    () =>
      validateProxyConfig({
        routes: { responses: { balanced: route('bad', { capabilities: { dataRetention: 'sometimes' } }) } },
      }),
    /dataRetention/iu,
  );
});
