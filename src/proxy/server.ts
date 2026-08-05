import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { createProxyController, rewriteProxyBody } from './controller.js';
import { ProxyHealthRegistry } from './health.js';
import { createProxyJudge } from './judge.js';
import { ProxyOutcomeLearner } from './outcomes.js';
import { executeReliableFetch, ProxyReliableFetchError, RetryTokenBucket } from './reliability.js';
import { ProxyCompatibilityError } from './requirements.js';
import { ProxyTelemetry } from './telemetry.js';
import type { ProxyTelemetryInput } from './telemetry.js';
import type { ProxyConfig, ProxyControllerDependencies, ProxyPreparedRequest, ProxyUpstreamRoute, ProxyUsage, ProxyWire } from './types.js';
import { usageFromJson, usageFromSse } from './usage.js';

export interface ProxyServerDependencies extends ProxyControllerDependencies {
  health?: ProxyHealthRegistry;
  retryBudget?: RetryTokenBucket;
  telemetry?: ProxyTelemetry;
  outcomes?: ProxyOutcomeLearner;
}

export interface SwitchboardProxyServer {
  server: Server;
  controller: ReturnType<typeof createProxyController>;
  health: ProxyHealthRegistry;
  retryBudget: RetryTokenBucket;
  telemetry: ProxyTelemetry;
  outcomes: ProxyOutcomeLearner;
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

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

function upstreamHeaders(request: IncomingMessage, wire: ProxyWire, upstream: ProxyUpstreamRoute): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...upstream.headers };
  const accept = request.headers.accept;
  if (typeof accept === 'string') headers.accept = accept;
  if (wire === 'messages') {
    const version = request.headers['anthropic-version'];
    const beta = request.headers['anthropic-beta'];
    if (typeof version === 'string') headers['anthropic-version'] = version;
    else headers['anthropic-version'] = '2023-06-01';
    if (typeof beta === 'string') headers['anthropic-beta'] = beta;
    if (upstream.apiKey !== undefined) headers['x-api-key'] = upstream.apiKey;
  } else if (upstream.apiKey !== undefined) headers.authorization = `Bearer ${upstream.apiKey}`;
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

function routeHeaders(
  prepared: ProxyPreparedRequest,
  upstream: ProxyUpstreamRoute,
  attempts: number,
  fallback: boolean,
): Record<string, string> {
  return {
    ...prepared.headers,
    'x-switchboard-model': upstream.model,
    'x-switchboard-upstream': upstream.id,
    'x-switchboard-attempts': String(attempts),
    'x-switchboard-fallback': String(fallback),
  };
}

function relativeCost(usage: ProxyUsage, upstream: ProxyUpstreamRoute): number {
  return (usage.inputTokens * upstream.inputCostPerMillion + usage.outputTokens * upstream.outputCostPerMillion) / 1_000_000;
}

function providerName(upstream: ProxyUpstreamRoute): string {
  return new URL(upstream.baseUrl).hostname;
}

function totalLatency(attempts: Array<{ latencyMs: number }>): number {
  return attempts.reduce((total, attempt) => total + attempt.latencyMs, 0);
}

function recordTelemetry(
  telemetry: ProxyTelemetry,
  prepared: ProxyPreparedRequest,
  upstream: ProxyUpstreamRoute,
  status: number,
  attempts: Array<{ latencyMs: number }>,
  fallback: boolean,
  usage: ProxyUsage,
  errorClass?: string,
): void {
  const input: ProxyTelemetryInput = {
    wire: prepared.wire,
    sessionId: prepared.sessionId,
    endpointId: upstream.id,
    provider: providerName(upstream),
    requestModel: typeof prepared.baseBody.model === 'string' ? prepared.baseBody.model : 'switchboard',
    responseModel: upstream.model,
    tier: prepared.snapshot.currentTier,
    decision: prepared.decision.action,
    judgeSource: prepared.judgeSource,
    status,
    latencyMs: totalLatency(attempts),
    attempts: attempts.length,
    fallback,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cost: relativeCost(usage, upstream),
    ...(errorClass === undefined ? {} : { errorClass }),
  };
  telemetry.record(input);
}

function statusPayload(
  config: ProxyConfig,
  health: ProxyHealthRegistry,
  retryBudget: RetryTokenBucket,
  telemetry: ProxyTelemetry,
  outcomes: ProxyOutcomeLearner,
): Record<string, unknown> {
  return {
    service: 'switchboard-proxy',
    routing: { ...config.routing },
    reliability: {
      maxAttempts: config.reliability.maxAttempts,
      requestTimeoutMs: config.reliability.requestTimeoutMs,
      initialBackoffMs: config.reliability.initialBackoffMs,
      maxBackoffMs: config.reliability.maxBackoffMs,
      maxRetryAfterMs: config.reliability.maxRetryAfterMs,
      circuitBreaker: { ...config.reliability.circuitBreaker },
    },
    retryBudget: { available: retryBudget.available, capacity: config.reliability.retryBudget.capacity },
    endpoints: health.snapshots(),
    outcomes: { enabled: config.routing.outcomeLearning, ...outcomes.snapshot() },
    telemetry: { summary: telemetry.summary(), recent: telemetry.events() },
  };
}

