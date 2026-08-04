import { stableDigest } from '../runtime/digest.js';
import type { RuntimeJudge, RuntimeJudgeInput, RuntimeJudgeVerdict } from './types.js';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RemoteRuntimeJudgeOptions {
  endpoint: string;
  token?: string;
  timeoutMs?: number;
  fetch?: FetchLike;
}

const ACTIONS = new Set(['continue', 'raise_effort', 'switch_model', 'restart_clean', 'escalate_human']);

function boundedPayload(input: RuntimeJudgeInput): object {
  return {
    protocolVersion: 1,
    session: {
      idDigest: stableDigest(input.snapshot.id),
      initialTier: input.snapshot.initialTier,
      currentTier: input.snapshot.currentTier,
      currentEffort: input.snapshot.currentEffort,
      modelLadder: input.snapshot.modelLadder,
      totalSteps: input.snapshot.totalSteps,
      relativeCost: input.snapshot.relativeCost,
      contextTokens: input.snapshot.contextTokens,
      switches: input.snapshot.switches,
      restarts: input.snapshot.restarts,
      badCheckpoints: input.snapshot.badCheckpoints,
    },
    signals: input.signals.slice(0, 16).map((signal) => ({
      code: signal.code,
      severity: signal.severity,
      evidenceCount: signal.evidenceIds.length,
    })),
    deterministicAction: input.deterministicDecision.action,
  };
}

export class RemoteRuntimeJudge implements RuntimeJudge {
  private readonly endpoint: string;
  private readonly token: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: RemoteRuntimeJudgeOptions) {
    const endpoint = new URL(options.endpoint);
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new TypeError('Remote judge endpoint must use HTTP or HTTPS.');
    this.endpoint = endpoint.toString();
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 2500;
    this.fetchImpl = options.fetch ?? fetch;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30_000) {
      throw new TypeError('Remote judge timeoutMs must be between 1 and 30000.');
    }
  }

  async evaluate(input: RuntimeJudgeInput): Promise<RuntimeJudgeVerdict> {
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token === undefined ? {} : { authorization: `Bearer ${this.token}` }),
      },
      body: JSON.stringify(boundedPayload(input)),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Remote judge returned HTTP ${response.status}.`);
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Remote judge returned an invalid object.');
    const action = (value as { action?: unknown }).action;
    const reason = (value as { reason?: unknown }).reason;
    if (typeof action !== 'string' || !ACTIONS.has(action)) throw new Error('Remote judge returned an invalid action.');
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw new Error('Remote judge returned an invalid reason.');
    return { action: action as RuntimeJudgeVerdict['action'], reason: reason.trim() };
  }
}
