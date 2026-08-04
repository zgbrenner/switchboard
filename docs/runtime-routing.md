# Runtime routing core

Switchboard's preflight router decides what a request needs before execution. The runtime core is the complementary second phase: a host feeds it completed tool observations and receives a guarded recommendation to continue, increase effort, switch upward, restart with cleaner context, escalate to a human, or stop because a budget is exhausted.

The runtime core is available from the package export:

```js
import { RuntimeSession } from 'switchboard-mcp/runtime';

const session = new RuntimeSession({
  id: 'task-123',
  initialTier: preflight.tier,
  initialEffort: preflight.effort,
  modelLadder: ['balanced', 'deep', 'max'],
  policy: { maxRelativeCost: 4, maxRestarts: 1 },
});

const result = session.observe({
  tool: 'shell',
  kind: 'verify',
  status: 'failure',
  arguments: { command: 'npm test' },
  output: 'AssertionError: expected 1',
  errorClass: 'AssertionError',
  relativeCost: 0.2,
  contextTokens: 18_400,
});

console.log(result.decision);
```

## Evidence retained

By default, observations retain stable SHA-256 digests of tool arguments and outputs, not the raw values. This is enough to detect repeated actions and repeated observations without persisting prompt or tool-result text. A caller may opt into a bounded preview when it explicitly needs one.

Pending calls are represented in the trajectory but do not count as successes, failures, or loops until a result arrives.

## What counts as progress

A successful `execute` or `verify` step resets the no-progress window. File writes, reads, searches, and narration may be useful work, but they are not treated as proof that the task is closer to completion. This prevents write/fail/write/fail thrashing from looking healthy.

## Detectors

The local deterministic layer detects:

- the same action and observation repeated several times;
- the same error class repeated without an intervening success;
- two actions alternating in a ping-pong loop;
- write, failed verification, write, failed verification cycles;
- consecutive failures; and
- too many steps without successful execution or verification.

## Guardrails

Budget checks run before intervention logic. The configured preflight tier is a hard minimum: runtime routing may increase effort or move upward through the ladder, but it never demotes below the initial tier. A switch or clean restart opens a new signal window so the replacement model is not immediately punished for the previous model's history.

A `restart_clean` decision includes `preserveArtifacts: true` and `dropNarration: true`. The host should retain the task, tool calls, real tool outputs, and produced artifacts while omitting stale assistant narration and provider-specific reasoning payloads.

## Session storage

`RuntimeSessionStore` provides bounded in-memory storage with a configurable maximum session count and idle TTL. It evicts the least recently used session at capacity. The runtime core itself performs no network requests and has no runtime dependencies.

This module is advisory. Automatic interception and provider-wire translation are implemented separately by the optional proxy layer.
