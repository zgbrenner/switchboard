# Runtime judges

A runtime judge is an optional second opinion used only when deterministic runtime policy still says `continue` despite warning evidence. Deterministic budget stops, model switches, restarts, and human escalations are authoritative and bypass the judge.

## Programmatic interface

```ts
import type { RuntimeJudge } from 'switchboard-mcp/judge';

const judge: RuntimeJudge = {
  async evaluate(input) {
    return { action: 'continue', reason: 'No additional intervention needed.' };
  },
};
```

Pass a custom judge through `createSwitchboardProxyServer(config, { route, judge })`.

## Built-in deterministic judge

The default `DeterministicRuntimeJudge` never adds an intervention. This preserves Switchboard's zero-egress behavior.

## Optional remote judge

```json
{
  "judge": {
    "type": "remote",
    "endpoint": "https://judge.example.com/evaluate",
    "tokenEnv": "SWITCHBOARD_JUDGE_TOKEN",
    "timeoutMs": 2500
  }
}
```

The remote request contains only:

- a hash of the session identifier;
- current and initial tier and effort;
- step, cost, context, switch, restart, and checkpoint counters;
- bounded signal codes, severities, and evidence counts; and
- the deterministic action.

It never contains prompts, conversation text, raw tool arguments, tool output, previews, metadata, or model response content. Remote errors, timeouts, malformed output, or unsupported actions fail open to the deterministic decision.

Allowed verdict actions are `continue`, `raise_effort`, `switch_model`, `restart_clean`, and `escalate_human`. A judge cannot demote a session or override budget policy.
