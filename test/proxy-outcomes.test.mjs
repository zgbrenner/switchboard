import assert from 'node:assert/strict';
import test from 'node:test';
import { ProxyHealthRegistry, ProxyOutcomeLearner, validateProxyConfig } from '../.test-dist/proxy/index.js';

function pool() {
  return validateProxyConfig({
    routes: {
      responses: {
        balanced: [
          { id: 'alpha', baseUrl: 'https://alpha.invalid/v1', model: 'alpha' },
          { id: 'beta', baseUrl: 'https://beta.invalid/v1', model: 'beta' },
        ],
      },
    },
  }).routes.responses.balanced;
}

test('outcome learning ignores activity until a real execute or verify checkpoint exists', () => {
  const learner = new ProxyOutcomeLearner();
  learner.recordSelection('private-session', 'alpha', ['code', 'reasoning']);
  assert.equal(
    learner.observe('private-session', [
      { tool: 'write_file', kind: 'write', status: 'success' },
      { tool: 'read_file', kind: 'read', status: 'success' },
    ]),
    undefined,
  );
  assert.equal(learner.snapshot().totalOutcomes, 0);
  const update = learner.observe('private-session', [{ tool: 'run_tests', kind: 'verify', status: 'success' }]);
  assert.equal(update.endpointId, 'alpha');
  assert.equal(update.reward, 1);
  assert.equal(learner.snapshot().totalOutcomes, 1);
});

test('successful and failed verification move endpoint and category estimates in opposite directions', () => {
  const learner = new ProxyOutcomeLearner({ exploration: 0 });
  for (let index = 0; index < 6; index++) {
    learner.recordSelection(`success-${index}`, 'alpha', ['code']);
    learner.observe(`success-${index}`, [{ tool: 'run_tests', kind: 'verify', status: 'success' }]);
    learner.recordSelection(`failure-${index}`, 'beta', ['code']);
    learner.observe(`failure-${index}`, [{ tool: 'run_tests', kind: 'verify', status: 'failure', errorClass: 'AssertionError' }]);
  }
  const scores = learner.scores(pool(), ['code']);
  assert.ok(scores.alpha > scores.beta);
  const snapshot = learner.snapshot();
  const alpha = snapshot.endpoints.find((item) => item.id === 'alpha');
  const beta = snapshot.endpoints.find((item) => item.id === 'beta');
  assert.equal(alpha.successes, 6);
  assert.equal(beta.failures, 6);
  assert.ok(alpha.categories.code.mean > beta.categories.code.mean);
});

test('quality evidence influences health selection without overriding hard eligibility', () => {
  const routes = pool();
  const health = new ProxyHealthRegistry({
    profile: 'reliability',
    circuitBreaker: {
      failureThreshold: 3,
      cooldownMs: 1000,
      halfOpenMaxRequests: 1,
      ewmaAlpha: 0.25,
    },
  });
  const selected = health.select(routes, {
    seed: 'stable-session',
    qualityScores: { alpha: 0.98, beta: 0.02 },
  });
  assert.equal(selected.id, 'alpha');
});

test('learning state is bounded and contains no raw prompts, outputs, or session identifiers', () => {
  let now = 0;
  const learner = new ProxyOutcomeLearner({
    maxEndpoints: 2,
    maxCategoriesPerEndpoint: 2,
    maxPendingSessions: 2,
    pendingTtlMs: 100,
    now: () => now,
  });
  for (let index = 0; index < 5; index++) {
    const session = `private-session-${index}`;
    learner.recordSelection(session, `endpoint-${index}`, [`category-${index}`, 'second', 'third']);
    learner.observe(session, [
      {
        tool: 'run_tests',
        kind: 'verify',
        status: index % 2 === 0 ? 'success' : 'failure',
        arguments: { prompt: 'SECRET PROMPT' },
        output: 'SECRET OUTPUT',
      },
    ]);
    now += 50;
  }
  learner.recordSelection('expires', 'endpoint-final', ['code']);
  now += 101;
  learner.cleanup();
  const snapshot = learner.snapshot();
  assert.ok(snapshot.endpoints.length <= 2);
  assert.ok(snapshot.pendingSessions <= 2);
  for (const endpoint of snapshot.endpoints) assert.ok(Object.keys(endpoint.categories).length <= 2);
  const serialized = JSON.stringify(snapshot);
  for (const secret of ['SECRET PROMPT', 'SECRET OUTPUT', 'private-session', 'expires']) {
    assert.ok(!serialized.includes(secret), `learning state leaked ${secret}`);
  }
});

test('routing configuration enables outcome learning by default and permits a simple opt-out', () => {
  const enabled = validateProxyConfig({
    routes: { responses: { balanced: { baseUrl: 'https://x.invalid/v1', model: 'x' } } },
  });
  const disabled = validateProxyConfig({
    routing: { outcomeLearning: false },
    routes: { responses: { balanced: { baseUrl: 'https://x.invalid/v1', model: 'x' } } },
  });
  assert.equal(enabled.routing.outcomeLearning, true);
  assert.equal(disabled.routing.outcomeLearning, false);
});
