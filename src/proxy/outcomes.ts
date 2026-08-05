import { stableDigest } from '../runtime/digest.js';
import type { RuntimeObservationInput } from '../runtime/types.js';
import type { ProxyUpstreamPool } from './types.js';

export interface ProxyOutcomeLearnerOptions {
  priorSuccess?: number;
  priorFailure?: number;
  exploration?: number;
  maxEndpoints?: number;
  maxCategoriesPerEndpoint?: number;
  maxPendingSessions?: number;
  pendingTtlMs?: number;
  now?: () => number;
}

export interface ProxyOutcomeUpdate {
  endpointId: string;
  reward: 0 | 1;
  categories: string[];
}

export interface ProxyOutcomeCategorySnapshot {
  successes: number;
  failures: number;
  mean: number;
}

export interface ProxyOutcomeEndpointSnapshot {
  id: string;
  successes: number;
  failures: number;
  mean: number;
  categories: Readonly<Record<string, ProxyOutcomeCategorySnapshot>>;
}

export interface ProxyOutcomeSnapshot {
  totalOutcomes: number;
  pendingSessions: number;
  endpoints: ProxyOutcomeEndpointSnapshot[];
}

interface OutcomeStats {
  successes: number;
  failures: number;
  touchedAt: number;
}

interface EndpointStats extends OutcomeStats {
  id: string;
  categories: Map<string, OutcomeStats>;
}

interface PendingSelection {
  endpointId: string;
  categories: string[];
  selectedAt: number;
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function boundedNumber(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function sessionKey(sessionId: string): string {
  return stableDigest(sessionId).slice(0, 32);
}

function normalizedCategories(categories: readonly string[], maximum: number): string[] {
  const normalized: string[] = [];
  for (const category of categories) {
    const value = category.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(value) || normalized.includes(value)) continue;
    normalized.push(value);
    if (normalized.length >= maximum) break;
  }
  return normalized;
}

function checkpointReward(observations: readonly RuntimeObservationInput[]): 0 | 1 | undefined {
  const checkpoints = observations.filter(
    (observation) => (observation.kind === 'execute' || observation.kind === 'verify') && observation.status !== 'pending',
  );
  if (checkpoints.some((observation) => observation.status === 'success')) return 1;
  if (checkpoints.some((observation) => observation.status === 'failure')) return 0;
  return undefined;
}

export class ProxyOutcomeLearner {
  private readonly endpoints = new Map<string, EndpointStats>();
  private readonly pending = new Map<string, PendingSelection>();
  private readonly priorSuccess: number;
  private readonly priorFailure: number;
  private readonly exploration: number;
  private readonly maxEndpoints: number;
  private readonly maxCategoriesPerEndpoint: number;
  private readonly maxPendingSessions: number;
  private readonly pendingTtlMs: number;
  private readonly now: () => number;
  private totalOutcomesValue = 0;

  constructor(options: ProxyOutcomeLearnerOptions = {}) {
    this.priorSuccess = boundedNumber(options.priorSuccess ?? 2, 'priorSuccess', 0.001, 1_000_000);
    this.priorFailure = boundedNumber(options.priorFailure ?? 2, 'priorFailure', 0.001, 1_000_000);
    this.exploration = boundedNumber(options.exploration ?? 0.12, 'exploration', 0, 1);
    this.maxEndpoints = boundedInteger(options.maxEndpoints ?? 128, 'maxEndpoints', 1, 10_000);
    this.maxCategoriesPerEndpoint = boundedInteger(options.maxCategoriesPerEndpoint ?? 64, 'maxCategoriesPerEndpoint', 1, 2_000);
    this.maxPendingSessions = boundedInteger(options.maxPendingSessions ?? 1_024, 'maxPendingSessions', 1, 100_000);
    this.pendingTtlMs = boundedInteger(options.pendingTtlMs ?? 30 * 60 * 1_000, 'pendingTtlMs', 1, Number.MAX_SAFE_INTEGER);
    this.now = options.now ?? Date.now;
  }

  recordSelection(sessionId: string, endpointId: string, categories: readonly string[]): void {
    const id = endpointId.trim();
    if (!id) throw new TypeError('endpointId must be a non-empty string.');
    this.cleanup();
    const key = sessionKey(sessionId);
    if (!this.pending.has(key) && this.pending.size >= this.maxPendingSessions) this.evictOldestPending();
    this.pending.set(key, {
      endpointId: id,
      categories: normalizedCategories(categories, this.maxCategoriesPerEndpoint),
      selectedAt: this.now(),
    });
  }

  observe(sessionId: string, observations: readonly RuntimeObservationInput[]): ProxyOutcomeUpdate | undefined {
    this.cleanup();
    const key = sessionKey(sessionId);
    const selection = this.pending.get(key);
    if (selection === undefined) return undefined;
    const reward = checkpointReward(observations);
    if (reward === undefined) return undefined;
    this.pending.delete(key);
    this.update(selection.endpointId, selection.categories, reward);
    return { endpointId: selection.endpointId, reward, categories: [...selection.categories] };
  }

