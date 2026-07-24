# Switchboard MCP server

Switchboard exposes its local request router as a standards-compliant MCP server. It does not call an external routing service or persist prompts. The MCP host can use the returned abstract tier, effort, capabilities, confidence, reasons, and optional concrete model recommendation.

## Requirements

- Node.js 22 or newer
- A built Switchboard checkout

```bash
npm install
npm run build
```

## Local stdio transport

Run the server directly so standard output remains reserved for MCP JSON-RPC messages:

```bash
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

Do not launch the stdio server through an unsilenced `npm run` command. Standard output may contain only newline-delimited MCP JSON-RPC messages.

## Local Streamable HTTP transport

```bash
node mcp/index.mjs --transport=http --host=127.0.0.1 --port=3764
```

Endpoint:

```text
http://127.0.0.1:3764/mcp
```

The HTTP transport:

- Uses cryptographically random, stateful MCP session IDs.
- Returns `MCP-Session-Id` on initialization.
- Requires `MCP-Session-Id` and the negotiated `MCP-Protocol-Version` on subsequent requests.
- Supports `DELETE` to terminate a session.
- Expires idle sessions after 30 minutes by default.
- Limits the server to 256 active sessions by default.
- Requires POST `Accept` to include both `application/json` and `text/event-stream`.
- Validates Host and Origin headers and limits bodies to 1 MiB.
- Binds to `127.0.0.1` by default.
- Returns HTTP 405 for GET because Switchboard does not emit server-initiated SSE messages.

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

Additional Host and Origin values can be explicitly allowed:

```bash
export SWITCHBOARD_MCP_ALLOWED_HOSTS='localhost,my-machine.local'
export SWITCHBOARD_MCP_ALLOWED_ORIGINS='https://trusted-client.example'
```

### Bearer authentication

Set a bearer token through the environment:

```bash
export SWITCHBOARD_MCP_TOKEN='a-long-random-secret'
node mcp/index.mjs --transport=http
```

Clients then send:

```text
Authorization: Bearer a-long-random-secret
```

A token may also be passed as `--token=...`, but an environment variable avoids exposing it in process arguments. Switchboard refuses to bind outside loopback unless bearer authentication is configured. Binding to another interface does not automatically trust additional Host or Origin values.

## Tool

### `route_request`

Classifies one request using the existing Switchboard router.

Basic input:

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
      "excerpt": "Authentication and session architecture...",
      "capabilities": {
        "vision": false,
        "longContext": false
      }
    }
  ],
  "policy": "balanced",
  "categoryBoosts": {
    "security": 0.1
  }
}
```

### Optional model inventory

An MCP host can pass up to 64 models it can actually invoke:

```json
{
  "prompt": "Audit this authentication flow and verify subtle failure modes.",
  "policy": "balanced",
  "currentModelId": "standard-model",
  "availableModels": [
    {
      "id": "fast-model",
      "title": "Fast model",
      "family": "general",
      "tier": "fast",
      "effortLevels": ["low"],
      "capabilities": {
        "web": false,
        "files": true,
        "vision": true,
        "longContext": false,
        "code": true
      },
      "relativeCost": 0.1,
      "relativeLatency": 0.1
    },
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
      "relativeLatency": 0.5
    }
  ]
}
```

Capability values have three meanings:

- `true`: confirmed support.
- `false`: confirmed lack of support, so the model is excluded when that capability is required.
- Omitted: unknown support, which receives a ranking penalty but is not automatically excluded.

The ranking strongly penalizes models below the required tier or effort, then applies the selected `best`, `balanced`, `fast`, or `conserve` policy to quality, relative cost, and relative latency. When recent context is supplied, an adequate `currentModelId` receives a continuity preference.

Output includes:

```json
{
  "tier": "deep",
  "effort": "high",
  "capabilities": {
    "web": false,
    "files": true,
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
  "taskCategories": ["code", "high-stakes", "files"],
  "modelResolution": {
    "status": "recommended",
    "recommended": {
      "id": "reasoning-model",
      "title": "Reasoning model",
      "family": "reasoning",
      "tier": "deep",
      "effort": "high",
      "meetsRequirements": true,
      "unknownCapabilities": [],
      "relativeCost": 0.6,
      "relativeLatency": 0.5,
      "score": 4.3
    },
    "alternatives": []
  }
}
```

`modelResolution.status` is:

- `not-provided` when no model inventory was supplied.
- `recommended` when at least one model is not ruled out by a required capability.
- `no-compatible-model` when every available model is unavailable or explicitly lacks a required capability.

The result is returned in both `structuredContent` and a JSON text block for clients that do not consume structured tool output.

## Resources

- `switchboard://policies` describes `best`, `balanced`, `fast`, and `conserve`.
- `switchboard://capabilities` describes the capability flags returned by the router.
- `switchboard://server` describes version, transports, supported protocol revisions, and privacy guarantees.

## Prompt and completion

`route_before_answering` creates a reusable user message instructing the host to call `route_request` before completing a supplied request.

The server implements `completion/complete` for the prompt's `policy` argument, so supporting clients can autocomplete `best`, `balanced`, `fast`, and `conserve`.

## Protocol support

The server uses MCP protocol revision `2025-11-25` and negotiates compatibility with `2025-06-18` and `2025-03-26`. It implements:

- Stateful lifecycle initialization and initialized-notification gating
- `ping`
- Tools listing and calling
- Structured tool output and output schema
- Resources listing and reading
- Prompts listing and retrieval
- Prompt-argument completion
- Newline-delimited stdio
- Stateful Streamable HTTP JSON responses
- HTTP session creation, expiry, protocol-version validation, and deletion

## Privacy

Switchboard processes each routing request in memory. It does not store:

- Prompt text
- Conversation context
- File excerpts
- Model inventories
- Tool results
- Embeddings
- Browsing history

HTTP sessions retain only protocol, lifecycle, and last-activity metadata. The MCP layer adds no account, analytics, telemetry, database, remote model call, or remote routing service.

## Important limitation

MCP exposes routing intelligence to a host. The host decides whether to call the tool and whether to apply the recommended tier, effort, capabilities, or model. The server itself does not change the active model in an MCP client.

## Verification

```bash
npm test
npm run build
npm run mcp:smoke
```

Interactive testing with the official MCP Inspector:

```bash
npx @modelcontextprotocol/inspector --cli node mcp/index.mjs --transport=stdio --method tools/list
```
