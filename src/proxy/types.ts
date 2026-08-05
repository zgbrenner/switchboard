import type { RuntimeJudge } from '../judge/types.js';
import type { RuntimeDecision, RuntimeObservationInput, RuntimePolicyConfig, RuntimeSessionSnapshot } from '../runtime/types.js';
import type { QualityTier, RoutingDecision, RoutingRequest } from '../shared/types.js';

export type ProxyWire = 'responses' | 'messages';
export type ProxyRoutingProfile = 'balanced' | 'reliability' | 'latency' | 'cost';
export type ProxyDataRetention = 'zero' | 'provider' | 'unknown';

export interface ProxyEndpointCapabilities {
  tools?: boolean;
  vision?: boolean;
  json?: boolean;
  reasoning?: boolean;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  dataRetention?: ProxyDataRetention;
}

export interface ProxyUpstreamRoute {
  id: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  headers: Readonly<Record<string, string>>;
  reasoningEffort: boolean;
  weight: number;
  capabilities: Readonly<ProxyEndpointCapabilities>;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
}

export type ProxyUpstreamPool = ProxyUpstreamRoute[];
export type ProxyTierRoutes = Partial<Record<QualityTier, ProxyUpstreamPool>>;
export type ProxyJudgeConfig = { type: 'deterministic' } | { type: 'remote'; endpoint: string; token?: string; timeoutMs: number };

export interface ProxyRoutingConfig {
  profile: ProxyRoutingProfile;
  strictCapabilities: boolean;
  requireZeroDataRetention: boolean;
  sessionStickiness: boolean;
}

export interface ProxyRetryBudgetConfig {
  capacity: number;
  refillPerSecond: number;
}

export interface ProxyCircuitBreakerConfig {
  failureThreshold: number;
  cooldownMs: number;
  halfOpenMaxRequests: number;
  ewmaAlpha: number;
}

export interface ProxyReliabilityConfig {
  maxAttempts: number;
  requestTimeoutMs: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  maxRetryAfterMs: number;
  retryBudget: ProxyRetryBudgetConfig;
  circuitBreaker: ProxyCircuitBreakerConfig;
}

export interface ProxyConfig {
  alias: string;
  listen: { host: string; port: number; token?: string };
  routes: Partial<Record<ProxyWire, ProxyTierRoutes>>;
  routing: ProxyRoutingConfig;
  reliability: ProxyReliabilityConfig;
  runtimePolicy: Partial<RuntimePolicyConfig>;
  session: { maxSessions: number; ttlMs: number };
  humanMode: 'stop' | 'continue';
  maxRequestBytes: number;
  judge: ProxyJudgeConfig;
}

export interface ProxyEndpointCapabilitiesInput {
  tools?: boolean;
  vision?: boolean;
  json?: boolean;
  reasoning?: boolean;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  dataRetention?: ProxyDataRetention;
}

export interface ProxyUpstreamRouteInput {
  id?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  headers?: Readonly<Record<string, string>>;
  reasoningEffort?: boolean;
  weight?: number;
  capabilities?: ProxyEndpointCapabilitiesInput;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
}

export interface ProxyConfigInput {
  alias?: string;
  listen?: { host?: string; port?: number; token?: string; tokenEnv?: string };
  routes?: Partial<Record<ProxyWire, Partial<Record<QualityTier, ProxyUpstreamRouteInput | ProxyUpstreamRouteInput[]>>>>;
  routing?: {
    profile?: ProxyRoutingProfile;
    strictCapabilities?: boolean;
    requireZeroDataRetention?: boolean;
    sessionStickiness?: boolean;
  };
  reliability?: {
    maxAttempts?: number;
    requestTimeoutMs?: number;
    initialBackoffMs?: number;
    maxBackoffMs?: number;
    maxRetryAfterMs?: number;
    retryBudget?: { capacity?: number; refillPerSecond?: number };
    circuitBreaker?: {
      failureThreshold?: number;
      cooldownMs?: number;
      halfOpenMaxRequests?: number;
      ewmaAlpha?: number;
    };
  };
  runtimePolicy?: Partial<RuntimePolicyConfig>;
  session?: { maxSessions?: number; ttlMs?: number };
  humanMode?: 'stop' | 'continue';
  maxRequestBytes?: number;
  judge?: { type?: 'deterministic' } | { type: 'remote'; endpoint?: string; token?: string; tokenEnv?: string; timeoutMs?: number };
}

export interface ProxyRequestRequirements {
  tools: boolean;
  vision: boolean;
  json: boolean;
  reasoning: boolean;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  zeroDataRetention: boolean;
}

export interface ExtractedObservation {
  key: string;
  input: RuntimeObservationInput;
}

export interface ExtractedProxyRequest {
  prompt: string;
  context: Array<{ role: 'user' | 'assistant'; text: string }>;
  observations: ExtractedObservation[];
  sessionHint?: string;
}

export interface ProxyPrepareInput {
  wire: ProxyWire;
  body: Record<string, unknown>;
  headers: Readonly<Record<string, string | undefined>>;
  clientFingerprint?: string;
}

export interface ProxyPreparedRequest {
  wire: ProxyWire;
  sessionId: string;
  baseBody: Record<string, unknown>;
  body: Record<string, unknown>;
  upstream: ProxyUpstreamRoute;
  upstreams: ProxyUpstreamPool;
  endpoint: string;
  headers: Record<string, string>;
  decision: RuntimeDecision;
  judgeSource: 'deterministic' | 'judge' | 'fail-open';
  snapshot: RuntimeSessionSnapshot;
  requirements: ProxyRequestRequirements;
}

export interface ProxyControllerDependencies {
  route(request: RoutingRequest): RoutingDecision | Promise<RoutingDecision>;
  judge?: RuntimeJudge;
  now?: () => number;
  fetch?: typeof fetch;
}

export interface ProxySessionInspection {
  id: string;
  snapshot: RuntimeSessionSnapshot;
  seenObservations: number;
  lastDecision: RuntimeDecision;
}

export interface ProxyUsage {
  inputTokens: number;
  outputTokens: number;
}
