import { stableDigest } from '../runtime/digest.js';
import type { ProxyCircuitBreakerConfig, ProxyRoutingProfile, ProxyUpstreamPool, ProxyUpstreamRoute } from './types.js';

export type ProxyCircuitState = 'closed' | 'open' | 'half-open';

export interface ProxyAttemptOutcome {
  ok: boolean;
  retryable?: boolean;
  rateLimited?: boolean;
  retryAfterMs?: number;
  latencyMs: number;
  status?: number;
}

export interface ProxySelectionContext {
  seed: string;
  excludedIds?: ReadonlySet<string> | readonly string[];
}

export interface ProxyEndpointSnapshot {
  id: string;
  circuitState: ProxyCircuitState;
  requests: number;
  successes: number;
  failures: number;
  rateLimited: number;
  inflight: number;
  consecutiveFailures: number;
  latencyEwmaMs: number;
  errorEwma: number;
  openUntil: number;
  rateLimitUntil: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastSelectedAt?: number;
}

export interface ProxyHealthRegistryOptions {
  profile: ProxyRoutingProfile;
  circuitBreaker: ProxyCircuitBreakerConfig;
  now?: () => number;
}

interface EndpointState {
  id: string;
  circuitState: ProxyCircuitState;
  requests: number;
  successes: number;
  failures: number;
  rateLimited: number;
  inflight: number;
  halfOpenInflight: number;
  consecutiveFailures: number;
  latencyEwmaMs: number;
  errorEwma: number;
  openUntil: number;
  rateLimitUntil: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastSelectedAt?: number;
}

const PROFILE_WEIGHTS: Record<
  ProxyRoutingProfile,
  { health: number; latency: number; cost: number; load: number; configuredWeight: number }
> = {
  balanced: { health: 0.35, latency: 0.25, cost: 0.2, load: 0.1, configuredWeight: 0.1 },
  reliability: { health: 0.55, latency: 0.15, cost: 0.1, load: 0.1, configuredWeight: 0.1 },
  latency: { health: 0.2, latency: 0.55, cost: 0.05, load: 0.1, configuredWeight: 0.1 },
  cost: { health: 0.2, latency: 0.1, cost: 0.55, load: 0.05, configuredWeight: 0.1 },
};

function excludedSet(value: ProxySelectionContext['excludedIds']): ReadonlySet<string> {
  if (value instanceof Set) return value;
  return new Set(value ?? []);
}

function deterministicJitter(seed: string, id: string): number {
  const prefix = stableDigest({ seed, id }).slice(0, 8);
  return (Number.parseInt(prefix, 16) / 0xffff_ffff - 0.5) * 0.01;
}

function ewma(previous: number, sample: number, alpha: number, initialized: boolean): number {
  return initialized ? alpha * sample + (1 - alpha) * previous : sample;
}

export class ProxyHealthRegistry {
  private readonly states = new Map<string, EndpointState>();
  private readonly profile: ProxyRoutingProfile;
  private readonly circuitBreaker: ProxyCircuitBreakerConfig;
  private readonly now: () => number;

  constructor(options: ProxyHealthRegistryOptions) {
    this.profile = options.profile;
    this.circuitBreaker = options.circuitBreaker;
    this.now = options.now ?? Date.now;
  }

  beginAttempt(id: string): void {
    const state = this.state(id);
    const now = this.now();
    if (state.circuitState === 'open' && now >= state.openUntil) state.circuitState = 'half-open';
    if (state.circuitState === 'half-open' && state.halfOpenInflight >= this.circuitBreaker.halfOpenMaxRequests) {
      throw new Error(`Half-open probe limit reached for upstream ${id}.`);
    }
    state.requests++;
    state.inflight++;
    if (state.circuitState === 'half-open') state.halfOpenInflight++;
  }

  completeAttempt(id: string, outcome: ProxyAttemptOutcome): void {
    const state = this.state(id);
    const now = this.now();
    state.inflight = Math.max(0, state.inflight - 1);
    if (state.circuitState === 'half-open') state.halfOpenInflight = Math.max(0, state.halfOpenInflight - 1);
    const hadLatency = state.successes + state.failures > 0;
    state.latencyEwmaMs = ewma(state.latencyEwmaMs, Math.max(0, outcome.latencyMs), this.circuitBreaker.ewmaAlpha, hadLatency);

    if (outcome.ok) {
      state.successes++;
      state.consecutiveFailures = 0;
      state.errorEwma = ewma(state.errorEwma, 0, this.circuitBreaker.ewmaAlpha, state.successes + state.failures > 1);
      state.lastSuccessAt = now;
      state.circuitState = 'closed';
      state.openUntil = 0;
      state.halfOpenInflight = 0;
      return;
    }

    state.failures++;
    state.lastFailureAt = now;
    if (outcome.rateLimited) {
      state.rateLimited++;
      state.rateLimitUntil = Math.max(state.rateLimitUntil, now + Math.max(0, outcome.retryAfterMs ?? 0));
    }
    if (!outcome.retryable) {
      state.errorEwma = ewma(state.errorEwma, 0, this.circuitBreaker.ewmaAlpha, state.successes + state.failures > 1);
      return;
    }

    state.consecutiveFailures++;
    state.errorEwma = ewma(state.errorEwma, 1, this.circuitBreaker.ewmaAlpha, state.successes + state.failures > 1);
    if (state.circuitState === 'half-open' || state.consecutiveFailures >= this.circuitBreaker.failureThreshold) {
      this.openCircuit(state, now);
    }
  }

