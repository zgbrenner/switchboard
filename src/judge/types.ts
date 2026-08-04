import type { RuntimeDecision, RuntimeSessionSnapshot, RuntimeSignal } from '../runtime/types.js';

export type RuntimeJudgeAction = 'continue' | 'raise_effort' | 'switch_model' | 'restart_clean' | 'escalate_human';

export interface RuntimeJudgeInput {
  snapshot: RuntimeSessionSnapshot;
  signals: RuntimeSignal[];
  deterministicDecision: RuntimeDecision;
}

export interface RuntimeJudgeVerdict {
  action: RuntimeJudgeAction;
  reason: string;
}

export interface RuntimeJudge {
  evaluate(input: RuntimeJudgeInput): Promise<RuntimeJudgeVerdict>;
}

export interface CoordinatedRuntimeDecision {
  decision: RuntimeDecision;
  source: 'deterministic' | 'judge' | 'fail-open';
  judgeReason?: string;
  error?: string;
}
