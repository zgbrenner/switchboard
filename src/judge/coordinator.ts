import type { EffortLevel, QualityTier } from '../shared/types.js';
import type { RuntimeDecision } from '../runtime/types.js';
import type { CoordinatedRuntimeDecision, RuntimeJudge, RuntimeJudgeAction, RuntimeJudgeInput } from './types.js';

const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'max'];
const ACTION_RANK: Record<RuntimeJudgeAction, number> = {
  continue: 0,
  raise_effort: 1,
  switch_model: 2,
  restart_clean: 3,
  escalate_human: 4,
};

function nextEffort(current: EffortLevel): EffortLevel | undefined {
  return EFFORTS[EFFORTS.indexOf(current) + 1];
}

function nextTier(current: QualityTier, ladder: QualityTier[]): QualityTier | undefined {
  return ladder[ladder.indexOf(current) + 1];
}

function fromJudge(action: RuntimeJudgeAction, input: RuntimeJudgeInput): RuntimeDecision {
  const base = {
    reasonCodes: ['judge-escalation'],
    signals: input.signals,
    preserveArtifacts: action === 'restart_clean',
    dropNarration: action === 'restart_clean',
  };
  if (action === 'raise_effort') {
    const effort = nextEffort(input.snapshot.currentEffort);
    if (effort !== undefined) return { ...base, action, targetEffort: effort };
    const tier = nextTier(input.snapshot.currentTier, input.snapshot.modelLadder);
    if (tier !== undefined) return { ...base, action: 'switch_model', targetTier: tier };
    return { ...base, action: 'restart_clean', preserveArtifacts: true, dropNarration: true };
  }
  if (action === 'switch_model') {
    const tier = nextTier(input.snapshot.currentTier, input.snapshot.modelLadder);
    if (tier !== undefined) return { ...base, action, targetTier: tier };
    return { ...base, action: 'restart_clean', preserveArtifacts: true, dropNarration: true };
  }
  return { ...base, action };
}

export async function coordinateRuntimeDecision(
  judge: RuntimeJudge,
  input: RuntimeJudgeInput,
): Promise<CoordinatedRuntimeDecision> {
  if (input.deterministicDecision.action !== 'continue') {
    return { decision: input.deterministicDecision, source: 'deterministic' };
  }
  try {
    const verdict = await judge.evaluate(input);
    if (!Object.hasOwn(ACTION_RANK, verdict.action)) throw new Error('Runtime judge returned an unsupported action.');
    if (ACTION_RANK[verdict.action] <= ACTION_RANK.continue) {
      return { decision: input.deterministicDecision, source: 'deterministic', judgeReason: verdict.reason };
    }
    return { decision: fromJudge(verdict.action, input), source: 'judge', judgeReason: verdict.reason };
  } catch (error) {
    return {
      decision: input.deterministicDecision,
      source: 'fail-open',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