  select(upstreams: ProxyUpstreamPool, context: ProxySelectionContext): ProxyUpstreamRoute | undefined {
    const excluded = excludedSet(context.excludedIds);
    const available = upstreams.filter((upstream) => this.eligible(this.state(upstream.id)));
    const preferred = available.filter((upstream) => !excluded.has(upstream.id));
    const candidates = preferred.length > 0 ? preferred : available;
    if (candidates.length === 0) return undefined;
    const maxWeight = Math.max(...candidates.map((upstream) => upstream.weight));
    let selected: { upstream: ProxyUpstreamRoute; score: number } | undefined;
    for (const upstream of candidates) {
      const score = this.score(upstream, maxWeight) + deterministicJitter(context.seed, upstream.id);
      if (selected === undefined || score > selected.score) selected = { upstream, score };
    }
    if (selected === undefined) return undefined;
    this.state(selected.upstream.id).lastSelectedAt = this.now();
    return selected.upstream;
  }

  snapshot(id: string): ProxyEndpointSnapshot {
    const state = this.state(id);
    return this.toSnapshot(state);
  }

  snapshots(): ProxyEndpointSnapshot[] {
    return [...this.states.values()].map((state) => this.toSnapshot(state));
  }

  private state(id: string): EndpointState {
    const existing = this.states.get(id);
    if (existing !== undefined) return existing;
    const created: EndpointState = {
      id,
      circuitState: 'closed',
      requests: 0,
      successes: 0,
      failures: 0,
      rateLimited: 0,
      inflight: 0,
      halfOpenInflight: 0,
      consecutiveFailures: 0,
      latencyEwmaMs: 0,
      errorEwma: 0,
      openUntil: 0,
      rateLimitUntil: 0,
    };
    this.states.set(id, created);
    return created;
  }

  private eligible(state: EndpointState): boolean {
    const now = this.now();
    if (now < state.rateLimitUntil) return false;
    if (state.circuitState === 'closed') return true;
    if (state.circuitState === 'half-open') return state.halfOpenInflight < this.circuitBreaker.halfOpenMaxRequests;
    return now >= state.openUntil && state.halfOpenInflight < this.circuitBreaker.halfOpenMaxRequests;
  }

  private score(upstream: ProxyUpstreamRoute, maxWeight: number): number {
    const state = this.state(upstream.id);
    const weights = PROFILE_WEIGHTS[this.profile];
    const health = 1 - Math.min(1, state.errorEwma);
    const latency = state.latencyEwmaMs > 0 ? 1 / (1 + state.latencyEwmaMs / 100) : 0.75;
    const cost = 1 / (1 + upstream.inputCostPerMillion + upstream.outputCostPerMillion);
    const load = 1 / (1 + state.inflight);
    const configuredWeight = upstream.weight / maxWeight;
    const circuitMultiplier = state.circuitState === 'closed' ? 1 : 0.5;
    return (
      (health * weights.health +
        latency * weights.latency +
        cost * weights.cost +
        load * weights.load +
        configuredWeight * weights.configuredWeight) *
      circuitMultiplier
    );
  }

  private openCircuit(state: EndpointState, now: number): void {
    state.circuitState = 'open';
    state.openUntil = now + this.circuitBreaker.cooldownMs;
    state.halfOpenInflight = 0;
  }

  private toSnapshot(state: EndpointState): ProxyEndpointSnapshot {
    const visibleState = state.circuitState === 'open' && this.now() >= state.openUntil ? 'half-open' : state.circuitState;
    return {
      id: state.id,
      circuitState: visibleState,
      requests: state.requests,
      successes: state.successes,
      failures: state.failures,
      rateLimited: state.rateLimited,
      inflight: state.inflight,
      consecutiveFailures: state.consecutiveFailures,
      latencyEwmaMs: state.latencyEwmaMs,
      errorEwma: state.errorEwma,
      openUntil: state.openUntil,
      rateLimitUntil: state.rateLimitUntil,
      ...(state.lastSuccessAt === undefined ? {} : { lastSuccessAt: state.lastSuccessAt }),
      ...(state.lastFailureAt === undefined ? {} : { lastFailureAt: state.lastFailureAt }),
      ...(state.lastSelectedAt === undefined ? {} : { lastSelectedAt: state.lastSelectedAt }),
    };
  }
}
