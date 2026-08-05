import type { ProxyHealthRegistry, ProxySelectionContext } from './health.js';
import type { ProxyReliabilityConfig, ProxyUpstreamPool, ProxyUpstreamRoute } from './types.js';

export interface RetryTokenBucketOptions {
  capacity: number;
  refillPerSecond: number;
  now?: () => number;
}

export interface ProxyReliableAttempt {
  upstreamId: string;
  latencyMs: number;
  retryable: boolean;
  rateLimited: boolean;
  status?: number;
  errorClass?: string;
}

export interface ProxyReliableFetchResult {
  response: Response;
  upstream: ProxyUpstreamRoute;
  attempts: ProxyReliableAttempt[];
  fallback: boolean;
}

export interface ProxyReliableFetchOptions {
  upstreams: ProxyUpstreamPool;
  health: ProxyHealthRegistry;
  selection: ProxySelectionContext;
  reliability: ProxyReliabilityConfig;
  request(upstream: ProxyUpstreamRoute, signal: AbortSignal, attempt: number): Promise<Response>;
  retryBudget?: RetryTokenBucket;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

export class RetryTokenBucket {
  private tokens: number;
  private lastRefillAt: number;
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly now: () => number;

  constructor(options: RetryTokenBucketOptions) {
    if (!Number.isFinite(options.capacity) || options.capacity < 1) throw new TypeError('Retry token capacity must be at least 1.');
    if (!Number.isFinite(options.refillPerSecond) || options.refillPerSecond <= 0) {
      throw new TypeError('Retry token refillPerSecond must be greater than 0.');
    }
    this.capacity = options.capacity;
    this.refillPerSecond = options.refillPerSecond;
    this.now = options.now ?? Date.now;
    this.tokens = this.capacity;
    this.lastRefillAt = this.now();
  }

  get available(): number {
    this.refill();
    return this.tokens;
  }

  tryTake(amount = 1): boolean {
    if (!Number.isFinite(amount) || amount <= 0) throw new TypeError('Retry token amount must be greater than 0.');
    this.refill();
    if (this.tokens < amount) return false;
    this.tokens -= amount;
    return true;
  }

  private refill(): void {
    const now = this.now();
    const elapsedMs = Math.max(0, now - this.lastRefillAt);
    if (elapsedMs === 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + (elapsedMs / 1_000) * this.refillPerSecond);
    this.lastRefillAt = now;
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || (status >= 500 && status <= 599);
}

function boundedDelay(value: number, maximum: number): number {
  return Math.min(maximum, Math.max(0, Math.round(value)));
}

export function retryAfterMilliseconds(headers: Headers, now: number, maximum: number): number | undefined {
  const milliseconds = headers.get('retry-after-ms');
  if (milliseconds !== null) {
    const parsed = Number(milliseconds);
    if (Number.isFinite(parsed) && parsed >= 0) return boundedDelay(parsed, maximum);
  }
  const value = headers.get('retry-after');
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return boundedDelay(seconds * 1_000, maximum);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return boundedDelay(date - now, maximum);
  return undefined;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorClass(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return 'NetworkError';
}

function backoffMilliseconds(config: ProxyReliabilityConfig, retryIndex: number, random: () => number): number {
  const ceiling = Math.min(config.maxBackoffMs, config.initialBackoffMs * 2 ** retryIndex);
  return Math.floor(Math.max(0, Math.min(1, random())) * ceiling);
}

async function cancelResponse(response: Response): Promise<void> {
  if (response.body === null) return;
  try {
    await response.body.cancel();
  } catch {
    // Cancellation is best-effort. The next attempt must not be blocked by a vendor-specific stream implementation.
  }
}

export async function executeReliableFetch(options: ProxyReliableFetchOptions): Promise<ProxyReliableFetchResult> {
  if (options.upstreams.length === 0) throw new Error('At least one compatible upstream is required.');
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const retryBudget =
    options.retryBudget ??
    new RetryTokenBucket({
      capacity: options.reliability.retryBudget.capacity,
      refillPerSecond: options.reliability.retryBudget.refillPerSecond,
      now,
    });
  const attempted = new Set<string>();
  const attempts: ProxyReliableAttempt[] = [];
  let lastResponse: { response: Response; upstream: ProxyUpstreamRoute } | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.reliability.maxAttempts; attempt++) {
    const upstream = options.health.select(options.upstreams, { ...options.selection, excludedIds: attempted });
    if (upstream === undefined) {
      if (lastResponse !== undefined) {
        return { ...lastResponse, attempts, fallback: attempts.some((item) => item.upstreamId !== lastResponse?.upstream.id) };
      }
      if (lastError !== undefined) throw lastError;
      throw new Error('No healthy compatible upstream is available.');
    }

    options.health.beginAttempt(upstream.id);
    const startedAt = now();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error(`Upstream request timed out after ${options.reliability.requestTimeoutMs}ms.`)),
      options.reliability.requestTimeoutMs,
    );

    try {
      const response = await options.request(upstream, controller.signal, attempt);
      clearTimeout(timeout);
      const latencyMs = Math.max(0, now() - startedAt);
      const retryable = isRetryableStatus(response.status);
      const rateLimited = response.status === 429;
      const retryAfterMs = rateLimited ? retryAfterMilliseconds(response.headers, now(), options.reliability.maxRetryAfterMs) : undefined;
      options.health.completeAttempt(upstream.id, {
        ok: !retryable,
        retryable,
        rateLimited,
        latencyMs,
        status: response.status,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      });
      attempts.push({ upstreamId: upstream.id, latencyMs, retryable, rateLimited, status: response.status });
      lastResponse = { response, upstream };
      if (!retryable || attempt >= options.reliability.maxAttempts || !retryBudget.tryTake()) {
        return { response, upstream, attempts, fallback: attempts.some((item) => item.upstreamId !== upstream.id) };
      }

      await cancelResponse(response);
      attempted.add(upstream.id);
      const delay = retryAfterMs ?? backoffMilliseconds(options.reliability, attempt - 1, random);
      if (delay > 0) await sleep(delay);
    } catch (error) {
      clearTimeout(timeout);
      const latencyMs = Math.max(0, now() - startedAt);
      const classification = errorClass(error);
      options.health.completeAttempt(upstream.id, { ok: false, retryable: true, latencyMs });
      attempts.push({ upstreamId: upstream.id, latencyMs, retryable: true, rateLimited: false, errorClass: classification });
      lastError = error;
      if (attempt >= options.reliability.maxAttempts || !retryBudget.tryTake()) throw error;
      attempted.add(upstream.id);
      const delay = backoffMilliseconds(options.reliability, attempt - 1, random);
      if (delay > 0) await sleep(delay);
    }
  }

  if (lastResponse !== undefined) return { ...lastResponse, attempts, fallback: attempts.length > 1 };
  if (lastError !== undefined) throw lastError;
  throw new Error('Reliable fetch ended without a response or error.');
}
