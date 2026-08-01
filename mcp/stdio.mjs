import { createInterface } from 'node:readline';
import { createSwitchboardMcpSession } from './server.mjs';

// File attachments are schema-valid up to 50 MiB decoded (mcp/pipeline/files.mjs), around 67 MiB
// once base64-encoded, so a 1 MiB cap rejected any realistically sized attachment before it could
// even be parsed -- and that rejection can never carry a correlatable id, since the oversized line
// is never parsed, leaving a client that matches responses by id waiting forever. stdio is a local
// pipe to whichever process spawned this one, not a network-facing listener (unlike the HTTP
// transport, which keeps its own stricter caps), and `readline` already buffers a full line before
// this check runs regardless of the threshold, so raising it does not change the transport's actual
// worst-case memory exposure -- it only stops rejecting legitimate, schema-valid requests.
const MAX_LINE_BYTES = 100 * 1024 * 1024;

export async function serveStdio({
  input = process.stdin,
  output = process.stdout,
  error = process.stderr,
  session = createSwitchboardMcpSession(),
} = {}) {
  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
      output.write(
        `${JSON.stringify({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request', data: { message: 'Message exceeds 1 MiB.' } } })}\n`,
      );
      continue;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } })}\n`);
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
