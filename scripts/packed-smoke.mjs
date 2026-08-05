import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const packageRoot = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: node scripts/packed-smoke.mjs <installed-package-root>');
const entrypoint = resolve(packageRoot, 'mcp/index.mjs');
const child = spawn(process.execPath, [entrypoint, '--transport=stdio'], {
  cwd: packageRoot,
  stdio: ['pipe', 'pipe', 'pipe'],
});
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
const stderr = [];
child.stderr.on('data', (chunk) => stderr.push(chunk));
const pending = [];
lines.on('line', (line) => pending.shift()?.(JSON.parse(line)));

function send(message) {
  return new Promise((resolveResponse, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${message.method}: ${Buffer.concat(stderr).toString('utf8')}`));
    }, 5_000);
    pending.push((response) => {
      clearTimeout(timer);
      resolveResponse(response);
    });
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

try {
  const initialized = await send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'packed-smoke', version: '1.0.0' },
    },
  });
  assert.equal(initialized.result.serverInfo.version, '0.7.0');
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const tools = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.equal(tools.result.tools.length, 10);
  assert.ok(tools.result.tools.some((tool) => tool.name === 'prepare_request'));

  const prepared = await send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'prepare_request',
      arguments: {
        prompt: 'In order to complete this task, please be concise. '.repeat(12),
        features: { routing: false, compression: true, brevity: true, fileToMarkdown: false },
        compression: { mode: 'deterministic', minimumCharacters: 1, minimumSavingsRatio: 0 },
      },
    },
  });
  assert.equal(prepared.result.isError, false);
  assert.equal(prepared.result.structuredContent.stages.compression.status, 'applied');
  assert.equal(prepared.result.structuredContent.stages.brevity.status, 'applied');
  assert.match(prepared.result.structuredContent.preparedPrompt, /switchboard:brevity:end/);

  const runtime = await import(pathToFileURL(resolve(packageRoot, 'dist/js/runtime/index.js')));
  const judge = await import(pathToFileURL(resolve(packageRoot, 'dist/js/judge/index.js')));
  const proxyModule = await import(pathToFileURL(resolve(packageRoot, 'dist/js/proxy/index.js')));
  assert.equal(
    new runtime.RuntimeSession({ id: 'smoke', initialTier: 'balanced', initialEffort: 'medium' }).snapshot().currentTier,
    'balanced',
  );
  assert.ok(new judge.DeterministicRuntimeJudge());

  const learner = new proxyModule.ProxyOutcomeLearner({ exploration: 0 });
  learner.recordSelection('packed-session', 'smoke-upstream', ['smoke']);
  learner.observe('packed-session', [{ tool: 'verify', kind: 'verify', status: 'success' }]);
  assert.equal(learner.snapshot().totalOutcomes, 1);
  const telemetry = new proxyModule.ProxyTelemetry({ maxEvents: 2 });
  telemetry.record({
    wire: 'responses',
    sessionId: 'packed-session',
    endpointId: 'smoke-upstream',
    provider: 'localhost',
    requestModel: 'switchboard',
    responseModel: 'smoke-model',
    tier: 'balanced',
    decision: 'continue',
    judgeSource: 'deterministic',
    status: 200,
    latencyMs: 1,
    attempts: 1,
    fallback: false,
    inputTokens: 1,
    outputTokens: 1,
    cost: 0,
  });
  assert.equal(telemetry.summary().requests, 1);

  const proxyConfig = proxyModule.validateProxyConfig({
    listen: { host: '127.0.0.1', port: 0 },
    routes: {
      responses: {
        balanced: [
          { id: 'smoke-upstream', baseUrl: 'http://127.0.0.1:9/v1', model: 'smoke-model' },
          { id: 'smoke-backup', baseUrl: 'http://127.0.0.1:8/v1', model: 'smoke-backup-model' },
        ],
      },
    },
  });
  assert.equal(proxyConfig.routes.responses.balanced.length, 2);
  assert.equal(proxyConfig.routing.outcomeLearning, true);
  const proxy = proxyModule.createSwitchboardProxyServer(proxyConfig, {
    route: () =>
      Promise.resolve({
        tier: 'balanced',
        effort: 'medium',
        capabilities: { web: false, files: false, vision: false, longContext: false, code: false },
        confidence: 0.5,
        shouldUseJudge: false,
        reasons: [],
        scores: { fast: 0, balanced: 1, deep: 0, max: 0 },
        taskCategories: ['smoke'],
      }),
  });
  const address = await proxy.listen();
  const health = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(health.status, 200);
  const status = await fetch(`http://127.0.0.1:${address.port}/v1/switchboard/status`);
  assert.equal(status.status, 200);
  const statusBody = await status.json();
  assert.equal(statusBody.routing.outcomeLearning, true);
  await proxy.close();
  await access(resolve(packageRoot, 'proxy/index.mjs'));
  console.log('Packed Switchboard artifact launched MCP and exercised runtime, judge, adaptive proxy, telemetry, and outcome exports.');
} finally {
  child.stdin.end();
  child.kill('SIGTERM');
  lines.close();
}
