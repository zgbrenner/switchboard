import { createServer } from 'node:http';
import { createSwitchboardMcpSession, SUPPORTED_PROTOCOL_VERSIONS } from './server.mjs';

const MAX_BODY_BYTES = 1024 * 1024;

function list(value) { return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean); }

function hostAllowed(hostHeader, host, allowedHosts) {
  const value = String(hostHeader ?? '').toLowerCase();
  if (!value) return false;
  const hostname = value.startsWith('[') ? value.slice(0, value.indexOf(']') + 1) : value.split(':', 1)[0];
  const defaults = new Set(['127.0.0.1', 'localhost', '[::1]', host.toLowerCase(), ...allowedHosts.map((item) => item.toLowerCase())]);
  return defaults.has(hostname) || defaults.has(value);
}

function originAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function readBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw Object.assign(new Error('Request body exceeds 1 MiB.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  response.end(body);
}

export function startHttpServer(options = {}) {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 3764;
  const path = options.path ?? '/mcp';
  const allowedHosts = options.allowedHosts ?? list(process.env.SWITCHBOARD_MCP_ALLOWED_HOSTS);
  const allowedOrigins = options.allowedOrigins ?? list(process.env.SWITCHBOARD_MCP_ALLOWED_ORIGINS);

  const server = createServer(async (request, response) => {
    if (request.url?.split('?', 1)[0] !== path) { response.writeHead(404).end(); return; }
    if (!hostAllowed(request.headers.host, host, allowedHosts)) { response.writeHead(403).end('Forbidden host'); return; }
    if (!originAllowed(request.headers.origin, allowedOrigins)) { response.writeHead(403).end('Forbidden origin'); return; }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { allow: 'POST, GET, OPTIONS', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type, accept, mcp-protocol-version' });
      response.end(); return;
    }
    if (request.method === 'GET') { response.writeHead(405, { allow: 'POST, OPTIONS' }).end(); return; }
    if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST, OPTIONS' }).end(); return; }
    if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) { response.writeHead(415).end('Expected application/json'); return; }

    try {
      const body = await readBody(request);
      let message;
      try { message = JSON.parse(body); }
      catch { json(response, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
      const method = message && typeof message === 'object' && !Array.isArray(message) ? message.method : undefined;
      const protocol = request.headers['mcp-protocol-version'];
      if (method !== 'initialize' && protocol && !SUPPORTED_PROTOCOL_VERSIONS.has(String(protocol))) { response.writeHead(400).end('Unsupported MCP protocol version'); return; }
      const session = createSwitchboardMcpSession();
      const result = await session.handle(message);
      if (result === null) { response.writeHead(202, { 'cache-control': 'no-store' }).end(); return; }
      json(response, 200, result);
    } catch (exception) {
      const status = Number(exception?.statusCode) || 500;
      if (status === 500) json(response, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } });
      else response.writeHead(status).end(exception instanceof Error ? exception.message : 'Request failed');
    }
  });
  server.listen(port, host);
  return server;
}
