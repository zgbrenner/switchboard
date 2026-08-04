import type { RuntimeJudge, RuntimeJudgeInput, RuntimeJudgeVerdict } from './types.js';

export class DeterministicRuntimeJudge implements RuntimeJudge {
  evaluate(_input: RuntimeJudgeInput): Promise<RuntimeJudgeVerdict> {
    return Promise.resolve({ action: 'continue', reason: 'The deterministic runtime policy remains authoritative.' });
  }
}
