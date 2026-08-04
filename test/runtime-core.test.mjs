import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_RUNTIME_POLICY,
  RuntimeSession,
  RuntimeSessionStore,
  detectRuntimeSignals,
  normalizeRuntimeObservation,
  stableDigest,
} from '../.test-dist/runtime/index.js';

function observation(sequence, overrides = {}) {
  return normalizeRuntimeObservation({
    sequence,
    tool: 'shell',
    kind: 'execute',
    status: 'success',
    arguments: { command: `echo ${sequence}` },
    output: `ok ${sequence}`,
    ...overrides,
  });
}

test('stableDigest is independent of object key order and changes with values', () => {
  assert.equal(stableDigest({ a: 1, b: { x: true, y: 2 } }), stableDigest({ b: { y: 2, x: true }, a: 1 }));
  assert.notEqual(stableDigest({ a: 1 }), stableDigest({ a: 2 }));
});

test('normalization stores digests and metadata without retaining raw arguments or output by default', () => {
  const secret = 'customer-secret-123';
  const step = normalizeRuntimeObservation({
    sequence: 1,
    tool: 'write_file',
    kind: 'write',
    status: 'success',
    arguments: { path: '/tmp/a', text: secret },
    output: secret,
  });
  assert.equal(step.tool, 'write_file');
  assert.equal(step.kind, 'write');
  assert.equal(step.status, 'success');
  assert.equal(typeof step.argumentsDigest, 'string');
  assert.equal(typeof step.outputDigest, 'string');
  assert.ok(!JSON.stringify(step).includes(secret));
  assert.equal(step.preview, undefined);
});

test('normalization supports bounded opt-in previews and pending calls', () => {
  const step = normalizeRuntimeObservation(
    {
      sequence: 2,
      tool: 'search',
      kind: 'search',
      status: 'pending',
      arguments: { q: 'x'.repeat(500) },
    },
    { includePreview: true, previewCharacters: 24 },
  );
  assert.equal(step.status, 'pending');
  assert.equal(step.outputDigest, undefined);
  assert.ok((step.preview?.length ?? 0) <= 24);
});

test('repeated completed action-observation pairs are detected while pending calls are ignored', () => {
  const repeated = [1, 2, 3].map((sequence) =>
    observation(sequence, {
      arguments: { command: 'npm test' },
      output: 'AssertionError: expected 1',
      status: 'failure',
      errorClass: 'AssertionError',
    }),
  );
  const pending = observation(4, { arguments: { command: 'npm test' }, status: 'pending', output: undefined });
  const signals = detectRuntimeSignals([...repeated, pending], DEFAULT_RUNTIME_POLICY);
  assert.ok(signals.some((signal) => signal.code === 'action-observation-repeat'));
});

test('repeated error classes, ping-pong, and rewrite-retest cycles are detected', () => {
  const repeatedErrors = [1, 2, 3].map((sequence) =>
    observation(sequence, { status: 'failure', errorClass: 'TypeError', output: `failure ${sequence}` }),
  );
  assert.ok(detectRuntimeSignals(repeatedErrors, DEFAULT_RUNTIME_POLICY).some((signal) => signal.code === 'repeated-error-class'));

  const pingPong = [
    observation(1, { tool: 'read_file', kind: 'read', arguments: { path: 'a' }, output: 'A' }),
    observation(2, { tool: 'read_file', kind: 'read', arguments: { path: 'b' }, output: 'B' }),
    observation(3, { tool: 'read_file', kind: 'read', arguments: { path: 'a' }, output: 'A' }),
    observation(4, { tool: 'read_file', kind: 'read', arguments: { path: 'b' }, output: 'B' }),
  ];
  assert.ok(detectRuntimeSignals(pingPong, DEFAULT_RUNTIME_POLICY).some((signal) => signal.code === 'ping-pong'));

  const rewriteRetest = [
    observation(1, { tool: 'write_file', kind: 'write', arguments: { path: 'x', content: 'a' }, output: 'written' }),
    observation(2, {
      tool: 'shell',
      kind: 'verify',
      arguments: { command: 'npm test' },
      status: 'failure',
      errorClass: 'AssertionError',
      output: 'red',
    }),
    observation(3, { tool: 'write_file', kind: 'write', arguments: { path: 'x', content: 'b' }, output: 'written' }),
    observation(4, {
      tool: 'shell',
      kind: 'verify',
      arguments: { command: 'npm test' },
      status: 'failure',
      errorClass: 'AssertionError',
      output: 'red again',
    }),
  ];
  assert.ok(detectRuntimeSignals(rewriteRetest, DEFAULT_RUNTIME_POLICY).some((signal) => signal.code === 'rewrite-retest-cycle'));
});

test('a successful completed step interrupts a repeated-error streak', () => {
  const steps = [
    observation(1, { status: 'failure', errorClass: 'TypeError', output: 'red 1' }),
    observation(2, { status: 'success', output: 'green' }),
    observation(3, { status: 'failure', errorClass: 'TypeError', output: 'red 2' }),
    observation(4, { status: 'failure', errorClass: 'TypeError', output: 'red 3' }),
  ];
  const signals = detectRuntimeSignals(steps, { ...DEFAULT_RUNTIME_POLICY, errorRepeatThreshold: 3 });
  assert.ok(!signals.some((signal) => signal.code === 'repeated-error-class'));
});

