import { evaluateRuntimeJudgeAction } from '../runtime/policy.js';
import type { RuntimePolicyState } from '../runtime/types.js';
import type { CoordinatedRuntimeDecision, RuntimeJudge, RuntimeJudgeAction, RuntimeJudgeInput } from './types.js';

const ACTION_RANK: Record<RuntimeJudgeAction, number> = {
  continue: 0,
  raise_effort: 1,
  switch_model: 2,
  restart_clean: 3,
  escalate_human: 4,
};

function policyState(input: RuntimeJudgeInput): RuntimePolicyState {
  return {
    initialTier: input.snapshot.initialTier,
    currentTier: input.snapshot.currentTier,
    currentEffort: input.snapshot.currentEffort,
    modelLadder: input.snapshot.modelLadder,
    relativeCost: input.snapshot.relativeCost,
    contextTokens: input.snapshot.contextTokens,
    switches: input.snapshot.switches,
    restarts: input.snapshot.restarts,
    badCheckpoints: input.snapshot.badCheckpoints,
  };
}

export async function coordinateRuntimeDecision(judge: RuntimeJudge, input: RuntimeJudgeInput): Promise<CoordinatedRuntimeDecision> {
  if (input.deterministicDecision.action !== 'continue') {
    return { decision: input.deterministicDecision, source: 'deterministic' };
  }
  try {
    const verdict = await judge.evaluate(input);
    if (!Object.hasOwn(ACTION_RANK, verdict.action)) throw new Error('Runtime judge returned an unsupported action.');
    if (ACTION_RANK[verdict.action] <= ACTION_RANK.continue) {
      return { decision: input.deterministicDecision, source: 'deterministic', judgeReason: verdict.reason };
    }
    const constrained = evaluateRuntimeJudgeAction(policyState(input), verdict.action, input.signals, input.policy);
    return {
      decision: constrained,
      source: constrained.action === 'stop_budget' ? 'deterministic' : 'judge',
      judgeReason: verdict.reason,
    };
  } catch (error) {
    return {
      decision: input.deterministicDecision,
      source: 'fail-open',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
