# Switchboard proxy

`switchboard-proxy` is an optional transparent runtime layer. The existing MCP server remains a local advisory preflight tool. The proxy adds automatic trajectory observation and intervention for clients that can point their model base URL at a local server.

## Supported wires

- OpenAI Responses API at `/v1/responses`
- Anthropic Messages API at `/v1/messages`

Routing stays on the incoming wire. A Responses request is sent only to a Responses-compatible upstream, and a Messages request only to a Messages-compatible upstream. Switchboard does not translate encrypted reasoning, thinking, or tool payloads between vendors.

## Start

Copy `examples/switchboard.proxy.example.json`, configure the models and credential environment variables, then run:

```bash
npx switchboard-proxy --config ./switchboard.proxy.json
```

Validate without starting:

```bash
npx switchboard-proxy --config ./switchboard.proxy.json --check
```

The default address is `127.0.0.1:8788`. Binding to a non-loopback address is rejected unless a bearer token is configured. Clients then send that token as `Authorization: Bearer ...`.

### Codex or Responses-compatible clients

```bash
export OPENAI_BASE_URL=http://127.0.0.1:8788/v1
export OPENAI_MODEL=switchboard
```

### Claude Code or Messages-compatible clients

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:8788
export ANTHROPIC_MODEL=switchboard
export ANTHROPIC_API_KEY=unused
```

The client-facing API key is not forwarded. Each upstream route resolves its own conventional API credential from config or an environment variable.

## Runtime behavior

A session begins at the minimum safe tier returned by Switchboard preflight. Accumulated tool history is converted into digest-only observations. The runtime may raise effort, switch to a stronger configured model, restart with narration removed, stop for budget, or request human review. It never selects a route below the initial floor.

On switch or restart, Switchboard retains user instructions, tool calls, tool results, and artifacts, while dropping assistant narration and provider-specific reasoning or thinking blocks.

Every response includes:

- `x-switchboard-session`
- `x-switchboard-tier`
- `x-switchboard-effort`
- `x-switchboard-model`
- `x-switchboard-decision`
- `x-switchboard-judge`

Streaming responses are forwarded immediately. A tee'd copy is consumed only for token accounting, so metering does not delay the client stream.

## Inspection

- `GET /health`
- `GET /v1/switchboard/sessions`
- `GET /v1/switchboard/sessions/:id`

Inspection returns tiers, counters, digest-only evidence, and decisions. It does not expose prompt text, tool arguments, tool output, or model response content.

## Failure behavior

- Runtime budget exhaustion returns HTTP 429 before another upstream call.
- Human escalation returns HTTP 409 by default. `humanMode: "continue"` records the verdict but keeps forwarding.
- Judge failures fail open.
- Upstream failures pass through with routing headers and are recorded as structured failure evidence.
