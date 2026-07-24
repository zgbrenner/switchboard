import { createInterface } from 'node:readline';
import { createSwitchboardMcpSession } from './server.mjs';

const MAX_LINE_BYTES = 1024 * 1024;

export async function serveStdio({ input = process.stdin, output = process.stdout, error = process.stderr, session = createSwitchboardMcpSession() } = {}) {
  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
      output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request', data: { message: 'Message exceeds 1 MiB.' } } })}\n`);
      continue;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      continue;
    }
    try {
      const response = await session.handle(message);
      if (response !== null) output.write(`${JSON.stringify(response)}\n`);
    } catch (exception) {
      error.write(`Switchboard MCP internal error: ${exception instanceof Error ? exception.message : String(exception)}\n`);
    }
  }
}
