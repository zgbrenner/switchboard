# Switchboard

**Switchboard 0.4.0** is a privacy-first local MCP server that analyzes an AI request and recommends:

- An abstract quality tier: `fast`, `balanced`, `deep`, or `max`
- A reasoning-effort level: `low`, `medium`, `high`, or `max`
- Required host capabilities such as web access, files, vision, long context, and code reasoning
- Confidence, task categories, tier scores, and concise routing reasons
- Optionally, the best concrete model from a model inventory supplied by the MCP host

Switchboard performs routing locally. It has no routing backend, account system, analytics, advertising, or telemetry, and it does not persist prompts, context, file excerpts, model inventories, route decisions, or tool results.

> Switchboard provides routing intelligence. An MCP host still decides whether to call `route_request` and whether to apply the returned model, tier, effort, or capability recommendation.

## Current status

The primary product surface is the **Switchboard MCP server**. It supports:

- MCP protocol revision `2025-11-25`
- Compatibility with `2025-06-18` and `2025-03-26`
- Stateful lifecycle initialization and `notifications/initialized` gating
- Newline-delimited local stdio
- Stateful Streamable HTTP with secure session IDs
- Optional bearer authentication
- Strict JSON Schema input and structured output
- Routing-policy and server-metadata resources
- A reusable routing prompt and policy completion
- Provider-independent model-inventory ranking

The repository also retains a Chromium extension foundation for ChatGPT and Claude. The extension is a secondary interface and is not required to run the MCP server.

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

Launch the stdio entry point directly. Do not use an unsilenced `npm run` command in an MCP client configuration because standard output must contain only newline-delimited JSON-RPC messages.

## Quick start: Streamable HTTP

```bash
node mcp/index.mjs --transport=http --host=127.0.0.1 --port=3764
```

Endpoint:

```text
http://127.0.0.1:3764/mcp
```

The HTTP transport is stateful. Initialization returns `MCP-Session-Id`; subsequent requests must send that session ID and the negotiated `MCP-Protocol-Version`. Sessions expire after 30 minutes of inactivity by default and can be explicitly terminated with `DELETE`.

For bearer authentication:

```bash
export SWITCHBOARD_MCP_TOKEN='a-long-random-secret'
node mcp/index.mjs --transport=http
```

Switchboard refuses to bind outside loopback unless bearer authentication is configured. Host and Origin allowlists remain separate controls.

## `route_request`

Basic call arguments:

```json
{
  "prompt": "Audit this authentication flow and verify subtle failure modes.",
  "context": [
    {
      "role": "user",
      "text": "We are reviewing a security-sensitive API."
    }
  ],
  "policy": "balanced"
}
```

A successful result contains:

```json
{
  "tier": "deep",
  "effort": "high",
  "capabilities": {
    "web": false,
    "files": false,
    "vision": false,
    "longContext": false,
    "code": true
  },
  "confidence": 0.91,
  "shouldUseJudge": false,
  "reasons": [],
  "scores": {
    "fast": 0.01,
    "balanced": 0.08,
    "deep": 0.82,
    "max": 0.09
  },
  "taskCategories": ["code", "high-stakes"],
  "modelResolution": {
    "status": "not-provided",
    "recommended": null,
    "alternatives": []
  }
}
```

The same result is returned through `structuredContent` and a JSON text content block for broad client compatibility.

## Concrete model recommendations

An MCP host may include up to 64 models in `availableModels`. Each model can describe:

- A stable host-local ID
- Abstract quality tier
- Supported effort levels
- Confirmed, unsupported, or unknown capabilities
- Relative cost and latency
- Availability and current-model identity

Switchboard first excludes models that explicitly lack a required capability. It then ranks the remaining inventory according to required tier and effort, unknown capabilities, the selected policy, relative cost, relative latency, and continuity with an adequate current model.

This keeps Switchboard universal: model names remain host data rather than hard-coded router labels.

## Routing policies

- `best`: prefer stronger options when they can materially improve the result
- `balanced`: balance quality, latency, and premium usage
- `fast`: prefer the fastest adequate route while preserving hard capability floors
- `conserve`: protect stronger or premium models unless they are required

## Architecture

```text
MCP host request
      |
      v
strict bounded input validation
      |
      v
shared local Switchboard router
  - deterministic safety and capability signals
  - semantic route scoring
  - local policy adjustments
      |
      v
abstract tier + effort + capabilities
      |
      +--> optional host model inventory resolver
      |
      v
structured MCP result returned to host
```

The MCP layer never invokes a provider model itself. The retained extension foundation maps the same abstract routing concepts onto visible ChatGPT and Claude controls, but it is architecturally separate from MCP operation.

## Privacy and security

Switchboard processes routing inputs in memory and does not persist:

- Prompt text
- Conversation context
- File excerpts
- Model inventories
- Route decisions
- Tool results
- Embeddings
- Browsing history

HTTP sessions retain only lifecycle, negotiated protocol, session ID, and last-activity metadata. Stdio writes protocol messages to standard output and diagnostics to standard error.

Security controls include bounded messages, strict schemas, Host and Origin validation, session expiry and deletion, maximum active-session limits, timing-safe bearer-token comparison, and mandatory authentication for non-loopback binding.

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

No GitHub Actions are required. Repository checks are intended to run locally before changes are merged.

## Documentation

- [Documentation index](docs/README.md)
- [MCP setup and protocol reference](docs/mcp.md)
- [Architecture](docs/architecture/overview.md)
- [Privacy and threat model](docs/privacy.md)
- [File handling](docs/architecture/file-inspection.md)
- [Local-model roadmap](docs/architecture/model-roadmap.md)
- [Router benchmarks](benchmarks/README.md)
- [Experimental training toolchain](training/README.md)
- [Research notes](docs/research.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT
