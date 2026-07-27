# Switchboard

**Switchboard 0.5.0** is a privacy-first local MCP server that analyzes an AI request before execution and returns a provider-independent routing decision.

It can recommend:

- A quality tier: `fast`, `balanced`, `deep`, or `max`
- A reasoning-effort level: `low`, `medium`, `high`, or `max`
- Required capabilities such as web access, files, vision, long context, and code
- A single-stage or multi-stage execution plan
- A normalized cost, latency, quality, and stage-count budget assessment
- A concrete model from an inventory supplied by the MCP host
- Concise confidence evidence and routing reasons

Switchboard can also compare routes, simulate policies, validate model inventories, evaluate routing quality, and learn bounded category preferences without accepting or storing prompt text.

> Switchboard is advisory. The MCP host decides whether to call it, whether to follow its recommendation, and which model to invoke.

## MCP-only default

The default package and build are MCP-only. They compile the shared local router used by `mcp/index.mjs`. No model download, browser automation, hosted service, gateway, analytics, or remote inference is required.

Legacy extension research remains in the repository for provenance, but it is not part of the default installation or build.

## Quick start

Requirements:

- Node.js 22 or newer
- npm

```bash
npm install
npm run build
node /absolute/path/to/switchboard/mcp/index.mjs --transport=stdio
```

Example client configuration:

```json
{
  "mcpServers": {
    "switchboard": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/switchboard/mcp/index.mjs",
        "--transport=stdio"
      ]
    }
  }
}
```

Standard output is reserved for newline-delimited MCP JSON-RPC messages.

## Streamable HTTP

```bash
node mcp/index.mjs --transport=http --host=127.0.0.1 --port=3764
```

Endpoint:

```text
http://127.0.0.1:3764/mcp
```

The HTTP transport is stateful. Initialization returns `MCP-Session-Id`; later requests send that ID and the negotiated `MCP-Protocol-Version`. Sessions expire after 30 minutes of inactivity by default and can be deleted explicitly.

For bearer authentication:

```bash
export SWITCHBOARD_MCP_TOKEN='a-long-random-secret'
node mcp/index.mjs --transport=http
```

Switchboard refuses non-loopback binding without authentication. Host and Origin validation remain separate controls.

## Tools

Switchboard exposes nine MCP tools:

| Tool | Purpose |
|---|---|
| `route_request` | Route and plan one request |
| `explain_route` | Return a concise explanation and structured evidence |
| `compare_routes` | Compare two to eight policy or profile variants |
| `simulate_policy` | Simulate variants without changing state |
| `validate_model_inventory` | Validate a provider-independent model inventory |
| `evaluate_router` | Evaluate 1 to 100 labeled routing cases |
| `record_override` | Record category-only upgrade or downgrade feedback |
| `get_preference_state` | Read aggregate preference counters and weights |
| `reset_preference_state` | Delete aggregate preference state |

Every tool publishes a bounded JSON Schema 2020-12 input contract and output contract.

## Example route

```json
{
  "prompt": "Audit this authentication flow and verify subtle failure modes.",
  "profile": "security",
  "policy": "balanced",
  "planMode": "multi",
  "budget": {
    "maxRelativeCost": 0.8,
    "maxRelativeLatency": 0.8,
    "minQuality": 0.7,
    "maxStages": 3
  },
  "availableModels": [
    {
      "id": "deep-code",
      "tier": "deep",
      "effortLevels": ["high"],
      "capabilities": { "code": true },
      "relativeCost": 0.5,
      "relativeLatency": 0.5
    }
  ]
}
```

The result retains the 0.4 routing fields and adds:

- API contract metadata
- Effective profile and policy
- Confidence evidence
- Execution plan
- Budget assessment
- Model capability negotiation
- Aggregate-learning adjustment metadata

The current Switchboard API contract is `2026-07-24`. Additive compatibility starts from 0.4.0.

## Profiles

Built-in profiles:

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

Profiles may raise a tier or capability floor. They cannot lower deterministic safety requirements.

## Privacy-preserving learning

`record_override` accepts only:

```json
{
  "categories": ["security"],
  "recommendedTier": "deep",
  "selectedTier": "max"
}
```

It rejects raw prompt, context, file, model, note, and unknown fields. By default, preference state is isolated in memory per MCP session. Persistence is opt-in:

```bash
export SWITCHBOARD_MCP_STATE_PATH="$HOME/.local/state/switchboard/preferences.json"
```

Persisted state contains only bounded category weights and counters. Learned downgrades cannot bypass high-stakes or required-capability floors.

## Reproducible evaluation

`evaluate_router` excludes learned preference state from baseline metrics by default. Set `includePreferences: true` to observe the adjusted tier while keeping baseline accuracy, under-routing, over-routing, and confusion-matrix calculations preference independent.

## Privacy and security

Switchboard does not persist routing content, model inventories, evaluations, plans, or results. HTTP session state contains protocol and lifecycle metadata only. Optional preference persistence contains category aggregates only.

Security controls include strict bounded schemas, session expiry and deletion, active-session limits, Host and Origin validation, timing-safe bearer-token comparison, atomic preference writes, and a 1 MiB preference-state limit.

## Verification

```bash
npm run verify
```

This runs type checking, the complete Node test suite, the MCP-only production build, and a real stdio smoke test. No GitHub Actions are required.

## Documentation

- [MCP reference](docs/mcp.md)
- [Documentation index](docs/README.md)
- [Aggregate learning](docs/mcp-learning.md)
- [Privacy and threat model](docs/privacy.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT
