# Switchboard MCP server

**Current version:** 0.5.0  
**Switchboard API contract:** `2026-07-24`  
**Current MCP revision:** `2025-11-25`  
**Compatible MCP revisions:** `2025-06-18`, `2025-03-26`

Switchboard is a local MCP server for request classification, execution planning, model-inventory ranking, diagnostics, and router evaluation. It does not invoke a provider model, operate a remote routing service, or persist routing content.

The host remains responsible for deciding whether to call Switchboard, supplying accurate model metadata, applying or ignoring the result, and invoking any selected model.

## Requirements

- Node.js 22 or newer
- npm
- A built Switchboard checkout

```bash
npm install
npm run build
```

No model download is required for MCP operation.

## Stdio transport

```bash
node /absolute/path/to/switchboard/mcp/index.mjs --transport=stdio
```

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

Standard output is reserved for newline-delimited JSON-RPC messages. Diagnostics go to standard error.

### Lifecycle

1. Send `initialize`.
2. Read the negotiated protocol revision and server capabilities.
3. Send `notifications/initialized`.
4. Use tools, resources, prompts, completion, or `ping`.

Before initialization, only `initialize` and `ping` are accepted. Ordinary operations remain gated until `notifications/initialized` is received.

## Stateful Streamable HTTP

```bash
node mcp/index.mjs --transport=http --host=127.0.0.1 --port=3764
```

Endpoint:

```text
http://127.0.0.1:3764/mcp
```

Optional controls:

```bash
node mcp/index.mjs \
  --transport=http \
  --host=127.0.0.1 \
  --port=3764 \
  --path=/mcp \
  --session-ttl-ms=1800000 \
  --max-sessions=256
```

### Session sequence

1. Send initialization without `MCP-Session-Id`.
2. Read the returned `MCP-Session-Id` header.
3. Send `notifications/initialized` with the session ID and negotiated `MCP-Protocol-Version`.
4. Include both headers on later requests.
5. Send `DELETE` with both headers to terminate the session.

Every POST includes:

```text
Content-Type: application/json
Accept: application/json, text/event-stream
```

The HTTP transport uses random session IDs, expires idle sessions after 30 minutes by default, limits active sessions to 256 by default, rejects unknown or mismatched sessions, validates Host and Origin, limits bodies to 1 MiB, and returns HTTP 405 for GET because Switchboard does not emit server-initiated SSE events.

### Bearer authentication

```bash
export SWITCHBOARD_MCP_TOKEN='a-long-random-secret'
node mcp/index.mjs --transport=http
```

Clients send:

```text
Authorization: Bearer a-long-random-secret
```

Token comparison is timing-safe. Switchboard refuses non-loopback binding without bearer authentication. Authentication does not replace Host and Origin validation.

```bash
export SWITCHBOARD_MCP_ALLOWED_HOSTS='localhost,my-machine.local'
export SWITCHBOARD_MCP_ALLOWED_ORIGINS='https://trusted-client.example'
```

## API compatibility

The Switchboard API contract is separate from the MCP protocol revision.

- Current contract: `2026-07-24`
- Additive compatibility base: 0.4.0
- Existing 0.4 request fields remain valid.
- Existing 0.4 response fields remain present.
- New 0.5 response fields are additive.

The contract is available through `switchboard://api` and in every enhanced routing response.

## Tool: `route_request`

`route_request` classifies and plans one request.

### Input

