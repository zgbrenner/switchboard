import assert from 'node:assert/strict';
import test from 'node:test';
import { createProxyController, validateProxyConfig } from '../.test-dist/proxy/index.js';

const config = validateProxyConfig({
  alias: 'switchboard',
  listen: { host: '127.0.0.1', port: 8788 },
  routes: {
    responses: {
      balanced: { baseUrl: 'https://upstream.invalid/v1', model: 'cheap' },
      deep: { baseUrl: 'https://upstream.invalid/v1', model: 'strong' },
      max: { baseUrl: 'https://upstream.invalid/v1', model: 'max' },
    },
  },
  session: { maxSessions: 10, ttlMs: 10000 },
});

const route = async () => ({
  tier: 'balanced',
  effort: 'medium',
  capabilities: { web: false, files: false, vision: false, longContext: false, code: true },
  confidence: 0.5,
  shouldUseJudge: false,
  reasons: [],
  scores: { fast: 0, balanced: 1, deep: 0, max: 0 },
  taskCategories: ['code'],
});

test('proxy controller rewrites the alias and adds routing headers', async () => {
  const controller = createProxyController(config, { route });
  const result = await controller.prepare({
    wire: 'responses',
    headers: {},
    clientFingerprint: 'client',
    body: { model: 'switchboard', prompt_cache_key: 's1', input: [{ role: 'user', content: 'Fix this code' }] },
  });
  assert.equal(result.upstream.model, 'cheap');
  assert.equal(result.body.model, 'cheap');
  assert.equal(result.headers['x-switchboard-tier'], 'balanced');
  assert.equal(result.headers['x-switchboard-session'], 's1');
});

test('repeated failed evidence escalates and rewrites to a stronger model', async () => {
  const controller = createProxyController(config, { route });
  const history = [
    { role: 'user', content: 'Fix this code' },
    { type: 'function_call', call_id: 'c1', name: 'run_tests', arguments: '{}' },
    { type: 'function_call_output', call_id: 'c1', output: { error: 'TypeError' } },
    { type: 'function_call', call_id: 'c2', name: 'run_tests', arguments: '{}' },
    { type: 'function_call_output', call_id: 'c2', output: { error: 'TypeError' } },
    { type: 'function_call', call_id: 'c3', name: 'run_tests', arguments: '{}' },
    { type: 'function_call_output', call_id: 'c3', output: { error: 'TypeError' } },
  ];
  const result = await controller.prepare({
    wire: 'responses',
    headers: {},
    clientFingerprint: 'c',
    body: { model: 'switchboard', prompt_cache_key: 's2', input: history },
  });
  assert.equal(result.decision.action, 'raise_effort');
  assert.equal(result.headers['x-switchboard-effort'], 'high');
  const next = await controller.prepare({
    wire: 'responses',
    headers: {},
    clientFingerprint: 'c',
    body: {
      model: 'switchboard',
      prompt_cache_key: 's2',
      input: [
        ...history,
        { type: 'function_call', call_id: 'c4', name: 'run_tests', arguments: '{}' },
        { type: 'function_call_output', call_id: 'c4', output: { error: 'TypeError' } },
      ],
    },
  });
  assert.equal(next.decision.action, 'switch_model');
  assert.equal(next.upstream.model, 'strong');
});

test('config rejects a non-loopback bind without a token and requires routes', () => {
  assert.throws(
    () =>
      validateProxyConfig({
        listen: { host: '0.0.0.0', port: 8788 },
        routes: { responses: { balanced: { baseUrl: 'https://x/v1', model: 'x' } } },
      }),
    /token/i,
  );
  assert.throws(() => validateProxyConfig({ listen: { host: '127.0.0.1', port: 8788 }, routes: {} }), /route/i);
});

test('judge escalation is reconciled into session state exactly once', async () => {
  let calls = 0;
  const judge = {
    evaluate() {
      calls++;
      return Promise.resolve({ action: 'switch_model', reason: 'stuck' });
    },
  };
  const warningConfig = validateProxyConfig({
    alias: 'switchboard',
    listen: { host: '127.0.0.1', port: 8788 },
    runtimePolicy: { maxConsecutiveFailures: 1, badCheckpointThreshold: 3, errorRepeatThreshold: 5 },
    routes: {
      responses: {
        balanced: { baseUrl: 'https://upstream.invalid/v1', model: 'cheap' },
        deep: { baseUrl: 'https://upstream.invalid/v1', model: 'strong' },
      },
    },
  });
  const controller = createProxyController(warningConfig, { route, judge });
  const history = [
    { role: 'user', content: 'Fix this code' },
    { type: 'function_call', call_id: 'j1', name: 'run_tests', arguments: '{}' },
    { type: 'function_call_output', call_id: 'j1', output: { error: 'TypeError' } },
  ];
  const result = await controller.prepare({
    wire: 'responses',
    headers: {},
    body: { model: 'switchboard', prompt_cache_key: 'judge-session', input: history },
  });
  assert.equal(calls, 1);
  assert.equal(result.decision.action, 'switch_model');
  assert.equal(result.snapshot.currentTier, 'deep');
  const repeated = await controller.prepare({
    wire: 'responses',
    headers: {},
    body: { model: 'switchboard', prompt_cache_key: 'judge-session', input: history },
  });
  assert.equal(calls, 1, 'deduplicated history is not judged twice');
  assert.equal(repeated.snapshot.switches, 1);
});