export function createSwitchboardProxyServer(config: ProxyConfig, dependencies: ProxyServerDependencies): SwitchboardProxyServer {
  const clock = dependencies.now ?? Date.now;
  const clockOption = dependencies.now === undefined ? {} : { now: dependencies.now };
  const outcomes = dependencies.outcomes ?? new ProxyOutcomeLearner(clockOption);
  const controller = createProxyController(config, {
    ...dependencies,
    judge: dependencies.judge ?? createProxyJudge(config.judge),
    ...(config.routing.outcomeLearning ? { outcomes } : {}),
  });
  const fetchImpl = dependencies.fetch ?? fetch;
  const health =
    dependencies.health ??
    new ProxyHealthRegistry({
      profile: config.routing.profile,
      circuitBreaker: config.reliability.circuitBreaker,
      ...clockOption,
    });
  const retryBudget =
    dependencies.retryBudget ??
    new RetryTokenBucket({
      capacity: config.reliability.retryBudget.capacity,
      refillPerSecond: config.reliability.retryBudget.refillPerSecond,
      ...clockOption,
    });
  const telemetry = dependencies.telemetry ?? new ProxyTelemetry(clockOption);
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
    if (request.method === 'GET' && url.pathname === '/v1/switchboard/status') {
      json(response, 200, statusPayload(config, health, retryBudget, telemetry, outcomes));
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
      const activePrepared = prepared;
      const localStop = stopResponse(activePrepared, config);
      if (localStop) {
        json(response, localStop.status, localStop.body, activePrepared.headers);
        return;
      }
      const qualityScores = config.routing.outcomeLearning
        ? outcomes.scores(activePrepared.upstreams, activePrepared.taskCategories)
        : undefined;
      const reliable = await executeReliableFetch({
        upstreams: activePrepared.upstreams,
        health,
        selection: {
          seed: config.routing.sessionStickiness ? activePrepared.sessionId : `${activePrepared.sessionId}:${clock()}:${Math.random()}`,
          ...(qualityScores === undefined ? {} : { qualityScores }),
        },
        reliability: config.reliability,
        retryBudget,
        ...clockOption,
        request: (upstream, signal) => {
          const renderedBody = rewriteProxyBody(wire, activePrepared.baseBody, upstream, activePrepared.snapshot.currentEffort);
          return fetchImpl(`${upstream.baseUrl}/${wire}`, {
            method: 'POST',
            headers: upstreamHeaders(request, wire, upstream),
            body: JSON.stringify(renderedBody),
            signal,
          });
        },
      });
      const upstream = reliable.response;
      const selectedUpstream = reliable.upstream;
      if (upstream.ok && config.routing.outcomeLearning) {
        outcomes.recordSelection(activePrepared.sessionId, selectedUpstream.id, activePrepared.taskCategories);
      }
      const routing = routeHeaders(activePrepared, selectedUpstream, reliable.attempts.length, reliable.fallback);
      copyResponseHeaders(upstream, response, routing);
      response.statusCode = upstream.status;
      const isStreaming = activePrepared.baseBody.stream === true && upstream.body !== null;
      if (isStreaming && upstream.body !== null) {
        const [clientBody, meterBody] = upstream.body.tee();
        Readable.fromWeb(clientBody).pipe(response);
        const sessionId = activePrepared.sessionId;
        void new Response(meterBody)
          .text()
          .then((text) => {
            const usage = usageFromSse(wire, text);
            const classification = upstream.ok ? undefined : parseErrorClass(upstream.status);
            controller.recordUsage(sessionId, selectedUpstream, usage, upstream.ok, classification);
            recordTelemetry(
              telemetry,
              activePrepared,
              selectedUpstream,
              upstream.status,
              reliable.attempts,
              reliable.fallback,
              usage,
              classification,
            );
          })
          .catch(() => {
            controller.recordUsage(sessionId, selectedUpstream, { inputTokens: 0, outputTokens: 0 }, false, 'StreamReadError');
            recordTelemetry(
              telemetry,
              activePrepared,
              selectedUpstream,
              upstream.status,
              reliable.attempts,
              reliable.fallback,
              { inputTokens: 0, outputTokens: 0 },
              'StreamReadError',
            );
          });
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
      const classification = upstream.ok ? undefined : parseErrorClass(upstream.status);
      controller.recordUsage(activePrepared.sessionId, selectedUpstream, usage, upstream.ok, classification);
      recordTelemetry(
        telemetry,
        activePrepared,
        selectedUpstream,
        upstream.status,
        reliable.attempts,
        reliable.fallback,
        usage,
        classification,
      );
    } catch (error) {
      const exhausted = error instanceof ProxyReliableFetchError ? error : undefined;
      const failedUpstream = exhausted?.upstream ?? prepared?.upstream;
      const failureClass = exhausted?.attempts.at(-1)?.errorClass ?? 'ProxyError';
      const fallback =
        exhausted !== undefined && exhausted.attempts.some((attempt) => attempt.upstreamId !== exhausted.upstream.id);
      if (prepared && failedUpstream) {
        controller.recordUsage(prepared.sessionId, failedUpstream, { inputTokens: 0, outputTokens: 0 }, false, failureClass);
        if (exhausted !== undefined) {
          recordTelemetry(
            telemetry,
            prepared,
            failedUpstream,
            502,
            exhausted.attempts,
            fallback,
            { inputTokens: 0, outputTokens: 0 },
            failureClass,
          );
        }
      }
      const compatibility = error instanceof ProxyCompatibilityError;
      const status = compatibility
        ? 422
        : error instanceof RangeError
          ? 413
          : error instanceof SyntaxError || error instanceof TypeError
            ? 400
            : 502;
      const type = compatibility ? error.code : 'switchboard_proxy_error';
      const headers = prepared && failedUpstream ? routeHeaders(prepared, failedUpstream, exhausted?.attempts.length ?? 0, fallback) : prepared?.headers;
      json(response, status, { error: { type, message: error instanceof Error ? error.message : String(error) } }, headers);
    }
  });

  return {
    server,
    controller,
    health,
    retryBudget,
    telemetry,
    outcomes,
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
