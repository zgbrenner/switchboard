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
  const initialized = await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'switchboard-smoke', version: '1.0.0' } } });
  assert.equal(initialized.result.serverInfo.name, 'switchboard');
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const routed = await send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'route_request', arguments: { prompt: 'Fix the grammar in this sentence.' } } });
  assert.equal(routed.result.structuredContent.tier, 'fast');
  console.log('Switchboard MCP stdio smoke passed.');
} finally {
  child.stdin.end();
  child.kill('SIGTERM');
  lines.close();
}
