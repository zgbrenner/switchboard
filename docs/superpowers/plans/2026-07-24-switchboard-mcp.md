# Switchboard MCP Server Implementation Plan

**Status:** Implemented in Switchboard MCP 0.3.0, merged to `main`, and subsequently superseded by the stateful HTTP and model-resolution hardening in 0.4.0.

> Historical implementation record. Current product behavior is documented in `README.md`, `docs/README.md`, and `docs/mcp.md`.

**Goal:** Expose Switchboard's existing local routing engine as a standards-compliant MCP server with stdio and local Streamable HTTP transports.

**Architecture at this stage:** The MCP layer validates normalized routing requests, calls the existing `routeRequest` core, and returns structured and text results. A transport-neutral JSON-RPC handler powers newline-delimited stdio and the original localhost HTTP implementation, while resources and a prompt describe routing policies without adding browser or gateway behavior.

**Important historical note:** The original plan used stateless HTTP. Switchboard 0.4.0 replaced that design with secure stateful Streamable HTTP sessions. See `docs/mcp.md` for the current protocol.

**Tech Stack:** TypeScript 5.8, Node.js 22, JSON-RPC 2.0, MCP 2025-11-25 with compatibility for 2025-06-18 and 2025-03-26, Node test runner.

## Global Constraints

- Build only the MCP server; do not add a gateway, launcher, provider API, browser automation, or new hosted service.
- Keep routing local and dependency-free.
- Never persist prompt, context, file excerpt, or result content.
- Default transport is stdio; HTTP binds only to `127.0.0.1` unless explicitly configured.
- Validate Host and Origin headers for local HTTP.
- Standard output is reserved exclusively for newline-delimited JSON-RPC when using stdio.
- Return both `structuredContent` and equivalent text content from `route_request`.
- Reuse the existing provider-independent routing types and `routeRequest` implementation.
- Add no GitHub Actions workflows.

---

### Task 1: MCP request validation and tool surface

**Files:** Create `mcp/schema.mjs`, `mcp/server.mjs`; test `test/mcp.test.mjs`.

- [x] Write failing tests for initialization, tool discovery, routing, resources, prompts, invalid arguments, and unknown methods.
- [x] Implement bounded argument normalization and the transport-neutral JSON-RPC handler.
- [x] Run the MCP tests and verify all failures become passing assertions.

### Task 2: Standard transports and CLI

**Files:** Create `mcp/stdio.mjs`, `mcp/http.mjs`, `mcp/index.mjs`, `scripts/mcp-smoke.mjs`; modify `package.json`.

- [x] Write failing transport tests for newline-delimited stdio, localhost HTTP, Origin rejection, body limits, notifications, and protocol-version handling.
- [x] Implement stdio and the original Streamable HTTP transport plus CLI argument parsing and shutdown.
- [x] Run type checking, unit tests, and the stdio smoke client.

### Task 3: Documentation and publication

**Files:** Create `docs/mcp.md`; modify `README.md`; add the plan document.

- [x] Document local installation, client configuration, exposed tools/resources/prompts, transport flags, privacy, and the model-selection limitation.
- [x] Run focused local MCP verification without GitHub Actions.
- [x] Merge the verified MCP-only change to `main`.
