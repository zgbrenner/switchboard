import type { EffortLevel, QualityTier } from '../shared/types.js';
import { evaluateRuntimePolicy, normalizeModelLadder, normalizeRuntimePolicy } from './policy.js';
import { detectRuntimeSignals, isVerifiedProgress } from './signals.js';
import { normalizeRuntimeObservation } from './trajectory.js';
import type {
  RuntimeDecision,
  RuntimeEvidenceStep,
  RuntimeObservationInput,
  RuntimeObservationResult,
  RuntimePolicyConfig,
  RuntimeSessionConfig,
  RuntimeSessionSnapshot,
  RuntimeSessionStoreOptions,
} from './types.js';

function cap<T>(items: T[], limit: number): void {
  const overflow = items.length - limit;
  if (overflow > 0) items.splice(0, overflow);
}

export class RuntimeSession {
  readonly id: string;
  readonly initialTier: QualityTier;
  readonly modelLadder: QualityTier[];
  readonly policy: RuntimePolicyConfig;
  readonly createdAt: number;
  private currentTierValue: QualityTier;
  private currentEffortValue: EffortLevel;
  private readonly stepsValue: RuntimeEvidenceStep[] = [];
  private readonly decisionsValue: RuntimeDecision[] = [];
  private totalStepsValue = 0;
  private relativeCostValue = 0;
  private contextTokensValue = 0;
  private switchesValue = 0;
  private restartsValue = 0;
  private badCheckpointsValue = 0;
  private signalWindowStartSequenceValue = 0;
  private lastAccessedAtValue: number;
  private readonly now: () => number;

  constructor(config: RuntimeSessionConfig, options: { now?: () => number } = {}) {
    this.id = config.id.trim();
    if (!this.id) throw new TypeError('id must be a non-empty string.');
    this.initialTier = config.initialTier;
    this.currentTierValue = config.initialTier;
    this.currentEffortValue = config.initialEffort;
    this.modelLadder = normalizeModelLadder(config.initialTier, config.modelLadder);
    this.policy = normalizeRuntimePolicy(config.policy);
    this.now = options.now ?? Date.now;
    this.createdAt = this.now();
    this.lastAccessedAtValue = this.createdAt;
  }

  get lastAccessedAt(): number {
    return this.lastAccessedAtValue;
  }

  touch(): void {
    this.lastAccessedAtValue = this.now();
  }

  observe(input: RuntimeObservationInput): RuntimeObservationResult {
    this.touch();
    const sequence = input.sequence ?? this.totalStepsValue + 1;
    const step = normalizeRuntimeObservation({ ...input, sequence, timestamp: input.timestamp ?? this.now() });
    this.stepsValue.push(step);
    this.totalStepsValue++;
    this.relativeCostValue += step.relativeCost;
    this.contextTokensValue = Math.max(this.contextTokensValue, step.contextTokens);
    cap(this.stepsValue, this.policy.maxRetainedSteps);

    const signalWindow = this.stepsValue.filter((item) => item.sequence > this.signalWindowStartSequenceValue);
    const signals = isVerifiedProgress(step) ? [] : detectRuntimeSignals(signalWindow, this.policy);
    if (step.status !== 'pending') {
      if (isVerifiedProgress(step)) {
        this.badCheckpointsValue = 0;
        this.signalWindowStartSequenceValue = step.sequence;
      } else if (signals.length > 0) this.badCheckpointsValue++;
    }

    const decision = evaluateRuntimePolicy(
      {
        initialTier: this.initialTier,
        currentTier: this.currentTierValue,
        currentEffort: this.currentEffortValue,
        modelLadder: this.modelLadder,
        relativeCost: this.relativeCostValue,
        contextTokens: this.contextTokensValue,
        switches: this.switchesValue,
        restarts: this.restartsValue,
        badCheckpoints: this.badCheckpointsValue,
      },
      signals,
      this.policy,
    );
    this.apply(decision, step.sequence);
    this.decisionsValue.push(decision);
    cap(this.decisionsValue, this.policy.maxRetainedSteps);
    return { step, signals, decision, snapshot: this.snapshot() };
  }

