import assert from 'node:assert/strict';
import test from 'node:test';
import { ProxyTelemetry } from '../.test-dist/proxy/index.js';

function attempt(overrides = {}) {
  return {
    wire: 'responses',
    sessionId: 'raw-customer-session-id',
    endpointId: 'primary',
    provider: 'api.openai.com',
    requestModel: 'switchboard',
    responseModel: 'upstream-model',
    tier: 'balanced',
    decision: 'continue',
    judgeSource: 'deterministic',
    status: 200,
    latencyMs: 123,
    attempts: 1,
    fallback: false,
    inputTokens: 100,
    outputTokens: 25,
    cost: 0.001,
    prompt: 'PRIVATE PROMPT SHOULD NEVER APPEAR',
    response: 'PRIVATE RESPONSE SHOULD NEVER APPEAR',
    apiKey: 'sk-private',
    toolArguments: { private: true },
    ...overrides,
  };
}

test('telemetry emits bounded OpenTelemetry-shaped attributes without content or raw session IDs', () => {
  const delivered = [];
  const telemetry = new ProxyTelemetry({ maxEvents: 2, sink: (event) => delivered.push(event) });
  telemetry.record(attempt());
  const event = telemetry.events()[0];
  assert.equal(event.name, 'gen_ai.client.operation');
  assert.equal(event.attributes['gen_ai.operation.name'], 'responses');
  assert.equal(event.attributes['gen_ai.provider.name'], 'api.openai.com');
  assert.equal(event.attributes['gen_ai.request.model'], 'switchboard');
  assert.equal(event.attributes['gen_ai.response.model'], 'upstream-model');
  assert.equal(event.attributes['gen_ai.usage.input_tokens'], 100);
  assert.equal(event.attributes['gen_ai.usage.output_tokens'], 25);
  assert.equal(event.attributes['http.response.status_code'], 200);
  assert.equal(event.attributes['switchboard.upstream.id'], 'primary');
  assert.match(event.sessionHash, /^[a-f0-9]{16}$/u);

  const serialized = JSON.stringify({ event, delivered });
  for (const secret of [
    'raw-customer-session-id',
    'PRIVATE PROMPT SHOULD NEVER APPEAR',
    'PRIVATE RESPONSE SHOULD NEVER APPEAR',
    'sk-private',
    'toolArguments',
  ]) {
    assert.ok(!serialized.includes(secret), `telemetry leaked ${secret}`);
  }
});

test('telemetry is bounded, summarizes attempts, and isolates sink failures', () => {
  let sinkCalls = 0;
  const telemetry = new ProxyTelemetry({
    maxEvents: 2,
    sink: () => {
      sinkCalls++;
      throw new Error('collector offline');
    },
  });
  assert.doesNotThrow(() => telemetry.record(attempt()));
  telemetry.record(
    attempt({ status: 503, attempts: 2, fallback: true, inputTokens: 50, outputTokens: 0, cost: 0.002, errorClass: 'HTTP_503' }),
  );
  telemetry.record(attempt({ status: 200, latencyMs: 77, inputTokens: 10, outputTokens: 5, cost: 0.0005 }));
  assert.equal(sinkCalls, 3);
  assert.equal(telemetry.events().length, 2);
  const summary = telemetry.summary();
  assert.equal(summary.requests, 3);
  assert.equal(summary.failed, 1);
  assert.equal(summary.fallbacks, 1);
  assert.equal(summary.attempts, 4);
  assert.equal(summary.inputTokens, 160);
  assert.equal(summary.outputTokens, 30);
  assert.equal(summary.cost, 0.0035);
  assert.equal(summary.averageLatencyMs, (123 + 123 + 77) / 3);
});
