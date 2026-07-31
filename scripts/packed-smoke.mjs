import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

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
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'packed-smoke', version: '1.0.0' } },
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
  console.log('Packed Switchboard artifact launched and executed prepare_request successfully.');
} finally {
  child.stdin.end();
  child.kill('SIGTERM');
  lines.close();
}