  reconcileDecision(decision: RuntimeDecision): RuntimeSessionSnapshot {
    const previous = this.decisionsValue.at(-1);
    if (previous === undefined || previous.action !== 'continue') {
      throw new Error('Only the latest continue decision may be reconciled.');
    }
    const sequence = this.stepsValue.at(-1)?.sequence ?? this.totalStepsValue;
    this.apply(decision, sequence);
    this.decisionsValue[this.decisionsValue.length - 1] = decision;
    return this.snapshot();
  }

  snapshot(): RuntimeSessionSnapshot {
    this.touch();
    return {
      id: this.id,
      initialTier: this.initialTier,
      currentTier: this.currentTierValue,
      currentEffort: this.currentEffortValue,
      modelLadder: [...this.modelLadder],
      steps: this.stepsValue.map((step) => ({ ...step, metadata: { ...step.metadata } })),
      decisions: this.decisionsValue.map((item) => ({
        ...item,
        reasonCodes: [...item.reasonCodes],
        signals: [...item.signals],
      })),
      totalSteps: this.totalStepsValue,
      relativeCost: this.relativeCostValue,
      contextTokens: this.contextTokensValue,
      switches: this.switchesValue,
      restarts: this.restartsValue,
      badCheckpoints: this.badCheckpointsValue,
      createdAt: this.createdAt,
      lastAccessedAt: this.lastAccessedAtValue,
    };
  }

  private apply(decision: RuntimeDecision, sequence: number): void {
    if (decision.action === 'raise_effort' && decision.targetEffort !== undefined) {
      this.currentEffortValue = decision.targetEffort;
      return;
    }
    if (decision.action === 'switch_model' && decision.targetTier !== undefined) {
      this.currentTierValue = decision.targetTier;
      this.currentEffortValue = 'max';
      this.switchesValue++;
      this.badCheckpointsValue = 0;
      this.signalWindowStartSequenceValue = sequence;
      return;
    }
    if (decision.action === 'restart_clean') {
      this.restartsValue++;
      this.badCheckpointsValue = 0;
      this.signalWindowStartSequenceValue = sequence;
    }
  }
}

interface StoredSession {
  session: RuntimeSession;
}

export class RuntimeSessionStore {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly maxSessions: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: RuntimeSessionStoreOptions = {}) {
    this.maxSessions = options.maxSessions ?? 256;
    this.ttlMs = options.ttlMs ?? 30 * 60 * 1000;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.maxSessions) || this.maxSessions < 1) throw new TypeError('maxSessions must be a positive integer.');
    if (!Number.isFinite(this.ttlMs) || this.ttlMs < 1) throw new TypeError('ttlMs must be a positive number.');
  }

  get size(): number {
    this.cleanup();
    return this.sessions.size;
  }

  create(config: RuntimeSessionConfig): RuntimeSession {
    this.cleanup();
    if (this.sessions.has(config.id)) throw new Error(`Runtime session already exists: ${config.id}`);
    while (this.sessions.size >= this.maxSessions) this.evictLeastRecentlyUsed();
    const session = new RuntimeSession(config, { now: this.now });
    this.sessions.set(session.id, { session });
    return session;
  }

  get(id: string): RuntimeSession | undefined {
    this.cleanup();
    const stored = this.sessions.get(id);
    if (stored === undefined) return undefined;
    stored.session.touch();
    return stored.session;
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }

  cleanup(): number {
    const cutoff = this.now() - this.ttlMs;
    let removed = 0;
    for (const [id, stored] of this.sessions) {
      if (stored.session.lastAccessedAt <= cutoff) {
        this.sessions.delete(id);
        removed++;
      }
    }
    return removed;
  }

  private evictLeastRecentlyUsed(): void {
    let candidate: { id: string; accessed: number } | undefined;
    for (const [id, stored] of this.sessions) {
      const accessed = stored.session.lastAccessedAt;
      if (candidate === undefined || accessed < candidate.accessed) candidate = { id, accessed };
    }
    if (candidate !== undefined) this.sessions.delete(candidate.id);
  }
}
