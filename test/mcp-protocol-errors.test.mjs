/**
 * Regression tests for JSON-RPC error semantics.
 *
 * Each of these asserts a behaviour that was previously wrong in a way clients could not work
 * around: a response the official SDK discards, a caller error reported as a server error, or a
 * protocol error laundered into a tool result.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSwitchboardMcpSession } from '../mcp/server.mjs';
import { serveStdio } from '../mcp/stdio.mjs';
import { Readable, Writable } from 'node:stream';

const session = () => createSwitchboardMcpSession({ lifecycle: 'stateless' });

test('error responses never carry a null id', async () => {
  const server = session();
  // The MCP schema types RequestId as string | number and marks the field optional. `id: null`
  // fails schema validation in the official SDK, which routes the message to the transport error
  // handler instead of resolving the pending request, hanging the caller until it times out.
  const cases = [
    { jsonrpc: '2.0', id: null, method: 'ping' },
    { jsonrpc: '2.0', id: {}, method: 'ping' },
    { jsonrpc: '2.0', id: [], method: 'ping' },
    { jsonrpc: '1.0', id: 1, method: 'ping' },
    { jsonrpc: '2.0', id: Number.NaN, method: 'ping' },
  ];
  for (const message of cases) {
    const response = await server.handle(message);
    if (response === null) continue;
    assert.notEqual(response.id, null, `null id returned for ${JSON.stringify(message)}`);
    if (Object.hasOwn(response, 'id')) {
      assert.ok(
        typeof response.id === 'string' || Number.isFinite(response.id),
        `non-conforming id ${JSON.stringify(response.id)} for ${JSON.stringify(message)}`,
      );
    }
  }
});

test('a readable id is echoed back on error', async () => {
  const server = session();
  for (const id of [7, 'abc', 0, -1]) {
    const response = await server.handle({ jsonrpc: '2.0', id, method: 'resources/read', params: { uri: 'switchboard://nope' } });
    assert.equal(response.id, id);
  }
});

test('an unknown tool is a protocol error, not a tool result', async () => {
  const server = session();
  const response = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } });
  // isError is for failures inside a handler, which the model can react to. An unknown name never
  // reached a handler, so reporting it as isError tells the model the call was dispatched.
  assert.equal(response.result, undefined);
  assert.equal(response.error.code, -32602);
  assert.match(response.error.message, /unknown tool/i);
});

test('a missing resource does not reuse the not-initialized code', async () => {
  const server = session();
  const response = await server.handle({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'switchboard://missing' } });
  assert.equal(response.error.code, -32602);

  // -32002 must keep meaning exactly one thing: the server is not initialized.
  const fresh = createSwitchboardMcpSession();
  const early = await fresh.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(early.error.code, -32002);
});

test('caller mistakes report -32602 and internal faults report -32603', async () => {
  const server = session();
  const badInit = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 5 } });
  assert.equal(badInit.error.code, -32602, 'malformed initialize params are the caller’s fault');

  // A router that throws is the server's fault, and must not be reported as bad params.
  const broken = createSwitchboardMcpSession({
    lifecycle: 'stateless',
    route: () => {
      throw new Error('router exploded');
    },
  });
  const response = await broken.handle({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'route_request', arguments: { prompt: 'hello' } },
  });
  // Tool handler faults surface as isError so the model can react; they must not claim -32602.
  assert.equal(response.error?.code ?? -32603, -32603);
});

test('unknown methods report -32601', async () => {
  const response = await session().handle({ jsonrpc: '2.0', id: 1, method: 'no/such/method' });
  assert.equal(response.error.code, -32601);
});

test('stdio emits no id field for unparseable input and writes only JSON-RPC to stdout', async () => {
  const written = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      written.push(chunk.toString());
      callback();
    },
  });
  const input = Readable.from([`not json at all\n${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' })}\n`]);
  await serveStdio({ input, output, error: new Writable({ write: (_c, _e, cb) => cb() }), session: session() });

  const messages = written.join('').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].error.code, -32700);
  assert.ok(!Object.hasOwn(messages[0], 'id'), 'parse-error reply must omit id rather than send null');
  assert.equal(messages[1].id, 3);
});
