import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_RUNTIME_POLICY, detectRuntimeSignals, normalizeRuntimeObservation } from '../.test-dist/runtime/index.js';

function observation(sequence, kind, status, output) {
  return normalizeRuntimeObservation({
    sequence,
    tool: kind === 'write' ? 'write_file' : 'shell',
    kind,
    status,
    arguments: { sequence },
    output,
    ...(status === 'failure' ? { errorClass: 'AssertionError' } : {}),
  });
}

test('rewrite-retest threshold applies to the complete configured window', () => {
  const partialCycle = [
    observation(1, 'read', 'success', 'not a write'),
    observation(2, 'verify', 'failure', 'red 0'),
    observation(3, 'write', 'success', 'written 1'),
    observation(4, 'verify', 'failure', 'red 1'),
    observation(5, 'write', 'success', 'written 2'),
    observation(6, 'verify', 'failure', 'red 2'),
  ];
  const policy = { ...DEFAULT_RUNTIME_POLICY, rewriteRetestThreshold: 6 };
  const partialSignals = detectRuntimeSignals(partialCycle, policy);
  assert.ok(!partialSignals.some((signal) => signal.code === 'rewrite-retest-cycle'));

  const fullCycle = [observation(1, 'write', 'success', 'written 0'), ...partialCycle.slice(1)];
  const fullSignals = detectRuntimeSignals(fullCycle, policy);
  assert.ok(fullSignals.some((signal) => signal.code === 'rewrite-retest-cycle'));
});
