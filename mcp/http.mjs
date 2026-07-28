import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { createSwitchboardMcpSession, SUPPORTED_PROTOCOL_VERSIONS } from './server.mjs';

const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 256;

function list(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
function header(value) {
  return Array.isArray(value) ? value[0] : value;
}

function loopback(host) {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(host).toLowerCase());
}

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

function bearerAllowed(authorization, token) {
  if (!token) return true;
  const prefix = 'Bearer ';
  if (typeof authorization !== 'string' || !authorization.startsWith(prefix)) return false;
  const supplied = Buffer.from(authorization.slice(prefix.length), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function acceptsRequiredTypes(value) {
  const types = new Set(
    String(value ?? '')
      .toLowerCase()
      .split(',')
      .map((item) => item.split(';', 1)[0].trim()),
  );
  return types.has('application/json') && types.has('text/event-stream');
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

function corsHeaders(request) {
  const origin = header(request.headers.origin);
  return origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
}

function json(request, response, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...corsHeaders(request),
    ...extraHeaders,
  });
  response.end(body);
}

function plain(request, response, status, text, extraHeaders = {}) {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    ...corsHeaders(request),
    ...extraHeaders,
  });
  response.end(text);
}

function protocolHeader(request) {
  return header(request.headers['mcp-protocol-version']);
}

function sessionHeader(request) {
  return header(request.headers['mcp-session-id']);
}

export function startHttpServer(options = {}) {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 3764;
  const path = options.path ?? '/mcp';
  const token = options.token ?? process.env.SWITCHBOARD_MCP_TOKEN ?? '';
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const allowedHosts = options.allowedHosts ?? list(process.env.SWITCHBOARD_MCP_ALLOWED_HOSTS);
  const allowedOrigins = options.allowedOrigins ?? list(process.env.SWITCHBOARD_MCP_ALLOWED_ORIGINS);
  if (!loopback(host) && !token) throw new Error('Bearer authentication is required when binding Switchboard MCP outside loopback.');
  if (!Number.isFinite(sessionTtlMs) || sessionTtlMs <= 0) throw new Error('sessionTtlMs must be positive.');
  if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 10_000)
    throw new Error('maxSessions must be an integer between 1 and 10000.');

  const sessions = new Map();
  const cleanup = (now = Date.now()) => {
    for (const [id, value] of sessions) if (now - value.lastSeen >= sessionTtlMs) sessions.delete(id);
  };

  const server = createServer(async (request, response) => {
    cleanup();
    if (request.url?.split('?', 1)[0] !== path) {
      response.writeHead(404).end();
      return;
    }
    if (!hostAllowed(request.headers.host, host, allowedHosts)) {
      plain(request, response, 403, 'Forbidden host');
      return;
    }
    if (!originAllowed(header(request.headers.origin), allowedOrigins)) {
      plain(request, response, 403, 'Forbidden origin');
      return;
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        ...corsHeaders(request),
        allow: 'POST, GET, DELETE, OPTIONS',
        'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type, accept, authorization, mcp-protocol-version, mcp-session-id',
      });
      response.end();
      return;
    }

    if (!bearerAllowed(header(request.headers.authorization), token)) {
      response.writeHead(401, { 'www-authenticate': 'Bearer realm="Switchboard MCP"', ...corsHeaders(request) }).end();
      return;
    }

    if (request.method === 'GET') {
      response.writeHead(405, { allow: 'POST, DELETE, OPTIONS', ...corsHeaders(request) }).end();
      return;
    }

    if (request.method === 'DELETE') {
      const id = sessionHeader(request);
      const protocol = protocolHeader(request);
      if (!id || !protocol) {
        plain(request, response, 400, 'MCP-Session-Id and MCP-Protocol-Version are required.');
        return;
      }
      const state = sessions.get(id);
      if (!state) {
        response.writeHead(404, corsHeaders(request)).end();
        return;
      }
      if (protocol !== state.protocolVersion) {
        plain(request, response, 400, 'MCP protocol version does not match the session.');
        return;
      }
      sessions.delete(id);
      response.writeHead(204, { 'cache-control': 'no-store', ...corsHeaders(request) }).end();
      return;
    }

    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST, DELETE, OPTIONS', ...corsHeaders(request) }).end();
      return;
    }
    if (!acceptsRequiredTypes(request.headers.accept)) {
      plain(request, response, 406, 'Accept must include application/json and text/event-stream.');
      return;
    }
    if (
      !String(request.headers['content-type'] ?? '')
        .toLowerCase()
        .startsWith('application/json')
    ) {
      plain(request, response, 415, 'Expected application/json');
      return;
    }

    try {
      const body = await readBody(request);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        json(request, response, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } });
        return;
      }
      const isObject = message && typeof message === 'object' && !Array.isArray(message);
      const method = isObject ? message.method : undefined;
      const incomingSessionId = sessionHeader(request);

      if (method === 'initialize') {
        if (incomingSessionId) {
          plain(request, response, 400, 'Initialization must not include MCP-Session-Id.');
          return;
        }
        if (sessions.size >= maxSessions) {
          plain(request, response, 429, 'Too many active MCP sessions.');
          return;
        }
        const session = createSwitchboardMcpSession();
        const result = await session.handle(message);
        if (result?.error) {
          json(request, response, 400, result);
          return;
        }
        const sessionId = randomUUID();
        sessions.set(sessionId, { session, protocolVersion: session.protocolVersion, lastSeen: Date.now() });
        json(request, response, 200, result, { 'mcp-session-id': sessionId });
        return;
      }

      if (!incomingSessionId) {
        plain(request, response, 400, 'MCP-Session-Id is required after initialization.');
        return;
      }
      const state = sessions.get(incomingSessionId);
      if (!state) {
        response.writeHead(404, corsHeaders(request)).end();
        return;
      }
      const protocol = protocolHeader(request);
      if (!protocol) {
        plain(request, response, 400, 'MCP-Protocol-Version is required after initialization.');
        return;
      }
      if (!SUPPORTED_PROTOCOL_VERSIONS.has(protocol) || protocol !== state.protocolVersion) {
        plain(request, response, 400, 'Unsupported or mismatched MCP protocol version.');
        return;
      }
      state.lastSeen = Date.now();
      const result = await state.session.handle(message);
      const responseHeaders = { 'mcp-session-id': incomingSessionId };
      if (result === null) {
        response.writeHead(202, { 'cache-control': 'no-store', ...corsHeaders(request), ...responseHeaders }).end();
        return;
      }
      json(request, response, 200, result, responseHeaders);
    } catch (exception) {
      const status = Number(exception?.statusCode) || 500;
      if (status === 500) json(request, response, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' } });
      else plain(request, response, status, exception instanceof Error ? exception.message : 'Request failed');
    }
  });
  server.listen(port, host);
  return server;
}
