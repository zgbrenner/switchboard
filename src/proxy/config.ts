import type { QualityTier } from '../shared/types.js';
import type { ProxyConfig, ProxyConfigInput, ProxyTierRoutes, ProxyUpstreamRoute, ProxyWire } from './types.js';

const TIERS: QualityTier[] = ['fast', 'balanced', 'deep', 'max'];
const WIRES: ProxyWire[] = ['responses', 'messages'];

function isLoopback(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

function positiveInteger(value: number, name: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new TypeError(`${name} must be a positive integer.`);
  return value;
}

function nonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a finite non-negative number.`);
  return value;
}

function resolveSecret(
  value: string | undefined,
  envName: string | undefined,
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  if (value !== undefined && envName !== undefined) {
    throw new TypeError(`${name} must use either a literal or an environment variable, not both.`);
  }
  if (envName === undefined) return value;
  const resolved = env[envName];
  if (!resolved) throw new TypeError(`${name} environment variable ${envName} is not set.`);
  return resolved;
}

function normalizeRoute(
  route: NonNullable<NonNullable<ProxyConfigInput['routes']>[ProxyWire]>[QualityTier],
  env: NodeJS.ProcessEnv,
  label: string,
): ProxyUpstreamRoute {
  if (!route || typeof route !== 'object') throw new TypeError(`${label} route must be an object.`);
  if (typeof route.baseUrl !== 'string' || !route.baseUrl.trim()) throw new TypeError(`${label}.baseUrl is required.`);
  const url = new URL(route.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError(`${label}.baseUrl must use HTTP or HTTPS.`);
  if (typeof route.model !== 'string' || !route.model.trim()) throw new TypeError(`${label}.model is required.`);
  const apiKey = resolveSecret(route.apiKey, route.apiKeyEnv, env, `${label}.apiKey`);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(route.headers ?? {})) {
    if (!key.trim() || typeof value !== 'string') throw new TypeError(`${label}.headers must contain string values.`);
    headers[key.toLowerCase()] = value;
  }
  return {
    baseUrl: url.toString().replace(/\/$/u, ''),
    model: route.model.trim(),
    ...(apiKey === undefined ? {} : { apiKey }),
    headers,
    inputCostPerMillion: nonNegative(route.inputCostPerMillion ?? 0, `${label}.inputCostPerMillion`),
    outputCostPerMillion: nonNegative(route.outputCostPerMillion ?? 0, `${label}.outputCostPerMillion`),
  };
}

export function validateProxyConfig(input: ProxyConfigInput, env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Proxy config must be an object.');
  const alias = input.alias?.trim() || 'switchboard';
  const host = input.listen?.host?.trim() || '127.0.0.1';
  const port = input.listen?.port ?? 8788;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError('listen.port must be an integer between 0 and 65535.');
  }
  const token = resolveSecret(input.listen?.token, input.listen?.tokenEnv, env, 'listen.token');
  if (!isLoopback(host) && token === undefined) throw new TypeError('A bearer token is required when binding outside loopback.');

  const routes: Partial<Record<ProxyWire, ProxyTierRoutes>> = {};
  let routeCount = 0;
  for (const wire of WIRES) {
    const rawWire = input.routes?.[wire];
    if (rawWire === undefined) continue;
    const normalized: ProxyTierRoutes = {};
    for (const tier of TIERS) {
      const rawRoute = rawWire[tier];
      if (rawRoute === undefined) continue;
      normalized[tier] = normalizeRoute(rawRoute, env, `routes.${wire}.${tier}`);
      routeCount++;
    }
    if (Object.keys(normalized).length > 0) routes[wire] = normalized;
  }
  if (routeCount === 0) throw new TypeError('At least one proxy upstream route is required.');

  const maxSessions = positiveInteger(input.session?.maxSessions ?? 256, 'session.maxSessions', 10_000);
  const ttlMs = positiveInteger(input.session?.ttlMs ?? 30 * 60 * 1000, 'session.ttlMs');
  const maxRequestBytes = positiveInteger(
    input.maxRequestBytes ?? 16 * 1024 * 1024,
    'maxRequestBytes',
    64 * 1024 * 1024,
  );
  const rawJudge = input.judge;
  let judge: ProxyConfig['judge'] = { type: 'deterministic' };
  if (rawJudge?.type === 'remote') {
    if (typeof rawJudge.endpoint !== 'string' || !rawJudge.endpoint.trim()) {
      throw new TypeError('judge.endpoint is required for a remote judge.');
    }
    const endpoint = new URL(rawJudge.endpoint);
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new TypeError('judge.endpoint must use HTTP or HTTPS.');
    const judgeToken = resolveSecret(rawJudge.token, rawJudge.tokenEnv, env, 'judge.token');
    const timeoutMs = positiveInteger(rawJudge.timeoutMs ?? 2500, 'judge.timeoutMs', 30_000);
    judge = {
      type: 'remote',
      endpoint: endpoint.toString(),
      timeoutMs,
      ...(judgeToken === undefined ? {} : { token: judgeToken }),
    };
  }
  return {
    alias,
    listen: { host, port, ...(token === undefined ? {} : { token }) },
    routes,
    runtimePolicy: { ...(input.runtimePolicy ?? {}) },
    session: { maxSessions, ttlMs },
    humanMode: input.humanMode ?? 'stop',
    maxRequestBytes,
    judge,
  };
}
