import { stableDigest } from '../runtime/digest.js';
import type { QualityTier } from '../shared/types.js';
import type {
  ProxyCircuitBreakerConfig,
  ProxyConfig,
  ProxyConfigInput,
  ProxyEndpointCapabilities,
  ProxyReliabilityConfig,
  ProxyRoutingProfile,
  ProxyTierRoutes,
  ProxyUpstreamRoute,
  ProxyUpstreamRouteInput,
  ProxyWire,
} from './types.js';

const TIERS: QualityTier[] = ['fast', 'balanced', 'deep', 'max'];
const WIRES: ProxyWire[] = ['responses', 'messages'];
const PROFILES: ProxyRoutingProfile[] = ['balanced', 'reliability', 'latency', 'cost'];

const PROFILE_DEFAULTS: Record<ProxyRoutingProfile, ProxyReliabilityConfig> = {
  balanced: {
    maxAttempts: 2,
    requestTimeoutMs: 60_000,
    initialBackoffMs: 250,
    maxBackoffMs: 4_000,
    maxRetryAfterMs: 30_000,
    retryBudget: { capacity: 10, refillPerSecond: 1 },
    circuitBreaker: { failureThreshold: 3, cooldownMs: 30_000, halfOpenMaxRequests: 1, ewmaAlpha: 0.25 },
  },
  reliability: {
    maxAttempts: 3,
    requestTimeoutMs: 90_000,
    initialBackoffMs: 200,
    maxBackoffMs: 5_000,
    maxRetryAfterMs: 60_000,
    retryBudget: { capacity: 20, refillPerSecond: 2 },
    circuitBreaker: { failureThreshold: 2, cooldownMs: 15_000, halfOpenMaxRequests: 1, ewmaAlpha: 0.3 },
  },
  latency: {
    maxAttempts: 2,
    requestTimeoutMs: 30_000,
    initialBackoffMs: 100,
    maxBackoffMs: 1_000,
    maxRetryAfterMs: 5_000,
    retryBudget: { capacity: 10, refillPerSecond: 2 },
    circuitBreaker: { failureThreshold: 3, cooldownMs: 10_000, halfOpenMaxRequests: 1, ewmaAlpha: 0.35 },
  },
  cost: {
    maxAttempts: 2,
    requestTimeoutMs: 60_000,
    initialBackoffMs: 300,
    maxBackoffMs: 3_000,
    maxRetryAfterMs: 15_000,
    retryBudget: { capacity: 5, refillPerSecond: 0.5 },
    circuitBreaker: { failureThreshold: 3, cooldownMs: 30_000, halfOpenMaxRequests: 1, ewmaAlpha: 0.2 },
  },
};

function isLoopback(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function boundedNumber(value: number, name: string, minimum: number, maximum: number, inclusiveMinimum = true): number {
  const belowMinimum = inclusiveMinimum ? value < minimum : value <= minimum;
  if (!Number.isFinite(value) || belowMinimum || value > maximum) {
    const qualifier = inclusiveMinimum ? 'between' : 'greater than';
    throw new TypeError(`${name} must be ${qualifier} ${minimum}${inclusiveMinimum ? ` and ${maximum}` : ` and at most ${maximum}`}.`);
  }
  return value;
}

function nonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a finite non-negative number.`);
  return value;
}

function optionalBoolean(value: boolean | undefined, name: string): boolean | undefined {
  if (value !== undefined && typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean.`);
  return value;
}

function resolveSecret(value: string | undefined, envName: string | undefined, env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (value !== undefined && envName !== undefined) {
    throw new TypeError(`${name} must use either a literal or an environment variable, not both.`);
  }
  if (envName === undefined) return value;
  const resolved = env[envName];
  if (!resolved) throw new TypeError(`${name} environment variable ${envName} is not set.`);
  return resolved;
}

