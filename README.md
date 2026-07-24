# Switchboard

**Switchboard 0.5.0** is a privacy-first local MCP server for AI request planning and model routing.

It analyzes a request and returns:

- An abstract quality tier: `fast`, `balanced`, `deep`, or `max`
- A reasoning-effort level: `low`, `medium`, `high`, or `max`
- Required host capabilities such as web, files, vision, long context, and code
- Confidence, score margins, deterministic evidence, task categories, and routing reasons
- A one-stage or multi-stage execution plan
- A budget assessment for relative cost, latency, and quality constraints
- Optionally, the best concrete model from a host-supplied model inventory

Switchboard can also explain decisions, compare profiles or policies, validate model inventories, and evaluate routing quality over labeled test cases.

Switchboard performs routing locally. It has no routing backend, account system, analytics, advertising, or telemetry, and it does not persist prompts, context, file excerpts, model inventories, evaluation cases, route decisions, plans, or tool results.

> Switchboard provides advisory routing intelligence. The MCP host decides whether to call it, whether to follow the returned plan or recommendation, and which model to invoke.

## What changed in 0.5

Switchboard 0.5 adds:

- Built-in routing profiles for coding, legal, research, creative, security, finance, medical, low-cost, and low-latency work
- Optional normalized cost, latency, quality, and stage-count budgets
- Automatic or explicitly requested multi-stage execution plans
- Confidence evidence beyond a single scalar confidence value
- `explain_route`
- `compare_routes`
- `simulate_policy`
- `validate_model_inventory`
- `evaluate_router`
- Versioned Switchboard API metadata with additive compatibility from 0.4.0

Existing 0.4 `route_request` inputs remain valid. Existing response fields remain present; 0.5 fields are additive.

## Current status

The primary product surface is the local **Switchboard MCP server**.

- Switchboard API contract: `2026-07-24`
- MCP revision: `2025-11-25`
- Compatible MCP revisions: `2025-06-18`, `2025-03-26`
- Transports: newline-delimited stdio and stateful Streamable HTTP
- Runtime routing service: none
- Required model download: none
- GitHub Actions required: no

The repository retains a Chromium extension foundation for ChatGPT and Claude, but it is secondary and is not required for MCP operation.

## Quick start: stdio

Requirements:

- Node.js 22 or newer
- npm

```bash
npm install
npm run build
node /absolute/path/to/switchboard/mcp/index.mjs --transport=stdio
```

Example MCP client configuration:

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

Launch the entry point directly. Standard output is reserved for newline-delimited JSON-RPC messages.

## Quick start: Streamable HTTP

```bash
node mcp/index.mjs --transport=http --host=127.0.0.1 --port=3764
```

Endpoint:

```text
http://127.0.0.1:3764/mcp
```

Initialization returns `MCP-Session-Id`. Subsequent requests must send that session ID and the negotiated `MCP-Protocol-Version`. Sessions expire after 30 minutes of inactivity by default and can be terminated with `DELETE`.

For bearer authentication:

```bash
export SWITCHBOARD_MCP_TOKEN='a-long-random-secret'
node mcp/index.mjs --transport=http
```

Switchboard refuses non-loopback binding unless bearer authentication is configured. Host and Origin allowlists remain separate controls.

## MCP tools

### `route_request`

Classify and plan one request.

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
  }
}
```

The result includes the original routing fields plus:

```json
{
  "apiVersion": "2026-07-24",
  "effectiveProfile": "security",
  "effectivePolicy": "balanced",
  "confidenceEvidence": {
    "overall": 0.91,
    "scoreMargin": 0.73,
    "deterministicEvidence": 0.66,
    "capabilityCertainty": 0.76,
    "agreement": 0.79
  },
  "executionPlan": {
    "mode": "multi",
    "stages": [
      {
        "id": "analyze",
        "purpose": "Analyze the request and produce a working answer",
        "tier": "balanced",
        "effort": "medium"
      },
      {
        "id": "refine",
        "purpose": "Refine the answer for completeness and correctness",
        "tier": "deep",
        "effort": "high"
      },
      {
        "id": "verify",
        "purpose": "Independently verify high-risk claims and requirements",
        "tier": "deep",
        "effort": "high"
      }
    ]
  },
  "budgetAssessment": {
    "fits": true,
    "violations": [],
    "estimatedRelativeCost": 0.65,
    "estimatedRelativeLatency": 0.65,
    "estimatedQuality": 0.82
  }
}
```

### `explain_route`

Returns a concise natural-language explanation plus structured evidence, required capabilities, model resolution, execution plan, and budget assessment.

### `compare_routes`

Compares two to eight policy or profile variants for the same request.

```json
{
  "prompt": "Review this API design.",
  "variants": [
    { "label": "quality", "policy": "best", "profile": "security" },
    { "label": "speed", "policy": "fast", "profile": "coding" }
  ]
}
```

### `simulate_policy`

Uses the same bounded comparison input to simulate policy or profile choices without changing state.

### `validate_model_inventory`

Validates up to 64 host models and reports tier coverage, capability coverage, unavailable models, unknown capabilities, and warnings.

### `evaluate_router`

Evaluates up to 100 labeled cases and returns:

- Exact-tier accuracy
- Harmful under-routing count and rate
- Over-routing count and rate
- Required-capability recall
- Tier confusion matrix
- Per-case pass/fail details

```json
{
  "cases": [
    {
      "id": "security-audit",
      "prompt": "Audit this authentication implementation.",
      "profile": "security",
      "expectedTier": "deep",
      "requiredCapabilities": ["code"]
    }
  ]
}
```

Evaluation data is processed in memory and discarded.

## Routing profiles

- `general`: neutral balanced routing
- `coding`: code-aware routing with a balanced minimum tier
- `legal`: quality-first routing with a deep minimum tier
- `research`: quality-first routing with required web capability
- `creative`: balanced creative-writing routing
- `security`: quality-first code-aware routing with a deep minimum tier
- `finance`: quality-first high-stakes financial analysis
- `medical`: quality-first high-stakes medical analysis
- `low-cost`: conserve stronger models unless required
- `low-latency`: prefer the fastest adequate route

Profiles can raise a tier or capability floor. They cannot lower deterministic safety requirements.

## Concrete model recommendations

Hosts may pass up to 64 models in `availableModels`. Each model can declare:

- Stable host-local ID
- Abstract tier
- Supported effort levels
- Confirmed, unsupported, or unknown capabilities
- Relative cost and latency
- Availability

Models that explicitly lack a required capability are excluded. Remaining models are ranked by required tier and effort, unknown capabilities, routing policy, relative cost, relative latency, and continuity with an adequate current model.

Switchboard does not hard-code provider model names.

## Privacy and security

Switchboard does not persist:

- Prompt text
- Conversation context
- File excerpts
- Model inventories
- Evaluation cases or expected labels
- Route decisions
- Execution plans
- Tool results
- Embeddings
- Browsing history

HTTP sessions retain only lifecycle, negotiated protocol, session ID, and last-activity metadata.

Security controls include strict schemas, bounded inputs, Host and Origin validation, session expiry and deletion, active-session limits, timing-safe bearer-token comparison, and mandatory authentication for non-loopback binding.

## Verification

Focused MCP verification:

```bash
npm install
npm test
npm run build
npm run mcp:smoke
```

Complete repository verification:

```bash
npm run verify
```

## Documentation

- [Documentation index](docs/README.md)
- [MCP setup and protocol reference](docs/mcp.md)
- [Architecture](docs/architecture/overview.md)
- [Privacy and threat model](docs/privacy.md)
- [Router benchmarks](benchmarks/README.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT
