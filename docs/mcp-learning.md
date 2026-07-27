# Aggregate preference learning

Switchboard MCP 0.5 can learn category-level routing preferences from explicit user overrides without storing prompts, conversation text, file excerpts, model inventories, responses, or route explanations.

## Tools

### `record_override`

Records that the user selected a different tier than Switchboard recommended.

```json
{
  "categories": ["analysis", "code"],
  "recommendedTier": "balanced",
  "selectedTier": "deep"
}
```

Only these three fields are accepted. Unknown properties—including `prompt`, `context`, `files`, and free-form notes—are rejected.

### `get_preference_state`

Returns the aggregate state:

```json
{
  "version": 1,
  "persistent": false,
  "updatedAt": "2026-07-24T12:00:00.000Z",
  "totalOverrides": 3,
  "categories": {
    "analysis": {
      "bias": 0.271,
      "overrides": 3,
      "upgrades": 3,
      "downgrades": 0
    }
  }
}
```

The state contains category names, bounded numeric bias values, and counters only.

### `reset_preference_state`

Deletes all aggregate preferences for the active store. The tool is marked destructive and idempotent in MCP annotations.

## Default isolation

Without configuration, each MCP session receives a separate in-memory preference store.

- Preferences are not written to disk.
- A client cannot influence another client's in-memory routing state.
- Closing the server process discards all unpersisted preference data.

This is the default and recommended mode for shared or multi-client environments.

## Optional persistence

Persistence is opt-in. Set an explicit local path before starting the server:

```bash
export SWITCHBOARD_MCP_STATE_PATH="$HOME/.local/state/switchboard/preferences.json"
node mcp/index.mjs --transport=stdio
```

When a path is configured:

- Sessions in the same server process intentionally share that aggregate store.
- The file is written atomically through a temporary file and rename.
- New state files request owner-only permissions (`0600`) where the platform supports them.
- The state file is limited to 1 MiB before parsing.
- Invalid or oversized files fail closed instead of silently resetting learned preferences.

Use a separate state path for each user, workspace, or trust boundary that should not share routing preferences.

## Learning behavior

Switchboard computes a bounded category bias from upgrade and downgrade overrides.

- Bias is clamped between `-0.35` and `0.35`.
- At least a meaningful threshold is required before routing changes.
- A learned adjustment changes at most one abstract tier per request.
- Effort is recalculated to match the adjusted tier.
- Profile floors are applied after learning.

The route output includes `learningAdjustment`, which explains whether learning was applied and, when applicable, the original and adjusted tiers.

## Safety floors

Aggregate learning cannot downgrade a route when:

- Any hard capability is required, including web, files, vision, long context, or code.
- The route is categorized as high-stakes, legal, security, medical, or finance.
- A profile minimum tier would be violated.

In these cases, `learningAdjustment.applied` is `false` and the reason is `downward-safety-floor` or the profile floor restores the required tier.

## Concurrency

Writes are serialized. Snapshots and route adjustments wait for queued writes before reading state, preventing stale responses during concurrent MCP calls.

## Privacy boundary

Preference learning does not make Switchboard a telemetry or analytics service. Data remains local to the running server and the optional state file. Switchboard does not send preference state to a routing backend, model provider, or any other remote service.
