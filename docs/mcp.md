# Switchboard MCP server

**Current version:** 0.4.0  
**Primary tool:** `route_request`  
**Current MCP revision:** `2025-11-25`  
**Compatible revisions:** `2025-06-18`, `2025-03-26`

Switchboard exposes its local request router as an MCP server. It returns an abstract route and can optionally rank a concrete model inventory supplied by the host. It does not call a provider model, contact a remote routing service, or persist routing content.

The host remains responsible for:

1. Deciding whether to call `route_request`.
2. Supplying any model inventory it wants Switchboard to rank.
3. Applying or ignoring the returned tier, effort, capability, and model recommendation.
4. Invoking the selected model.

## Requirements

- Node.js 22 or newer
- npm
- A built Switchboard checkout

```bash
npm install
npm run build
```

No model download is required for the MCP server.

## Stdio transport

Run the entry point directly:

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

Standard output is reserved for newline-delimited MCP JSON-RPC messages. Diagnostics are written to standard error. Do not configure a client to launch the server through an unsilenced `npm run` command because npm may write non-protocol text to standard output.

### Lifecycle

A stateful stdio client should:

1. Send `initialize`.
2. Read the negotiated protocol revision and capabilities.
3. Send `notifications/initialized`.
4. Call tools, resources, prompts, completions, or `ping`.

Before initialization, only `initialize` and `ping` are accepted. After the initialize response but before `notifications/initialized`, ordinary operations remain gated.

## Stateful Streamable HTTP

Start the local HTTP server:

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

### HTTP session sequence

1. Send an initialization POST without `MCP-Session-Id`.
2. Read the `MCP-Session-Id` response header.
3. Send `notifications/initialized` with both `MCP-Session-Id` and the negotiated `MCP-Protocol-Version`.
4. Send all subsequent requests with the same two headers.
5. Send `DELETE` with those headers to terminate the session explicitly.

Every POST must include:

```text
Content-Type: application/json
Accept: application/json, text/event-stream
```

Requests after initialization must also include:

```text
MCP-Session-Id: <session-id>
MCP-Protocol-Version: <negotiated-version>
```

The HTTP transport:

- Generates cryptographically random session IDs.
- Expires idle sessions after 30 minutes by default.
- Allows 256 active sessions by default.
- Rejects unknown, expired, or mismatched sessions.
- Supports explicit session termination with `DELETE`.
- Returns HTTP 405 for GET because Switchboard does not emit server-initiated SSE events.
- Limits request bodies to 1 MiB.
- Validates Host and Origin headers.
- Binds to `127.0.0.1` by default.
- Returns JSON responses while requiring clients to advertise both supported Streamable HTTP media types.

### Bearer authentication

Set a token through the environment:

```bash
export SWITCHBOARD_MCP_TOKEN='a-long-random-secret'
node mcp/index.mjs --transport=http
```

Clients send:

```text
Authorization: Bearer a-long-random-secret
```

A token can also be provided through `--token=...`, but the environment avoids exposing it in process arguments. Token comparison is timing-safe.

Switchboard refuses to bind outside loopback unless bearer authentication is configured. Authentication does not replace Host and Origin validation.

Additional Host and Origin values can be explicitly allowed:

```bash
export SWITCHBOARD_MCP_ALLOWED_HOSTS='localhost,my-machine.local'
export SWITCHBOARD_MCP_ALLOWED_ORIGINS='https://trusted-client.example'
```

Do not expose the HTTP server broadly unless the network boundary, bearer token, Host allowlist, and Origin allowlist are intentionally configured.

## MCP capabilities

Switchboard advertises:

- Tools
- Resources
- Prompts
- Completions

It also implements `ping`, cancellation notifications, structured tool output, strict input/output schemas, and lifecycle validation.

## Tool: `route_request`

`route_request` classifies a request and returns provider-independent routing metadata.

### Basic input

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

### Input limits

- `prompt`: 1 to 64,000 characters and not whitespace-only
- `context`: at most 8 turns and 32,000 aggregate characters
- `files`: at most 20 entries
- File excerpt: at most 4,000 characters per entry
- `availableModels`: at most 64 entries
- Category boosts: at most 64 bounded numeric values from `-0.35` to `0.35`
- Unknown properties are rejected
- Invalid booleans, file types, duplicate effort levels, duplicate model IDs, and whitespace-only identifiers are rejected

The MCP server does not open file paths or read arbitrary files. `files` contains bounded metadata and excerpts already supplied by the host.

## Optional host model inventory

A host can ask Switchboard to convert the abstract route into a concrete recommendation:

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
      "relativeLatency": 0.1,
      "available": true
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
      "relativeLatency": 0.5,
      "available": true
    }
  ]
}
```

Capability values mean:

- `true`: support is confirmed.
- `false`: lack of support is confirmed; the model is excluded when that capability is required.
- Omitted: support is unknown; the model receives a ranking penalty but is not automatically excluded.

### Ranking behavior

Switchboard:

1. Excludes unavailable models.
2. Excludes models that explicitly lack a required capability.
3. Strongly penalizes models below the required tier.
4. Penalizes models that cannot meet the desired effort level.
5. Penalizes unknown required capabilities.
6. Applies the selected quality, cost, and latency policy.
7. Prefers an adequate current model when recent context is supplied, reducing unnecessary model switching.
8. Uses stable model IDs to break equal-score ties deterministically.

Model names and provider brands are never routing labels. They remain host-supplied inventory data.

## Output

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

- `not-provided`: no model inventory was supplied
- `recommended`: at least one model was not ruled out by a required capability
- `no-compatible-model`: every model is unavailable or explicitly lacks a required capability

The result is returned in both `structuredContent` and a JSON text block.

## Routing policies

- `best`: prefer higher-quality routes when they can materially improve the result
- `balanced`: balance quality, latency, and premium model usage
- `fast`: prefer the fastest adequate route while preserving hard floors
- `conserve`: conserve stronger or premium usage unless required

## Resources

- `switchboard://policies`: policy names and meanings
- `switchboard://capabilities`: capability flag meanings
- `switchboard://server`: version, supported protocol revisions, transports, and privacy guarantees

## Prompt and completion

`route_before_answering` returns a reusable user message instructing a host to call `route_request` before completing a supplied request.

`completion/complete` provides prefix completion for the prompt's `policy` argument: `best`, `balanced`, `fast`, and `conserve`.

## Privacy

Switchboard processes each routing request in memory. It does not persist:

- Prompt text
- Conversation context
- File excerpts
- Model inventories
- Route decisions
- Tool results
- Embeddings
- Browsing history

HTTP sessions retain only session ID, lifecycle phase, negotiated protocol revision, and last-activity metadata. There is no database, account, telemetry, remote model call, or remote routing service.

## Limitations

- MCP cannot guarantee that a host calls `route_request` before every request.
- MCP cannot force a host to switch models or reasoning levels.
- Model inventory descriptions are supplied by the host; inaccurate capability metadata can produce an inaccurate recommendation.
- Switchboard does not execute the selected model.
- Switchboard does not inspect arbitrary local files through MCP.
- The abstract router can still make mistakes; clients should preserve user overrides and safe fallbacks for consequential decisions.

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

Interactive testing with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector --cli \
  node mcp/index.mjs --transport=stdio \
  --method tools/list
```
