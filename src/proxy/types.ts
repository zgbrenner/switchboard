import type { RuntimeJudge } from '../judge/types.js';
import type { RuntimeDecision, RuntimeObservationInput, RuntimePolicyConfig, RuntimeSessionSnapshot } from '../runtime/types.js';
import type { QualityTier, RoutingDecision, RoutingRequest } from '../shared/types.js';

export type ProxyWire = 'responses' | 'messages';

export interface ProxyUpstreamRoute {
  baseUrl: string;
  model: string;
  apiKey?: string;
  headers: Readonly<Record<string, string>>;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
}

export type ProxyTierRoutes = Partial<Record<QualityTier, ProxyUpstreamRoute>>;
export type ProxyJudgeConfig =
  | { type: 'deterministic' }
  | { type: 'remote'; endpoint: string; token?: string; timeoutMs: number };

export interface ProxyConfig {
  alias: string;
  listen: { host: string; port: number; token?: string };
  routes: Partial<Record<ProxyWire, ProxyTierRoutes>>;
  runtimePolicy: Partial<RuntimePolicyConfig>;
  session: { maxSessions: number; ttlMs: number };
  humanMode: 'stop' | 'continue';
  maxRequestBytes: number;
  judge: ProxyJudgeConfig;
}

export interface ProxyConfigInput {
  alias?: string;
  listen?: { host?: string; port?: number; token?: string; tokenEnv?: string };
  routes?: Partial<
    Record<
      ProxyWire,
      Partial<
        Record<
          QualityTier,
          {
            baseUrl?: string;
            model?: string;
            apiKey?: string;
            apiKeyEnv?: string;
            headers?: Readonly<Record<string, string>>;
            inputCostPerMillion?: number;
            outputCostPerMillion?: number;
          }
        >
      >
    >
  >;
  runtimePolicy?: Partial<RuntimePolicyConfig>;
  session?: { maxSessions?: number; ttlMs?: number };
  humanMode?: 'stop' | 'continue';
  maxRequestBytes?: number;
  judge?:
    | { type?: 'deterministic' }
    | { type: 'remote'; endpoint?: string; token?: string; tokenEnv?: string; timeoutMs?: number };
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
  body: Record<string, unknown>;
  upstream: ProxyUpstreamRoute;
  endpoint: string;
  headers: Record<string, string>;
  decision: RuntimeDecision;
  judgeSource: 'deterministic' | 'judge' | 'fail-open';
  snapshot: RuntimeSessionSnapshot;
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
