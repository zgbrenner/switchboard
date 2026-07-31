import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const child = spawn(process.execPath, ['mcp/index.mjs', '--transport=stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
const pending = [];
lines.on('line', (line) => pending.shift()?.(JSON.parse(line)));
function send(message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${message.method}`)), 5_000);
    pending.push((response) => {
      clearTimeout(timer);
      resolve(response);
    });
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}
try {
  const initialized = await send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'switchboard-smoke', version: '1.0.0' } },
  });
  assert.equal(initialized.result.serverInfo.name, 'switchboard');
  assert.equal(initialized.result.serverInfo.version, '0.7.0');
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const tools = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.deepEqual(
    tools.result.tools.map((tool) => tool.name),
    [
      'route_request',
      'prepare_request',
      'explain_route',
      'compare_routes',
      'simulate_policy',
      'validate_model_inventory',
      'evaluate_router',
      'record_override',
      'get_preference_state',
      'reset_preference_state',
    ],
  );
  assert.equal(
    tools.result.tools.every((tool) => Boolean(tool.outputSchema)),
    true,
  );
  const routed = await send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'route_request',
      arguments: {
        prompt: 'Perform a focused security review and validate subtle authentication failures.',
        profile: 'security',
        planMode: 'multi',
        budget: { maxRelativeCost: 0.8, maxRelativeLatency: 0.8, minQuality: 0.7, maxStages: 3 },
        availableModels: [
          { id: 'fast-text', tier: 'fast', capabilities: { code: false } },
          { id: 'deep-code', tier: 'deep', effortLevels: ['high'], capabilities: { code: true }, relativeCost: 0.5, relativeLatency: 0.5 },
        ],
      },
    },
  });
  const decision = routed.result.structuredContent;
  assert.equal(decision.apiVersion, '2026-07-24');
  assert.equal(decision.modelResolution.recommended.id, 'deep-code');
  assert.ok(decision.executionPlan.stages.length >= 2);

  const prepared = await send({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'prepare_request',
      arguments: {
        prompt: 'In order to answer, it is important to note that this request should be concise. '.repeat(20),
        features: { routing: true, compression: true, brevity: true, fileToMarkdown: false },
        compression: { mode: 'deterministic', minimumCharacters: 1, minimumSavingsRatio: 0 },
        brevity: { level: 'concise' },
      },
    },
  });
  const pipeline = prepared.result.structuredContent;
  assert.equal(pipeline.pipelineVersion, '2026-07-31');
  assert.equal(pipeline.stages.routing.status, 'applied');
  assert.equal(pipeline.stages.compression.status, 'applied');
  assert.equal(pipeline.stages.brevity.status, 'applied');
  assert.match(pipeline.preparedPrompt, /switchboard:brevity:end/);
  assert.ok(pipeline.preparedPrompt.length < pipeline.stages.compression.originalCharacters + 300);

  const recorded = await send({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'record_override', arguments: { categories: ['security'], recommendedTier: 'deep', selectedTier: 'max' } },
  });
  assert.equal(recorded.result.structuredContent.totalOverrides, 1);
  const evaluation = await send({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'evaluate_router', arguments: { cases: [{ prompt: 'Fix grammar: She go.', expectedTier: 'fast' }] } },
  });
  assert.equal(evaluation.result.structuredContent.evaluationMode, 'baseline-with-preference-observation');
  const completion = await send({
    jsonrpc: '2.0',
    id: 7,
    method: 'completion/complete',
    params: { ref: { type: 'ref/prompt', name: 'route_before_answering' }, argument: { name: 'profile', value: 'sec' } },
  });
  assert.deepEqual(completion.result.completion.values, ['security']);
  console.log('Switchboard MCP 0.7 stdio smoke passed: routing, pipeline transforms, learning, evaluation, and completion.');
} finally {
  child.stdin.end();
  child.kill('SIGTERM');
  lines.close();
}
