import { stableDigest } from '../runtime/digest.js';
import type { RuntimeDecisionAction } from '../runtime/types.js';
import type { QualityTier } from '../shared/types.js';
import type { ProxyWire } from './types.js';

export type ProxyTelemetryAttribute = string | number | boolean;

export interface ProxyTelemetryInput {
  wire: ProxyWire;
  sessionId: string;
  endpointId: string;
  provider: string;
  requestModel: string;
  responseModel: string;
  tier: QualityTier;
  decision: RuntimeDecisionAction;
  judgeSource: 'deterministic' | 'judge' | 'fail-open';
  status: number;
  latencyMs: number;
  attempts: number;
  fallback: boolean;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  errorClass?: string;
}

export interface ProxyTelemetryEvent {
  name: 'gen_ai.client.operation';
  timestamp: number;
  sessionHash: string;
  attributes: Readonly<Record<string, ProxyTelemetryAttribute>>;
}

export interface ProxyTelemetrySummary {
  requests: number;
  failed: number;
  fallbacks: number;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  averageLatencyMs: number;
}

export interface ProxyTelemetryOptions {
  maxEvents?: number;
  sink?: (event: ProxyTelemetryEvent) => void | Promise<void>;
  now?: () => number;
}

interface MutableSummary {
  requests: number;
  failed: number;
  fallbacks: number;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  totalLatencyMs: number;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function cloneEvent(event: ProxyTelemetryEvent): ProxyTelemetryEvent {
  return { ...event, attributes: { ...event.attributes } };
}

export class ProxyTelemetry {
  private readonly retained: ProxyTelemetryEvent[] = [];
  private readonly maxEvents: number;
  private readonly sink?: (event: ProxyTelemetryEvent) => void | Promise<void>;
  private readonly now: () => number;
  private readonly totals: MutableSummary = {
    requests: 0,
    failed: 0,
    fallbacks: 0,
    attempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    totalLatencyMs: 0,
  };

  constructor(options: ProxyTelemetryOptions = {}) {
    this.maxEvents = options.maxEvents ?? 256;
    if (!Number.isInteger(this.maxEvents) || this.maxEvents < 1 || this.maxEvents > 10_000) {
      throw new TypeError('Telemetry maxEvents must be an integer between 1 and 10000.');
    }
    this.sink = options.sink;
    this.now = options.now ?? Date.now;
  }

  record(input: ProxyTelemetryInput): ProxyTelemetryEvent {
    const inputTokens = Math.floor(nonNegative(input.inputTokens));
    const outputTokens = Math.floor(nonNegative(input.outputTokens));
    const attempts = Math.max(1, Math.floor(nonNegative(input.attempts)));
    const latencyMs = nonNegative(input.latencyMs);
    const cost = nonNegative(input.cost);
    const attributes: Record<string, ProxyTelemetryAttribute> = {
      'gen_ai.operation.name': input.wire,
      'gen_ai.provider.name': input.provider,
      'gen_ai.request.model': input.requestModel,
      'gen_ai.response.model': input.responseModel,
      'gen_ai.usage.input_tokens': inputTokens,
      'gen_ai.usage.output_tokens': outputTokens,
      'gen_ai.usage.cost': cost,
      'http.response.status_code': input.status,
      'server.address': input.provider,
      'switchboard.upstream.id': input.endpointId,
      'switchboard.tier': input.tier,
      'switchboard.decision': input.decision,
      'switchboard.judge.source': input.judgeSource,
      'switchboard.attempts': attempts,
      'switchboard.fallback': input.fallback,
      'switchboard.duration_ms': latencyMs,
    };
    if (input.errorClass !== undefined) attributes['error.type'] = input.errorClass;
    const event: ProxyTelemetryEvent = {
      name: 'gen_ai.client.operation',
      timestamp: this.now(),
      sessionHash: stableDigest(input.sessionId).slice(0, 16),
      attributes,
    };
    this.retained.push(event);
    if (this.retained.length > this.maxEvents) this.retained.splice(0, this.retained.length - this.maxEvents);

    this.totals.requests++;
    if (input.status >= 400 || input.errorClass !== undefined) this.totals.failed++;
    if (input.fallback) this.totals.fallbacks++;
    this.totals.attempts += attempts;
    this.totals.inputTokens += inputTokens;
    this.totals.outputTokens += outputTokens;
    this.totals.cost += cost;
    this.totals.totalLatencyMs += latencyMs;
    this.deliver(event);
    return cloneEvent(event);
  }

  events(): ProxyTelemetryEvent[] {
    return this.retained.map(cloneEvent);
  }

  summary(): ProxyTelemetrySummary {
    return {
      requests: this.totals.requests,
      failed: this.totals.failed,
      fallbacks: this.totals.fallbacks,
      attempts: this.totals.attempts,
      inputTokens: this.totals.inputTokens,
      outputTokens: this.totals.outputTokens,
      cost: Number(this.totals.cost.toFixed(12)),
      averageLatencyMs: this.totals.requests === 0 ? 0 : this.totals.totalLatencyMs / this.totals.requests,
    };
  }

  private deliver(event: ProxyTelemetryEvent): void {
    if (this.sink === undefined) return;
    try {
      const result = this.sink(cloneEvent(event));
      if (result !== undefined) void Promise.resolve(result).catch(() => undefined);
    } catch {
      // Telemetry is best-effort and must never fail a model request.
    }
  }
}
