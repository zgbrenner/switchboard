import assert from 'node:assert/strict';
import test from 'node:test';
import { DeterministicRuntimeJudge, RemoteRuntimeJudge, coordinateRuntimeDecision } from '../.test-dist/judge/index.js';
import { DEFAULT_RUNTIME_POLICY } from '../.test-dist/runtime/index.js';

const policy = { ...DEFAULT_RUNTIME_POLICY };
const snapshot = {
  id: 'session-hash',
  initialTier: 'balanced',
  currentTier: 'balanced',
  currentEffort: 'medium',
  modelLadder: ['balanced', 'deep', 'max'],
  steps: [
    {
      id: 'step-hash',
      sequence: 1,
      timestamp: 1,
      tool: 'shell',
      kind: 'verify',
      status: 'failure',
      argumentsDigest: 'a'.repeat(64),
      outputDigest: 'b'.repeat(64),
      preview: 'SECRET RAW OUTPUT',
      errorClass: 'AssertionError',
      relativeCost: 0.1,
      contextTokens: 100,
      metadata: { secret: 'do-not-send' },
    },
  ],
  decisions: [],
  totalSteps: 1,
  relativeCost: 0.1,
  contextTokens: 100,
  switches: 0,
  restarts: 0,
  badCheckpoints: 1,
  createdAt: 1,
  lastAccessedAt: 1,
};
const signals = [{ code: 'consecutive-failures', severity: 'warning', detail: '3 failures', evidenceIds: ['step-hash'] }];
const deterministicContinue = {
  action: 'continue',
  reasonCodes: ['intervention-hysteresis'],
  signals,
  preserveArtifacts: false,
  dropNarration: false,
};

test('deterministic judge preserves the deterministic decision', async () => {
  const result = await coordinateRuntimeDecision(new DeterministicRuntimeJudge(), {
    snapshot,
    signals,
    deterministicDecision: deterministicContinue,
    policy,
  });
  assert.equal(result.decision.action, 'continue');
  assert.equal(result.source, 'deterministic');
});

test('a non-continue deterministic decision is authoritative and judge is not called', async () => {
  let calls = 0;
  const judge = {
    evaluate() {
      calls++;
      return Promise.resolve({ action: 'continue', reason: 'demote' });
    },
  };
  const deterministic = { ...deterministicContinue, action: 'switch_model', targetTier: 'deep' };
  const result = await coordinateRuntimeDecision(judge, { snapshot, signals, deterministicDecision: deterministic, policy });
  assert.equal(calls, 0);
  assert.equal(result.decision.action, 'switch_model');
  assert.equal(result.source, 'deterministic');
});

test('judge escalation is constrained to the next configured tier', async () => {
  const judge = {
    evaluate() {
      return Promise.resolve({ action: 'switch_model', reason: 'trajectory looks stuck' });
    },
  };
  const result = await coordinateRuntimeDecision(judge, {
    snapshot,
    signals,
    deterministicDecision: deterministicContinue,
    policy,
  });
  assert.equal(result.decision.action, 'switch_model');
  assert.equal(result.decision.targetTier, 'deep');
  assert.equal(result.source, 'judge');
});

test('judge cannot exceed effort, switch, restart, or cost budgets', async () => {
  const restartJudge = { evaluate: () => Promise.resolve({ action: 'restart_clean', reason: 'restart' }) };
  const noRestart = await coordinateRuntimeDecision(restartJudge, {
    snapshot,
    signals,
    deterministicDecision: deterministicContinue,
    policy: { ...policy, maxRestarts: 0 },
  });
  assert.equal(noRestart.decision.action, 'escalate_human');

  const switchJudge = { evaluate: () => Promise.resolve({ action: 'switch_model', reason: 'switch' }) };
  const noSwitch = await coordinateRuntimeDecision(switchJudge, {
    snapshot: { ...snapshot, switches: 1 },
    signals,
    deterministicDecision: deterministicContinue,
    policy: { ...policy, maxSwitches: 1 },
  });
  assert.equal(noSwitch.decision.action, 'restart_clean');

  const effortJudge = { evaluate: () => Promise.resolve({ action: 'raise_effort', reason: 'think harder' }) };
  const ceiling = await coordinateRuntimeDecision(effortJudge, {
    snapshot: { ...snapshot, currentTier: 'deep', currentEffort: 'high', modelLadder: ['deep', 'max'] },
    signals,
    deterministicDecision: deterministicContinue,
    policy,
  });
  assert.equal(ceiling.decision.action, 'switch_model');
  assert.equal(ceiling.decision.targetTier, 'max');

  const budget = await coordinateRuntimeDecision(restartJudge, {
    snapshot: { ...snapshot, relativeCost: policy.maxRelativeCost },
    signals,
    deterministicDecision: deterministicContinue,
    policy,
  });
  assert.equal(budget.decision.action, 'stop_budget');
  assert.equal(budget.source, 'deterministic');
});

test('remote judge sends only bounded structured evidence and fails open on errors', async () => {
  let sent;
  const remote = new RemoteRuntimeJudge({
    endpoint: 'https://judge.invalid/evaluate',
    timeoutMs: 50,
    fetch: (_url, init) => {
      sent = JSON.parse(init.body);
      return Promise.resolve(
        new Response(JSON.stringify({ action: 'restart_clean', reason: 'stuck' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  });
  const verdict = await remote.evaluate({ snapshot, signals, deterministicDecision: deterministicContinue, policy });
  assert.equal(verdict.action, 'restart_clean');
  const serialized = JSON.stringify(sent);
  assert.ok(!serialized.includes('SECRET RAW OUTPUT'));
  assert.ok(!serialized.includes('do-not-send'));
  assert.ok(serialized.length < 5000);

  const broken = new RemoteRuntimeJudge({
    endpoint: 'https://judge.invalid/evaluate',
    timeoutMs: 10,
    fetch: () => Promise.reject(new Error('offline')),
  });
  const result = await coordinateRuntimeDecision(broken, {
    snapshot,
    signals,
    deterministicDecision: deterministicContinue,
    policy,
  });
  assert.equal(result.decision.action, 'continue');
  assert.equal(result.source, 'fail-open');
});

test('remote judge hashes even caller-supplied session identifiers', async () => {
  let sent;
  const remote = new RemoteRuntimeJudge({
    endpoint: 'https://judge.invalid/evaluate',
    fetch: (_url, init) => {
      sent = init.body;
      return Promise.resolve(new Response(JSON.stringify({ action: 'continue', reason: 'continue' }), { status: 200 }));
    },
  });
  await remote.evaluate({
    snapshot: { ...snapshot, id: 'customer-case-very-sensitive' },
    signals,
    deterministicDecision: deterministicContinue,
    policy,
  });
  assert.ok(!sent.includes('customer-case-very-sensitive'));
});
