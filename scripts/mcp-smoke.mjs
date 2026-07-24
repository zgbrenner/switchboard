import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const child = spawn(process.execPath, ['mcp/index.mjs', '--transport=stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
const pending = [];
lines.on('line', (line) => pending.shift()?.(JSON.parse(line)));

function send(message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${message.method}`)), 2_000);
    pending.push((response) => { clearTimeout(timer); resolve(response); });
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

try {
  const initialized = await send({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'switchboard-smoke', version: '1.0.0' } },
  });
  assert.equal(initialized.result.serverInfo.name, 'switchboard');
  assert.equal(initialized.result.serverInfo.version, '0.4.0');
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const tools = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.deepEqual(tools.result.tools.map((tool) => tool.name), ['route_request']);
  assert.equal(tools.result.tools[0].outputSchema.properties.modelResolution.properties.status.enum.includes('recommended'), true);

  const routed = await send({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: {
      name: 'route_request',
      arguments: {
        prompt: 'Perform a focused security review and validate subtle authentication failures.',
        availableModels: [
          { id: 'fast-text', tier: 'fast', capabilities: { code: false } },
          { id: 'deep-code', tier: 'deep', effortLevels: ['high'], capabilities: { code: true }, relativeCost: 0.5, relativeLatency: 0.5 },
        ],
      },
    },
  });
  assert.ok(['deep', 'max'].includes(routed.result.structuredContent.tier));
  assert.equal(routed.result.structuredContent.modelResolution.status, 'recommended');
  assert.equal(routed.result.structuredContent.modelResolution.recommended.id, 'deep-code');

  const completion = await send({
    jsonrpc: '2.0', id: 4, method: 'completion/complete',
    params: { ref: { type: 'ref/prompt', name: 'route_before_answering' }, argument: { name: 'policy', value: 'b' } },
  });
  assert.deepEqual(completion.result.completion.values, ['balanced', 'best']);
  console.log('Switchboard MCP stdio smoke passed: lifecycle, discovery, model resolution, and completion.');
} finally {
  child.stdin.end();
  child.kill('SIGTERM');
  lines.close();
}