  scores(upstreams: ProxyUpstreamPool, categories: readonly string[]): Record<string, number> {
    const normalized = normalizedCategories(categories, this.maxCategoriesPerEndpoint);
    const scores: Record<string, number> = {};
    for (const upstream of upstreams) scores[upstream.id] = this.score(upstream.id, normalized);
    return scores;
  }

  snapshot(): ProxyOutcomeSnapshot {
    this.cleanup();
    return {
      totalOutcomes: this.totalOutcomesValue,
      pendingSessions: this.pending.size,
      endpoints: [...this.endpoints.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((endpoint) => ({
          id: endpoint.id,
          successes: endpoint.successes,
          failures: endpoint.failures,
          mean: this.mean(endpoint),
          categories: Object.fromEntries(
            [...endpoint.categories.entries()]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([category, stats]) => [category, { successes: stats.successes, failures: stats.failures, mean: this.mean(stats) }]),
          ),
        })),
    };
  }

  cleanup(): number {
    const cutoff = this.now() - this.pendingTtlMs;
    let removed = 0;
    for (const [key, selection] of this.pending) {
      if (selection.selectedAt <= cutoff) {
        this.pending.delete(key);
        removed++;
      }
    }
    return removed;
  }

  private score(endpointId: string, categories: readonly string[]): number {
    const endpoint = this.endpoints.get(endpointId);
    if (endpoint === undefined) return Math.min(1, 0.5 + this.exploration);
    const globalMean = this.mean(endpoint);
    let weightedMean = globalMean;
    let observations = endpoint.successes + endpoint.failures;
    let categoryWeight = 0;
    let categoryTotal = 0;
    for (const category of categories) {
      const stats = endpoint.categories.get(category);
      if (stats === undefined) continue;
      const count = stats.successes + stats.failures;
      if (count === 0) continue;
      categoryTotal += this.mean(stats) * count;
      categoryWeight += count;
    }
    if (categoryWeight > 0) {
      const categoryMean = categoryTotal / categoryWeight;
      weightedMean = globalMean * 0.35 + categoryMean * 0.65;
      observations += categoryWeight;
    }
    const bonus = this.exploration * Math.sqrt(Math.log(this.totalOutcomesValue + 2) / (observations + 1));
    return Math.max(0, Math.min(1, weightedMean + bonus));
  }

  private update(endpointId: string, categories: readonly string[], reward: 0 | 1): void {
    const now = this.now();
    let endpoint = this.endpoints.get(endpointId);
    if (endpoint === undefined) {
      if (this.endpoints.size >= this.maxEndpoints) this.evictOldestEndpoint();
      endpoint = { id: endpointId, successes: 0, failures: 0, touchedAt: now, categories: new Map() };
      this.endpoints.set(endpointId, endpoint);
    }
    this.applyReward(endpoint, reward, now);
    for (const category of categories) {
      let stats = endpoint.categories.get(category);
      if (stats === undefined) {
        if (endpoint.categories.size >= this.maxCategoriesPerEndpoint) this.evictOldestCategory(endpoint);
        stats = { successes: 0, failures: 0, touchedAt: now };
        endpoint.categories.set(category, stats);
      }
      this.applyReward(stats, reward, now);
    }
    this.totalOutcomesValue++;
  }

  private applyReward(stats: OutcomeStats, reward: 0 | 1, now: number): void {
    if (reward === 1) stats.successes++;
    else stats.failures++;
    stats.touchedAt = now;
  }

  private mean(stats: OutcomeStats): number {
    return (this.priorSuccess + stats.successes) / (this.priorSuccess + this.priorFailure + stats.successes + stats.failures);
  }

  private evictOldestPending(): void {
    let oldest: { key: string; at: number } | undefined;
    for (const [key, selection] of this.pending) {
      if (oldest === undefined || selection.selectedAt < oldest.at) oldest = { key, at: selection.selectedAt };
    }
    if (oldest !== undefined) this.pending.delete(oldest.key);
  }

  private evictOldestEndpoint(): void {
    let oldest: { id: string; at: number } | undefined;
    for (const endpoint of this.endpoints.values()) {
      if (oldest === undefined || endpoint.touchedAt < oldest.at) oldest = { id: endpoint.id, at: endpoint.touchedAt };
    }
    if (oldest !== undefined) this.endpoints.delete(oldest.id);
  }

  private evictOldestCategory(endpoint: EndpointStats): void {
    let oldest: { category: string; at: number } | undefined;
    for (const [category, stats] of endpoint.categories) {
      if (oldest === undefined || stats.touchedAt < oldest.at) oldest = { category, at: stats.touchedAt };
    }
    if (oldest !== undefined) endpoint.categories.delete(oldest.category);
  }
}
