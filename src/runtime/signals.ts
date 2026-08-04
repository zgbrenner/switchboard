import type { RuntimeEvidenceStep, RuntimePolicyConfig, RuntimeSignal } from './types.js';

function completed(steps: RuntimeEvidenceStep[]): RuntimeEvidenceStep[] {
  return steps.filter((step) => step.status !== 'pending');
}

function pairKey(step: RuntimeEvidenceStep): string {
  return `${step.tool}:${step.kind}:${step.argumentsDigest}:${step.outputDigest ?? ''}:${step.status}`;
}

function actionKey(step: RuntimeEvidenceStep): string {
  return `${step.tool}:${step.kind}:${step.argumentsDigest}`;
}

function signal(
  code: RuntimeSignal['code'],
  severity: RuntimeSignal['severity'],
  detail: string,
  evidence: RuntimeEvidenceStep[],
): RuntimeSignal {
  return { code, severity, detail, evidenceIds: evidence.map((step) => step.id) };
}

function trailingRun<T>(items: T[], key: (item: T) => string): T[] {
  const last = items.at(-1);
  if (last === undefined) return [];
  const target = key(last);
  const run: T[] = [];
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item === undefined || key(item) !== target) break;
    run.unshift(item);
  }
  return run;
}

export function isVerifiedProgress(step: RuntimeEvidenceStep): boolean {
  return step.status === 'success' && (step.kind === 'execute' || step.kind === 'verify');
}

export function detectRuntimeSignals(steps: RuntimeEvidenceStep[], policy: RuntimePolicyConfig): RuntimeSignal[] {
  const done = completed(steps);
  const result: RuntimeSignal[] = [];
  if (done.length === 0) return result;

  const repeatedPair = trailingRun(done, pairKey);
  if (repeatedPair.length >= policy.actionRepeatThreshold) {
    result.push(
      signal(
        'action-observation-repeat',
        'severe',
        `The same completed action and observation repeated ${repeatedPair.length} times.`,
        repeatedPair,
      ),
    );
  }

  const latest = done.at(-1);
  const errorRun = trailingRun(done, (step) =>
    step.status === 'failure' ? `failure:${step.errorClass ?? '[unclassified]'}` : `status:${step.status}`,
  );
  if (latest?.status === 'failure' && errorRun.length >= policy.errorRepeatThreshold) {
    result.push(signal('repeated-error-class', 'severe', `The same error class repeated ${errorRun.length} times.`, errorRun));
  }

  const pingCount = Math.max(4, policy.pingPongThreshold);
  const pingWindow = done.slice(-pingCount);
  if (pingWindow.length >= 4) {
    const first = actionKey(pingWindow[0] as RuntimeEvidenceStep);
    const second = actionKey(pingWindow[1] as RuntimeEvidenceStep);
    const alternates = first !== second && pingWindow.every((step, index) => actionKey(step) === (index % 2 === 0 ? first : second));
    if (alternates) result.push(signal('ping-pong', 'severe', 'The trajectory is alternating between two actions.', pingWindow));
  }

  const cycleCount = Math.max(4, policy.rewriteRetestThreshold);
  const cycle = done.slice(-cycleCount);
  if (cycle.length === cycleCount) {
    const rewriteRetest = cycle.every((step, index) =>
      index % 2 === 0 ? step.kind === 'write' : step.kind === 'verify' && step.status === 'failure',
    );
    if (rewriteRetest)
      result.push(signal('rewrite-retest-cycle', 'severe', 'Repeated rewrites are followed by failed verification.', cycle));
  }

  const failureRun = trailingRun(done, (step) => (step.status === 'failure' ? 'failure' : 'other'));
  if (latest?.status === 'failure' && failureRun.length >= policy.maxConsecutiveFailures) {
    result.push(signal('consecutive-failures', 'warning', `${failureRun.length} consecutive completed steps failed.`, failureRun));
  }

  let stepsSinceProgress = 0;
  for (let index = done.length - 1; index >= 0; index--) {
    const step = done[index];
    if (step !== undefined && isVerifiedProgress(step)) break;
    stepsSinceProgress++;
  }
  if (stepsSinceProgress >= policy.maxStepsWithoutProgress) {
    result.push(
      signal(
        'steps-since-progress',
        'warning',
        `${stepsSinceProgress} completed steps have occurred without successful execution or verification.`,
        done.slice(-stepsSinceProgress),
      ),
    );
  }

  return result;
}
