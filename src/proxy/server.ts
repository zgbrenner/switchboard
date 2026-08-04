import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { createProxyController } from './controller.js';
import { createProxyJudge } from './judge.js';
import type { ProxyConfig, ProxyControllerDependencies, ProxyPreparedRequest, ProxyUsage, ProxyWire } from './types.js';
import { usageFromJson, usageFromSse } from './usage.js';

function json(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    ...headers,
  });
  response.end(body);
}

function requestHeaders(request: IncomingMessage): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    result[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

async function readJson(request: IncomingMessage, maximumBytes: number): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maximumBytes) throw new RangeError('Request body exceeds maxRequestBytes.');
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  const value: unknown = JSON.parse(text || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Request body must be a JSON object.');
  }
  return value as Record<string, unknown>;
}

function authorized(request: IncomingMessage, token: string | undefined): boolean {
  if (token === undefined) return true;
  return request.headers.authorization === `Bearer ${token}`;
}

function upstreamHeaders(request: IncomingMessage, prepared: ProxyPreparedRequest): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...prepared.upstream.headers };
  const accept = request.headers.accept;
  if (typeof accept === 'string') headers.accept = accept;
  if (prepared.wire === 'messages') {
    const version = request.headers['anthropic-version'];
    const beta = request.headers['anthropic-beta'];
    if (typeof version === 'string') headers['anthropic-version'] = version;
    else headers['anthropic-version'] = '2023-06-01';
    if (typeof beta === 'string') headers['anthropic-beta'] = beta;
    if (prepared.upstream.apiKey !== undefined) headers['x-api-key'] = prepared.upstream.apiKey;
  } else if (prepared.upstream.apiKey !== undefined) headers.authorization = `Bearer ${prepared.upstream.apiKey}`;
  return headers;
}

function copyResponseHeaders(upstream: Response, response: ServerResponse, routing: Record<string, string>): void {
  for (const name of ['content-type', 'cache-control', 'request-id', 'x-request-id', 'anthropic-request-id']) {
    const value = upstream.headers.get(name);
    if (value !== null) response.setHeader(name, value);
  }
  for (const [name, value] of Object.entries(routing)) response.setHeader(name, value);
}

function wireForPath(pathname: string): ProxyWire | undefined {
  if (pathname === '/v1/responses') return 'responses';
  if (pathname === '/v1/messages') return 'messages';
  return undefined;
}

function stopResponse(prepared: ProxyPreparedRequest, config: ProxyConfig): { status: number; body: unknown } | undefined {
  if (prepared.decision.action === 'stop_budget') {
    return {
      status: 429,
      body: { error: { type: 'switchboard_budget_exhausted', message: 'The runtime budget is exhausted.' } },
    };
  }
  if (prepared.decision.action === 'escalate_human' && config.humanMode === 'stop') {
    return {
      status: 409,
      body: { error: { type: 'switchboard_human_required', message: 'Runtime evidence requires human review.' } },
    };
  }
  return undefined;
}

function parseErrorClass(status: number): string {
  return `HTTP_${status}`;
}

export function createSwitchboardProxyServer(
  config: ProxyConfig,
  dependencies: ProxyControllerDependencies,
): {
  server: Server;
  controller: ReturnType<typeof createProxyController>;
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
} {
  const controller = createProxyController(config, {
    ...dependencies,
    judge: dependencies.judge ?? createProxyJudge(config.judge),
  });
  const fetchImpl = dependencies.fetch ?? fetch;
  const server = createServer(async (request, response) => {
    const host = request.headers.host ?? `${config.listen.host}:${config.listen.port}`;
    const url = new URL(request.url ?? '/', `http://${host}`);
    if (!authorized(request, config.listen.token)) {
      json(
        response,
        401,
        { error: { type: 'unauthorized', message: 'A valid bearer token is required.' } },
        { 'www-authenticate': 'Bearer' },
      );
      return;
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      json(response, 200, { status: 'ok', service: 'switchboard-proxy' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/switchboard/sessions') {
      json(response, 200, { sessions: controller.listSessions() });
      return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/v1/switchboard/sessions/')) {
      const id = decodeURIComponent(url.pathname.slice('/v1/switchboard/sessions/'.length));
      const session = controller.inspectSession(id);
      if (!session) json(response, 404, { error: { type: 'not_found', message: 'Session not found.' } });
      else json(response, 200, session);
      return;
    }
    const wire = wireForPath(url.pathname);
    if (request.method !== 'POST' || wire === undefined) {
      json(response, 404, { error: { type: 'not_found', message: 'Route not found.' } });
      return;
    }

    let prepared: ProxyPreparedRequest | undefined;
    try {
      const body = await readJson(request, config.maxRequestBytes);
      prepared = await controller.prepare({
        wire,
        body,
        headers: requestHeaders(request),
        clientFingerprint: `${request.socket.remoteAddress ?? ''}:${request.headers['user-agent'] ?? ''}`,
      });
      const localStop = stopResponse(prepared, config);
      if (localStop) {
        json(response, localStop.status, localStop.body, prepared.headers);
        return;
      }
      const upstream = await fetchImpl(prepared.endpoint, {
        method: 'POST',
        headers: upstreamHeaders(request, prepared),
        body: JSON.stringify(prepared.body),
      });
      copyResponseHeaders(upstream, response, prepared.headers);
      response.statusCode = upstream.status;
      const isStreaming = prepared.body.stream === true && upstream.body !== null;
      if (isStreaming && upstream.body !== null) {
        const [clientBody, meterBody] = upstream.body.tee();
        Readable.fromWeb(clientBody).pipe(response);
        const sessionId = prepared.sessionId;
        const selectedUpstream = prepared.upstream;
        void new Response(meterBody)
          .text()
          .then((text) => {
            controller.recordUsage(
              sessionId,
              selectedUpstream,
              usageFromSse(wire, text),
              upstream.ok,
              upstream.ok ? undefined : parseErrorClass(upstream.status),
            );
          })
          .catch(() => undefined);
        return;
      }
      const bytes = Buffer.from(await upstream.arrayBuffer());
      response.setHeader('content-length', String(bytes.length));
      response.end(bytes);
      let usage: ProxyUsage = { inputTokens: 0, outputTokens: 0 };
      try {
        usage = usageFromJson(wire, JSON.parse(bytes.toString('utf8')));
      } catch {
        // Non-JSON upstream bodies still pass through unchanged.
      }
      controller.recordUsage(
        prepared.sessionId,
        prepared.upstream,
        usage,
        upstream.ok,
        upstream.ok ? undefined : parseErrorClass(upstream.status),
      );
    } catch (error) {
      if (prepared) {
        controller.recordUsage(prepared.sessionId, prepared.upstream, { inputTokens: 0, outputTokens: 0 }, false, 'ProxyError');
      }
      const status = error instanceof RangeError ? 413 : error instanceof SyntaxError || error instanceof TypeError ? 400 : 502;
      json(
        response,
        status,
        { error: { type: 'switchboard_proxy_error', message: error instanceof Error ? error.message : String(error) } },
        prepared?.headers,
      );
    }
  });

  return {
    server,
    controller,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.listen.port, config.listen.host, () => {
          server.off('error', reject);
          const address = server.address();
          resolve({
            host: config.listen.host,
            port: typeof address === 'object' && address ? address.port : config.listen.port,
          });
        });
      }),
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
