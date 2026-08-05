import type { EffortLevel, QualityTier } from '../shared/types.js';
import type { RuntimeDecision, RuntimePolicyConfig, RuntimePolicyState, RuntimeSignal } from './types.js';

const TIER_ORDER: QualityTier[] = ['fast', 'balanced', 'deep', 'max'];
const EFFORT_ORDER: EffortLevel[] = ['low', 'medium', 'high', 'max'];
type RuntimeEscalationRequest = 'continue' | 'raise_effort' | 'switch_model' | 'restart_clean' | 'escalate_human';

export const DEFAULT_RUNTIME_POLICY: RuntimePolicyConfig = Object.freeze({
  maxRelativeCost: 10,
  maxContextTokens: 120_000,
  maxSwitches: 3,
  maxRestarts: 1,
  maxRetainedSteps: 256,
  actionRepeatThreshold: 3,
  errorRepeatThreshold: 3,
  pingPongThreshold: 4,
  rewriteRetestThreshold: 4,
  maxConsecutiveFailures: 3,
  maxStepsWithoutProgress: 6,
  badCheckpointThreshold: 2,
});

export function normalizeRuntimePolicy(policy: Partial<RuntimePolicyConfig> = {}): RuntimePolicyConfig {
  const merged = { ...DEFAULT_RUNTIME_POLICY, ...policy };
  for (const [key, value] of Object.entries(merged)) {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`${key} must be a finite non-negative number.`);
  }
  if (merged.maxRetainedSteps < 1) throw new TypeError('maxRetainedSteps must be at least 1.');
  if (merged.badCheckpointThreshold < 1) throw new TypeError('badCheckpointThreshold must be at least 1.');
  return merged;
}

function tierIndex(tier: QualityTier): number {
  return TIER_ORDER.indexOf(tier);
}

export function normalizeModelLadder(initialTier: QualityTier, ladder?: QualityTier[]): QualityTier[] {
  const requested = ladder ?? TIER_ORDER;
  const floor = tierIndex(initialTier);
  const normalized = [...new Set(requested)]
    .filter((tier) => tierIndex(tier) >= floor)
    .sort((left, right) => tierIndex(left) - tierIndex(right));
  if (!normalized.includes(initialTier)) normalized.unshift(initialTier);
  return [...new Set(normalized)].sort((left, right) => tierIndex(left) - tierIndex(right));
}

function nextEffort(tier: QualityTier, effort: EffortLevel): EffortLevel | undefined {
  const ceilingByTier: Record<QualityTier, EffortLevel> = { fast: 'medium', balanced: 'high', deep: 'high', max: 'max' };
  const currentIndex = EFFORT_ORDER.indexOf(effort);
  const ceilingIndex = EFFORT_ORDER.indexOf(ceilingByTier[tier]);
  if (currentIndex >= ceilingIndex) return undefined;
  return EFFORT_ORDER[currentIndex + 1];
}

function nextTier(state: RuntimePolicyState): QualityTier | undefined {
  const index = state.modelLadder.indexOf(state.currentTier);
  return state.modelLadder[index + 1];
}

function decision(
  action: RuntimeDecision['action'],
  signals: RuntimeSignal[],
  options: { targetTier?: QualityTier; targetEffort?: EffortLevel; reasonCodes?: string[] } = {},
): RuntimeDecision {
  return {
    action,
    reasonCodes: options.reasonCodes ?? signals.map((item) => item.code),
    signals,
    ...(options.targetTier === undefined ? {} : { targetTier: options.targetTier }),
    ...(options.targetEffort === undefined ? {} : { targetEffort: options.targetEffort }),
    preserveArtifacts: action === 'restart_clean',
    dropNarration: action === 'restart_clean',
  };
}

function budgetDecision(state: RuntimePolicyState, signals: RuntimeSignal[], policy: RuntimePolicyConfig): RuntimeDecision | undefined {
  if (state.relativeCost >= policy.maxRelativeCost) {
    return decision('stop_budget', signals, { reasonCodes: ['relative-cost-budget-exhausted'] });
  }
  if (state.contextTokens >= policy.maxContextTokens) {
    if (state.restarts < policy.maxRestarts) return decision('restart_clean', signals, { reasonCodes: ['context-budget-exhausted'] });
    return decision('escalate_human', signals, {
      reasonCodes: ['context-budget-exhausted', 'restart-budget-exhausted'],
    });
  }
  return undefined;
}

function switchRestartOrHuman(state: RuntimePolicyState, signals: RuntimeSignal[], policy: RuntimePolicyConfig): RuntimeDecision {
  const tier = nextTier(state);
  if (tier !== undefined && state.switches < policy.maxSwitches) return decision('switch_model', signals, { targetTier: tier });
  if (state.restarts < policy.maxRestarts) return decision('restart_clean', signals);
  return decision('escalate_human', signals, {
    reasonCodes: [...signals.map((item) => item.code), 'runtime-intervention-budget-exhausted'],
  });
}

export function evaluateRuntimePolicy(state: RuntimePolicyState, signals: RuntimeSignal[], policy: RuntimePolicyConfig): RuntimeDecision {
  const budget = budgetDecision(state, signals, policy);
  if (budget !== undefined) return budget;
  if (signals.length === 0) return decision('continue', signals, { reasonCodes: ['no-runtime-intervention-signal'] });

  const severe = signals.some((item) => item.severity === 'severe');
  const checkpointReady = severe || state.badCheckpoints >= policy.badCheckpointThreshold;
  if (!checkpointReady) return decision('continue', signals, { reasonCodes: ['intervention-hysteresis'] });

  const effort = nextEffort(state.currentTier, state.currentEffort);
  if (effort !== undefined) return decision('raise_effort', signals, { targetEffort: effort });
  return switchRestartOrHuman(state, signals, policy);
}

export function evaluateRuntimeJudgeAction(
  state: RuntimePolicyState,
  requestedAction: RuntimeEscalationRequest,
  signals: RuntimeSignal[],
  policy: RuntimePolicyConfig,
): RuntimeDecision {
  const budget = budgetDecision(state, signals, policy);
  if (budget !== undefined) return budget;
  const reasonCodes = ['judge-escalation', `judge-requested-${requestedAction}`];
  const judgeSignals = signals;
  if (requestedAction === 'continue') return decision('continue', judgeSignals, { reasonCodes });
  if (requestedAction === 'escalate_human') return decision('escalate_human', judgeSignals, { reasonCodes });
  if (requestedAction === 'restart_clean') {
    if (state.restarts < policy.maxRestarts) return decision('restart_clean', judgeSignals, { reasonCodes });
    return decision('escalate_human', judgeSignals, { reasonCodes: [...reasonCodes, 'restart-budget-exhausted'] });
  }
  if (requestedAction === 'raise_effort') {
    const effort = nextEffort(state.currentTier, state.currentEffort);
    if (effort !== undefined) return decision('raise_effort', judgeSignals, { targetEffort: effort, reasonCodes });
  }
  const constrained = switchRestartOrHuman(state, judgeSignals, policy);
  return { ...constrained, reasonCodes: [...reasonCodes, ...constrained.reasonCodes] };
}