function normalizeCapabilities(value: ProxyUpstreamRouteInput['capabilities'], label: string): ProxyEndpointCapabilities {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  const tools = optionalBoolean(value.tools, `${label}.tools`);
  const vision = optionalBoolean(value.vision, `${label}.vision`);
  const json = optionalBoolean(value.json, `${label}.json`);
  const reasoning = optionalBoolean(value.reasoning, `${label}.reasoning`);
  const maxContextTokens =
    value.maxContextTokens === undefined ? undefined : boundedInteger(value.maxContextTokens, `${label}.maxContextTokens`, 1, 10_000_000);
  const maxOutputTokens =
    value.maxOutputTokens === undefined ? undefined : boundedInteger(value.maxOutputTokens, `${label}.maxOutputTokens`, 1, 10_000_000);
  const dataRetention = value.dataRetention;
  if (dataRetention !== undefined && !['zero', 'provider', 'unknown'].includes(dataRetention)) {
    throw new TypeError(`${label}.dataRetention must be zero, provider, or unknown.`);
  }
  return {
    ...(tools === undefined ? {} : { tools }),
    ...(vision === undefined ? {} : { vision }),
    ...(json === undefined ? {} : { json }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(maxContextTokens === undefined ? {} : { maxContextTokens }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(dataRetention === undefined ? {} : { dataRetention }),
  };
}

function normalizeUpstreamId(value: string | undefined, wire: ProxyWire, tier: QualityTier, baseUrl: string, model: string): string {
  const generated = `${wire}-${tier}-${stableDigest({ wire, tier, baseUrl, model }).slice(0, 12)}`;
  const id = value?.trim() || generated;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id)) {
    throw new TypeError('Upstream id must be 1-128 safe ASCII characters and begin with a letter or number.');
  }
  return id;
}

function normalizeRoute(
  wire: ProxyWire,
  tier: QualityTier,
  route: ProxyUpstreamRouteInput,
  env: NodeJS.ProcessEnv,
  label: string,
): ProxyUpstreamRoute {
  if (!route || typeof route !== 'object' || Array.isArray(route)) throw new TypeError(`${label} route must be an object.`);
  if (typeof route.baseUrl !== 'string' || !route.baseUrl.trim()) throw new TypeError(`${label}.baseUrl is required.`);
  const url = new URL(route.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError(`${label}.baseUrl must use HTTP or HTTPS.`);
  if (typeof route.model !== 'string' || !route.model.trim()) throw new TypeError(`${label}.model is required.`);
  const baseUrl = url.toString().replace(/\/$/u, '');
  const model = route.model.trim();
  const apiKey = resolveSecret(route.apiKey, route.apiKeyEnv, env, `${label}.apiKey`);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(route.headers ?? {})) {
    if (!key.trim() || typeof value !== 'string') throw new TypeError(`${label}.headers must contain string values.`);
    headers[key.toLowerCase()] = value;
  }
  const reasoningEffort = optionalBoolean(route.reasoningEffort, `${label}.reasoningEffort`) ?? false;
  if (reasoningEffort && wire !== 'responses') {
    throw new TypeError(`${label}.reasoningEffort is supported only on the Responses wire.`);
  }
  return {
    id: normalizeUpstreamId(route.id, wire, tier, baseUrl, model),
    baseUrl,
    model,
    ...(apiKey === undefined ? {} : { apiKey }),
    headers,
    reasoningEffort,
    weight: boundedNumber(route.weight ?? 1, `${label}.weight`, 0, 1_000, false),
    capabilities: normalizeCapabilities(route.capabilities, `${label}.capabilities`),
    inputCostPerMillion: nonNegative(route.inputCostPerMillion ?? 0, `${label}.inputCostPerMillion`),
    outputCostPerMillion: nonNegative(route.outputCostPerMillion ?? 0, `${label}.outputCostPerMillion`),
  };
}

function normalizeProfile(value: ProxyRoutingProfile | undefined): ProxyRoutingProfile {
  const profile = value ?? 'balanced';
  if (!PROFILES.includes(profile)) throw new TypeError(`routing.profile must be one of: ${PROFILES.join(', ')}.`);
  return profile;
}

