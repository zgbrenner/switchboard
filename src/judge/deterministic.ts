import type { RuntimeJudge, RuntimeJudgeInput, RuntimeJudgeVerdict } from './types.js';

export class DeterministicRuntimeJudge implements RuntimeJudge {
  async evaluate(_input: RuntimeJudgeInput): Promise<RuntimeJudgeVerdict> {
    return { action: 'continue', reason: 'The deterministic runtime policy remains authoritative.' };
  }
}
