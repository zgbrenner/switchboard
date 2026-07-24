# Switchboard MCP hardening design

**Status:** Implemented in Switchboard MCP 0.4.0 and merged to `main` on July 24, 2026.

> Historical design record. Current product behavior is documented in `README.md`, `docs/README.md`, and `docs/mcp.md`.

## Goal

Make Switchboard a more universal, standards-compliant local MCP router without adding browser automation, an API gateway, or any remote service.

## Protocol behavior

The stdio transport uses a stateful MCP lifecycle. `initialize` is the first non-ping request, the server waits for `notifications/initialized` before normal operations, and duplicate initialization or pre-initialization tool calls are rejected with JSON-RPC errors.

The Streamable HTTP transport uses cryptographically random stateful session IDs. Initialization returns `MCP-Session-Id`; subsequent requests require that session ID and the negotiated `MCP-Protocol-Version`; `DELETE` terminates a session; expired or unknown sessions return HTTP 404. POST requests validate the required `Accept` media types, content type, Host, Origin, body size, and optional bearer authentication. Non-loopback binding is refused unless authentication is configured.

## Universal model resolution

`route_request` returns provider-independent tier, effort, capabilities, confidence, reasons, and scores. It additionally accepts an optional bounded inventory of models available to the MCP host. Each model may declare tier, supported effort levels, capabilities, relative cost, relative latency, family, and availability. Switchboard ranks compatible models while heavily penalizing under-capable choices, respecting the selected routing policy, and preferring the current model when it already satisfies the request.

The result always contains a `modelResolution` object with one of three states: `not-provided`, `recommended`, or `no-compatible-model`. This remains advisory because MCP hosts retain control over model invocation.

## Discoverability

The server exposes:

- The `route_request` tool with complete JSON Schema 2020-12 input and output definitions.
- Routing policies, capability meanings, and server/privacy metadata as resources.
- The `route_before_answering` prompt.
- Completion suggestions for the prompt's `policy` argument.

## Privacy and scope

Switchboard does not persist prompt text, context, file excerpts, model inventories, or routing results. HTTP sessions retain only protocol and lifecycle metadata. No telemetry, external inference, remote routing, provider credentials, browser code, or gateway behavior was added by this work.

## Verification

Regression tests cover lifecycle ordering, version negotiation, strict parameter validation, structured output conformance, model ranking, stdio framing, secure HTTP sessions, protocol headers, bearer authentication, body and media-type limits, session expiry, and session deletion. The MCP smoke test performs initialization, the initialized notification, discovery, and a real `route_request` call.