function normalizeReliability(input: ProxyConfigInput['reliability'], profile: ProxyRoutingProfile): ProxyReliabilityConfig {
  const defaults = PROFILE_DEFAULTS[profile];
  const maxAttempts = boundedInteger(input?.maxAttempts ?? defaults.maxAttempts, 'reliability.maxAttempts', 1, 5);
  const requestTimeoutMs = boundedInteger(input?.requestTimeoutMs ?? defaults.requestTimeoutMs, 'reliability.requestTimeoutMs', 1, 600_000);
  const initialBackoffMs = boundedInteger(input?.initialBackoffMs ?? defaults.initialBackoffMs, 'reliability.initialBackoffMs', 0, 60_000);
  const maxBackoffMs = boundedInteger(input?.maxBackoffMs ?? defaults.maxBackoffMs, 'reliability.maxBackoffMs', 0, 120_000);
  if (maxBackoffMs < initialBackoffMs) throw new TypeError('reliability.maxBackoffMs must be at least initialBackoffMs.');
  const maxRetryAfterMs = boundedInteger(input?.maxRetryAfterMs ?? defaults.maxRetryAfterMs, 'reliability.maxRetryAfterMs', 0, 300_000);
  const retryBudget = {
    capacity: boundedInteger(input?.retryBudget?.capacity ?? defaults.retryBudget.capacity, 'reliability.retryBudget.capacity', 1, 10_000),
    refillPerSecond: boundedNumber(
      input?.retryBudget?.refillPerSecond ?? defaults.retryBudget.refillPerSecond,
      'reliability.retryBudget.refillPerSecond',
      0,
      10_000,
      false,
    ),
  };
  const circuitDefaults: ProxyCircuitBreakerConfig = defaults.circuitBreaker;
  const circuitBreaker = {
    failureThreshold: boundedInteger(
      input?.circuitBreaker?.failureThreshold ?? circuitDefaults.failureThreshold,
      'reliability.circuitBreaker.failureThreshold',
      1,
      100,
    ),
    cooldownMs: boundedInteger(
      input?.circuitBreaker?.cooldownMs ?? circuitDefaults.cooldownMs,
      'reliability.circuitBreaker.cooldownMs',
      1,
      600_000,
    ),
    halfOpenMaxRequests: boundedInteger(
      input?.circuitBreaker?.halfOpenMaxRequests ?? circuitDefaults.halfOpenMaxRequests,
      'reliability.circuitBreaker.halfOpenMaxRequests',
      1,
      100,
    ),
    ewmaAlpha: boundedNumber(
      input?.circuitBreaker?.ewmaAlpha ?? circuitDefaults.ewmaAlpha,
      'reliability.circuitBreaker.ewmaAlpha',
      0,
      1,
      false,
    ),
  };
  return { maxAttempts, requestTimeoutMs, initialBackoffMs, maxBackoffMs, maxRetryAfterMs, retryBudget, circuitBreaker };
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
  const upstreamIds = new Set<string>();
  let routeCount = 0;
  for (const wire of WIRES) {
    const rawWire = input.routes?.[wire];
    if (rawWire === undefined) continue;
    const normalized: ProxyTierRoutes = {};
    for (const tier of TIERS) {
      const rawTier = rawWire[tier];
      if (rawTier === undefined) continue;
      const rawPool = Array.isArray(rawTier) ? rawTier : [rawTier];
      if (rawPool.length === 0) throw new TypeError(`routes.${wire}.${tier} must contain at least one upstream.`);
      const pool = rawPool.map((route, index) => normalizeRoute(wire, tier, route, env, `routes.${wire}.${tier}[${index}]`));
      for (const upstream of pool) {
        if (upstreamIds.has(upstream.id)) throw new TypeError(`Duplicate upstream id: ${upstream.id}.`);
        upstreamIds.add(upstream.id);
      }
      normalized[tier] = pool;
      routeCount += pool.length;
    }
    if (Object.keys(normalized).length > 0) routes[wire] = normalized;
  }
  if (routeCount === 0) throw new TypeError('At least one proxy upstream route is required.');

  const profile = normalizeProfile(input.routing?.profile);
  const strictCapabilities = optionalBoolean(input.routing?.strictCapabilities, 'routing.strictCapabilities') ?? false;
  const requireZeroDataRetention = optionalBoolean(input.routing?.requireZeroDataRetention, 'routing.requireZeroDataRetention') ?? false;
  const sessionStickiness = optionalBoolean(input.routing?.sessionStickiness, 'routing.sessionStickiness') ?? true;
  const maxSessions = boundedInteger(input.session?.maxSessions ?? 256, 'session.maxSessions', 1, 10_000);
  const ttlMs = boundedInteger(input.session?.ttlMs ?? 30 * 60 * 1000, 'session.ttlMs', 1, Number.MAX_SAFE_INTEGER);
  const maxRequestBytes = boundedInteger(input.maxRequestBytes ?? 16 * 1024 * 1024, 'maxRequestBytes', 1, 64 * 1024 * 1024);
  const rawJudge = input.judge;
  let judge: ProxyConfig['judge'] = { type: 'deterministic' };
  if (rawJudge?.type === 'remote') {
    if (typeof rawJudge.endpoint !== 'string' || !rawJudge.endpoint.trim()) {
      throw new TypeError('judge.endpoint is required for a remote judge.');
    }
    const endpoint = new URL(rawJudge.endpoint);
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new TypeError('judge.endpoint must use HTTP or HTTPS.');
    const judgeToken = resolveSecret(rawJudge.token, rawJudge.tokenEnv, env, 'judge.token');
    const timeoutMs = boundedInteger(rawJudge.timeoutMs ?? 2500, 'judge.timeoutMs', 1, 30_000);
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
    routing: { profile, strictCapabilities, requireZeroDataRetention, sessionStickiness },
    reliability: normalizeReliability(input.reliability, profile),
    runtimePolicy: { ...(input.runtimePolicy ?? {}) },
    session: { maxSessions, ttlMs },
    humanMode: input.humanMode ?? 'stop',
    maxRequestBytes,
    judge,
  };
}