```json
{
  "prompt": "Audit this authentication flow and verify subtle failure modes.",
  "context": [
    {
      "role": "user",
      "text": "We are reviewing a security-sensitive API."
    }
  ],
  "files": [
    {
      "name": "design.md",
      "detectedType": "markdown",
      "size": 24000,
      "textLength": 12000,
      "excerpt": "Authentication and session architecture..."
    }
  ],
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

### Input bounds

- `prompt`: 1 to 64,000 characters; not whitespace-only
- `context`: at most 8 turns and 32,000 aggregate characters
- `files`: at most 20 entries
- File excerpt: at most 4,000 characters per entry
- `availableModels`: at most 64 entries
- `budget.maxStages`: 1 through 4
- Category boosts: at most 64 values from `-0.35` through `0.35`
- Unknown properties are rejected
- Invalid booleans, types, duplicates, and whitespace-only identifiers are rejected

The server does not open file paths. File metadata and excerpts must already be supplied by the host.

### Policies

- `best`: prefer stronger options when they can materially improve quality
- `balanced`: balance quality, cost, and latency
- `fast`: prefer the fastest adequate route while preserving hard floors
- `conserve`: protect stronger or premium models unless required

### Profiles

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

Profiles can add category emphasis, raise a minimum tier, choose a default policy, or require a capability. Profiles do not lower deterministic capability or safety floors. An explicitly supplied `policy` overrides the profile default.

### Budget

All budget values except `maxStages` use normalized values from zero through one.

- `maxRelativeCost`
- `maxRelativeLatency`
- `minQuality`
- `maxStages`

Budgets do not silently lower safety floors. `budgetAssessment` reports estimated normalized values and any `cost`, `latency`, or `quality` conflicts.

### Plan modes

- `single`: always return one completion stage
- `auto`: use multiple stages for sufficiently complex work
- `multi`: request staged analysis, refinement, and optional verification

The host decides whether and how to execute the plan.

### Confidence evidence

In addition to the original scalar `confidence`, the result includes:

- `scoreMargin`: separation between the highest and second-highest tier scores
- `deterministicEvidence`: normalized strength of deterministic reasons
- `capabilityCertainty`: certainty derived from detected hard requirements
- `agreement`: combined evidence agreement score

These fields make debugging and policy comparisons easier; they do not constitute a statistical guarantee of correctness.

## Optional model inventory

A host can include up to 64 models:

```json
{
  "availableModels": [
    {
      "id": "reasoning-model",
      "title": "Reasoning model",
      "family": "reasoning",
      "tier": "deep",
      "effortLevels": ["medium", "high"],
      "capabilities": {
        "web": true,
        "files": true,
        "vision": true,
        "longContext": true,
        "code": true
      },
      "relativeCost": 0.6,
      "relativeLatency": 0.5,
      "available": true
    }
  ]
}
```

Capability values mean:

- `true`: support is confirmed
- `false`: lack of support is confirmed; the model is excluded when required
- Omitted: support is unknown; the model is penalized but not automatically excluded

Ranking excludes unavailable models and explicit capability misses, strongly penalizes tier and effort shortfalls, applies the selected cost-quality-latency policy, penalizes unknown required capabilities, and can prefer an adequate current model when context is supplied.

Model IDs and provider names remain host data rather than hard-coded routing labels.

## Tool: `explain_route`

Uses the same input as `route_request` and returns:

- A concise explanation
- Tier and effort
- Required capabilities
- Routing reasons
- Confidence evidence
- Model resolution
- Execution plan
- Budget assessment

## Tools: `compare_routes` and `simulate_policy`

Both accept a common request plus two to eight variants:

```json
{
  "prompt": "Review this API design.",
  "variants": [
    { "label": "quality", "policy": "best", "profile": "security" },
    { "label": "speed", "policy": "fast", "profile": "coding" }
  ]
}
```

The result reports each variant's tier, effort, confidence, model, budget fit, stage count, tier spread, distinct tiers and models, and variants with budget conflicts.

Neither tool changes stored state.

## Tool: `validate_model_inventory`

Accepts only `availableModels` and returns:

- Model and available-model counts
- Tier distribution
- Confirmed capability coverage
- Unavailable IDs
- Models with unknown capability declarations
- Integration warnings

Strict validation errors are returned as MCP tool errors.

## Tool: `evaluate_router`

Processes 1 through 100 labeled cases:

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

Output includes:

- `caseCount`
- `exactTierAccuracy`
- Harmful under-routing count and rate
- Over-routing count and rate
- Capability recall
- Tier confusion matrix
- Per-case tier delta, missing capabilities, and pass/fail state

Evaluation cases and expected labels are processed in memory and discarded.

## Resources

- `switchboard://policies`
- `switchboard://profiles`
- `switchboard://capabilities`
- `switchboard://api`
- `switchboard://server`

## Prompt and completion

`route_before_answering` asks the host to call `route_request` before completing a supplied task. It accepts optional `policy` and `profile` arguments.

`completion/complete` provides prefix completion for policy and profile values.

## Privacy

Switchboard does not persist:

- Prompt text
- Conversation context
- File excerpts
- Model inventories
- Evaluation cases or expected labels
- Routing decisions
- Execution plans
- Diagnostics or tool results
- Embeddings
- Browsing history

HTTP retains only session ID, lifecycle phase, negotiated protocol revision, and last-activity metadata. There is no database, account, telemetry, remote model call, or remote routing service.

## Limitations

- MCP cannot guarantee that a host calls Switchboard.
- MCP cannot force a host to switch models or reasoning levels.
- Execution plans are advisory and are not executed by Switchboard.
- Budget estimates are normalized comparative values, not provider billing forecasts.
- Host-supplied capability, cost, and latency metadata can be inaccurate.
- Switchboard does not inspect arbitrary local files through MCP.
- The abstract router and evaluation labels can be wrong; consequential integrations should preserve user overrides and safe fallbacks.

## Verification

```bash
npm test
npm run build
npm run mcp:smoke
```

Complete repository gate:

```bash
npm run verify
```

MCP Inspector:

```bash
npx @modelcontextprotocol/inspector --cli \
  node mcp/index.mjs --transport=stdio \
  --method tools/list
```
