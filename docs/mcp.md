# Switchboard MCP 0.5 reference

**Version:** 0.6.0  
**Switchboard API contract:** `2026-07-24`  
**MCP revision:** `2025-11-25`  
**Compatible revisions:** `2025-06-18`, `2025-03-26`

Switchboard is a local MCP server for request classification, execution planning, model-inventory negotiation, diagnostics, evaluation, and bounded aggregate preference learning. It does not invoke a provider model or contact a routing backend.

## Build and start

```bash
npm install
npm run build
node /absolute/path/to/switchboard/mcp/index.mjs --transport=stdio
```

The default build compiles only the shared router runtime required by MCP.

## Lifecycle

A stateful client:

1. Sends `initialize`.
2. Reads the negotiated protocol revision.
3. Sends `notifications/initialized`.
4. Uses tools, resources, prompts, completion, or `ping`.

Before initialization, only `initialize` and `ping` are accepted. Ordinary operations remain gated until the initialized notification.

## Streamable HTTP

```bash
node mcp/index.mjs --transport=http --host=127.0.0.1 --port=3764
```

Endpoint: `http://127.0.0.1:3764/mcp`

Initialization returns `MCP-Session-Id`. Later requests include:

```text
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Session-Id: <session-id>
MCP-Protocol-Version: <negotiated-version>
```

`DELETE` terminates a session. GET returns 405 because Switchboard does not emit server-initiated events.

### HTTP protections

- Loopback binding by default
- Authentication required for non-loopback binding
- Optional bearer token via `SWITCHBOARD_MCP_TOKEN`
- Timing-safe token comparison
- Host and Origin validation
- 1 MiB request-body limit
- Random session IDs
- Session expiry and explicit deletion
- Configurable active-session limit

## Tool surface

### `route_request`

Classifies and plans one request. Inputs can include:

- `prompt`
- Up to 8 recent `context` turns
- Up to 20 bounded file metadata/excerpt records
- `policy`: `best`, `balanced`, `fast`, or `conserve`
- A built-in `profile`
- Bounded `categoryBoosts`
- Up to 64 `availableModels`
- `currentModelId`
- Normalized `budget`
- `planMode`: `single`, `auto`, or `multi`
- `apiVersion`: `2026-07-24`

The server never opens host file paths. A host supplies any file metadata or excerpt it wants considered.

The output includes:

- `tier`, `effort`, capabilities, confidence, scores, reasons, and task categories
- Effective profile and policy
- Confidence evidence
- Single-stage or multi-stage execution plan
- Budget assessment
- Concrete model resolution and capability-negotiation details
- Aggregate-learning adjustment metadata
- API compatibility metadata

### `explain_route`

Uses the same request input and returns a concise summary plus structured route, required capabilities, reasons, confidence evidence, execution plan, budget assessment, and model resolution.

### `compare_routes` and `simulate_policy`

Accept one request plus 2 to 8 labeled policy/profile variants. They report each variant’s route, model, budget fit, and stage count, plus tier spread and other differences. Neither changes preference state.

### `validate_model_inventory`

Validates up to 64 models and reports:

- Model count and available count
- Tier distribution
- Confirmed capability coverage
- Unavailable IDs
- Models with omitted capability declarations
- Integration warnings

### `evaluate_router`

Evaluates 1 to 100 labeled cases and returns exact-tier accuracy, harmful under-routing, over-routing, capability recall, confusion matrix, and per-case details.

By default, learned preferences are excluded from baseline metrics. With `includePreferences: true`, Switchboard also reports the observed preference-adjusted tier while keeping baseline metrics preference independent.

### `record_override`

Accepts only category-level feedback:

```json
{
  "categories": ["analysis"],
  "recommendedTier": "balanced",
  "selectedTier": "deep"
}
```

Raw prompt, context, file, model, note, and unknown fields are rejected.

### `get_preference_state`

Returns aggregate category biases and counters. It never returns prompts because prompts are never stored.

### `reset_preference_state`

Deletes all aggregate preference state. It is marked destructive and idempotent in MCP annotations.

## Profiles

Profiles are provider independent:

- `general`
- `coding`
- `legal`
- `research`
- `creative`
- `security`
- `finance`
- `medical`
- `low-cost`
- `low-latency`

Profiles can raise minimum tier or capability requirements and provide a default policy. An explicitly supplied policy wins. Profiles cannot lower deterministic floors.

## Budget semantics

Budget values are normalized comparative values, not provider billing forecasts:

- `maxRelativeCost`
- `maxRelativeLatency`
- `minQuality`
- `maxStages` from 1 to 4

`budgetAssessment.violations` can include:

- `cost`
- `latency`
- `quality`
- `modelRequirements`

`modelCompatibility` is `not-evaluated`, `compatible`, or `incompatible`. A route cannot report `fits: true` when the supplied inventory has no compatible model or its recommendation does not meet the requested tier, effort, and confirmed capabilities.

## Model inventory contract

Each host model may declare:

- Stable host-local `id`
- Optional title and family
- Abstract tier
- Supported effort levels
- Capability map
- Relative cost and latency
- Availability

Capability values mean:

- `true`: confirmed support
- `false`: confirmed lack of support; rejected when required
- omitted: unknown; retained with a ranking penalty

The resolution includes required capabilities, eligible-model count, and explicit rejection reasons such as `missing:web` or `unavailable`.

## Aggregate learning

Unconfigured sessions have isolated in-memory stores. To share state across sessions, configure an explicit path:

```bash
export SWITCHBOARD_MCP_STATE_PATH="$HOME/.local/state/switchboard/preferences.json"
```

Persistent state:

- Contains category names, bounded biases, and counters only
- Is limited to 1 MiB
- Uses atomic replacement
- Serializes writes
- Allows failed loads to be corrected and retried

Learned adjustments move at most one tier. Learned downgrades cannot cross required-capability or high-stakes floors.

## Resources

- `switchboard://policies`
- `switchboard://profiles`
- `switchboard://capabilities`
- `switchboard://api`
- `switchboard://adapter-contract`
- `switchboard://preferences`
- `switchboard://server`

## Prompt and completion

`route_before_answering` asks a host to call `route_request` before completing a task. Prefix completion is available for `policy` and `profile` arguments.

## Schema guarantees

Every tool publishes:

- A bounded JSON Schema 2020-12 input contract
- A bounded JSON Schema 2020-12 output contract
- Correct read-only, write, and destructive annotations

The Switchboard contract is additive from 0.4.0. Fields are not removed from the `2026-07-24` contract without a new contract version and a documented migration period.

## Privacy

Switchboard does not persist prompt text, context, file excerpts, model inventories, evaluation cases, routing decisions, plans, diagnostics, tool results, embeddings, or browsing history.

HTTP retains protocol/session metadata only. Optional preference persistence contains category aggregates only.

## Limitations

- MCP cannot force a host to call Switchboard.
- MCP cannot force a host to apply a recommendation.
- Switchboard does not invoke the selected model.
- Host-supplied capabilities, cost, and latency can be inaccurate.
- Normalized budgets are comparative, not billing forecasts.
- The router and human-provided evaluation labels can be wrong.

## Verification

```bash
npm run verify
```

This runs type checking, the full Node test suite, the MCP-only production build, and a real stdio smoke process.
