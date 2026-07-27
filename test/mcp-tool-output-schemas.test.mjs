import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SWITCHBOARD_ROUTER_MODULE = '.test-dist/router/route.js';
const { createSwitchboardMcpSession } = await import('../mcp/server.mjs');

const request = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });

test('every MCP tool publishes a bounded JSON Schema 2020-12 output contract', async () => {
  const session = createSwitchboardMcpSession();
  await session.handle(request(1, 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'schema-test', version: '1' },
  }));
  await session.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const response = await session.handle(request(2, 'tools/list', {}));
  assert.equal(response.result.tools.length, 9);
  for (const tool of response.result.tools) {
    assert.equal(tool.outputSchema.$schema, 'https://json-schema.org/draft/2020-12/schema', tool.name);
    assert.equal(tool.outputSchema.type, 'object', tool.name);
    assert.equal(tool.outputSchema.additionalProperties, false, tool.name);
    assert.ok(Array.isArray(tool.outputSchema.required), tool.name);
  }
});
