# Switchboard MCP server

Switchboard exposes its existing local request router as a standards-compliant MCP server. It does not call an external routing service, persist prompts, or select a provider model itself. The MCP host can use the returned abstract tier, effort, capabilities, confidence, and reasons when it supports model or reasoning selection.

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
      "command": "node",
      "args": [
        "/absolute/path/to/switchboard/mcp/index.mjs",
        "--transport=stdio"
      ]
    }
  }
}
```

Do not configure an MCP client to launch the server through an unsilenced `npm run` command because npm may write status text to standard output before the JSON-RPC stream begins.

## Local Streamable HTTP transport

```bash
node mcp/index.mjs --transport=http --host=127.0.0.1 --port=3764
```

The endpoint is:

```text
http://127.0.0.1:3764/mcp
```

The HTTP transport is stateless, returns JSON responses, validates Host and Origin headers, limits request bodies to 1 MiB, and binds to `127.0.0.1` by default. It does not expose legacy HTTP plus SSE.

Additional hosts or browser origins can be explicitly allowed:

```bash
export SWITCHBOARD_MCP_ALLOWED_HOSTS='localhost,my-machine.local'
export SWITCHBOARD_MCP_ALLOWED_ORIGINS='https://trusted-client.example'
```

Binding to another interface does not automatically trust requests addressed through other hostnames. Add each intended hostname explicitly.

## Tool

### `route_request`

Classifies one request using the existing Switchboard router.

Input:

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

Output:

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
  "taskCategories": ["code", "high-stakes", "files"]
}
```

The result is returned in both `structuredContent` and a JSON text content block for compatibility with clients that do not yet consume structured tool output.

## Resources

- `switchboard://policies` describes `best`, `balanced`, `fast`, and `conserve`.
- `switchboard://capabilities` describes the capability flags returned by the router.

## Prompt

`route_before_answering` creates a reusable user message instructing the host to call `route_request` before completing a supplied request.

## Protocol support

The server uses MCP protocol revision `2025-11-25` and negotiates compatibility with `2025-06-18` and `2025-03-26` clients. It implements:

- Lifecycle initialization
- `ping`
- Tools listing and calling
- Resources listing and reading
- Prompts listing and retrieval
- Newline-delimited stdio
- Stateless Streamable HTTP JSON responses

## Privacy

Switchboard processes each request in memory. It does not store:

- Prompt text
- Conversation context
- File excerpts
- Tool results
- Embeddings
- Browsing history

The MCP layer adds no account, analytics, telemetry, database, or remote routing service.

## Important limitation

MCP exposes routing intelligence to a host. The host decides whether to call the tool and whether to apply the recommended tier or effort. The server itself does not change the active model in ChatGPT, Claude, Cursor, VS Code, or another MCP client.

## Verification

```bash
npm test
npm run build
npm run mcp:smoke
```