test('only successful execute or verify steps reset the no-progress counter', () => {
  const steps = [
    observation(1, { kind: 'verify', status: 'success', output: 'pass' }),
    observation(2, { kind: 'write', status: 'success', output: 'written' }),
    observation(3, { kind: 'read', status: 'success', output: 'read' }),
    observation(4, { kind: 'search', status: 'success', output: 'found' }),
  ];
  const signals = detectRuntimeSignals(steps, { ...DEFAULT_RUNTIME_POLICY, maxStepsWithoutProgress: 3 });
  assert.ok(signals.some((signal) => signal.code === 'steps-since-progress'));
});

test('budget exhaustion stops before loop intervention', () => {
  const session = new RuntimeSession({
    id: 'budget',
    initialTier: 'balanced',
    initialEffort: 'medium',
    modelLadder: ['balanced', 'deep', 'max'],
    policy: { maxRelativeCost: 1 },
  });
  const result = session.observe({
    tool: 'shell',
    kind: 'verify',
    status: 'failure',
    arguments: { command: 'npm test' },
    output: 'red',
    errorClass: 'AssertionError',
    relativeCost: 1,
  });
  assert.equal(result.decision.action, 'stop_budget');
});

test('runtime intervention raises effort before switching and never demotes below the initial tier', () => {
  const session = new RuntimeSession({
    id: 'ladder',
    initialTier: 'deep',
    initialEffort: 'medium',
    modelLadder: ['fast', 'balanced', 'deep', 'max'],
    policy: { errorRepeatThreshold: 2, badCheckpointThreshold: 1 },
  });
  session.observe({
    tool: 'shell',
    kind: 'verify',
    status: 'failure',
    arguments: { command: 'npm test' },
    output: 'red',
    errorClass: 'TypeError',
  });
  const second = session.observe({
    tool: 'shell',
    kind: 'verify',
    status: 'failure',
    arguments: { command: 'npm test' },
    output: 'red again',
    errorClass: 'TypeError',
  });
  assert.equal(second.decision.action, 'raise_effort');
  assert.equal(second.snapshot.currentTier, 'deep');
  assert.equal(second.snapshot.currentEffort, 'high');

  const third = session.observe({
    tool: 'shell',
    kind: 'verify',
    status: 'failure',
    arguments: { command: 'npm test' },
    output: 'red third',
    errorClass: 'TypeError',
  });
  assert.equal(third.decision.action, 'switch_model');
  assert.equal(third.snapshot.currentTier, 'max');
});

test('strongest-tier failure produces clean restart instructions and then human escalation when restarts are exhausted', () => {
  const session = new RuntimeSession({
    id: 'restart',
    initialTier: 'max',
    initialEffort: 'max',
    modelLadder: ['max'],
    policy: { errorRepeatThreshold: 2, badCheckpointThreshold: 1, maxRestarts: 1 },
  });
  session.observe({
    tool: 'shell',
    kind: 'verify',
    status: 'failure',
    arguments: { command: 'npm test' },
    output: 'red',
    errorClass: 'TypeError',
  });
  const restart = session.observe({
    tool: 'shell',
    kind: 'verify',
    status: 'failure',
    arguments: { command: 'npm test' },
    output: 'red again',
    errorClass: 'TypeError',
  });
  assert.equal(restart.decision.action, 'restart_clean');
  assert.equal(restart.decision.preserveArtifacts, true);
  assert.equal(restart.decision.dropNarration, true);

  const afterRestart = session.observe({
    tool: 'shell',
    kind: 'verify',
    status: 'failure',
    arguments: { command: 'npm test' },
    output: 'red 3',
    errorClass: 'TypeError',
  });
  assert.equal(afterRestart.decision.action, 'continue');
  const human = session.observe({
    tool: 'shell',
    kind: 'verify',
    status: 'failure',
    arguments: { command: 'npm test' },
    output: 'red 4',
    errorClass: 'TypeError',
  });
  assert.equal(human.decision.action, 'escalate_human');
});

test('session retention is bounded without losing cumulative budget accounting', () => {
  const session = new RuntimeSession({
    id: 'bounded',
    initialTier: 'fast',
    initialEffort: 'low',
    policy: { maxRetainedSteps: 3, maxRelativeCost: 100 },
  });
  for (let index = 0; index < 5; index++) {
    session.observe({
      tool: 'read_file',
      kind: 'read',
      status: 'success',
      arguments: { path: String(index) },
      output: String(index),
      relativeCost: 1,
    });
  }
  const snapshot = session.snapshot();
  assert.equal(snapshot.steps.length, 3);
  assert.equal(snapshot.totalSteps, 5);
  assert.equal(snapshot.relativeCost, 5);
});

test('session store expires idle sessions and evicts the least recently used session at capacity', () => {
  let now = 1000;
  const store = new RuntimeSessionStore({ maxSessions: 2, ttlMs: 100, now: () => now });
  store.create({ id: 'a', initialTier: 'fast', initialEffort: 'low' });
  now += 10;
  store.create({ id: 'b', initialTier: 'fast', initialEffort: 'low' });
  now += 1;
  assert.ok(store.get('a'));
  now += 1;
  store.create({ id: 'c', initialTier: 'fast', initialEffort: 'low' });
  assert.ok(store.get('a'));
  assert.equal(store.get('b'), undefined);
  assert.ok(store.get('c'));

  now += 101;
  assert.equal(store.get('a'), undefined);
  assert.equal(store.size, 0);
});
