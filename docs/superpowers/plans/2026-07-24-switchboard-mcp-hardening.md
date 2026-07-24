# Switchboard MCP Hardening Implementation Plan

**Status:** Implemented in Switchboard MCP 0.4.0 and merged to `main` on July 24, 2026.

> Historical implementation record. Current product behavior is documented in `README.md`, `docs/README.md`, and `docs/mcp.md`.

**Goal:** Harden Switchboard's local MCP server for broad client compatibility and add optional provider-independent model resolution.

**Architecture:** Keep the existing router unchanged. Add strict protocol lifecycle state, a bounded model inventory resolver, secure stateful Streamable HTTP sessions, completion support, richer schemas, and transport-level regression tests around the dependency-free MCP package.

**Tech Stack:** Node.js 22, ECMAScript modules, JSON-RPC 2.0, MCP 2025-11-25 with compatibility for 2025-06-18 and 2025-03-26, Node test runner.

## Global Constraints

- MCP-only work. Do not add browser automation, a gateway, provider API calls, telemetry, or remote routing.
- Keep runtime dependency-free and local.
- Do not persist prompts, context, file excerpts, model inventories, or route decisions.
- Stdio stdout contains only newline-delimited JSON-RPC messages.
- HTTP binds to loopback by default and requires authentication for non-loopback binding.
- No GitHub Actions or GitHub-hosted CI.
- Preserve provider-independent routing labels.

---

### Task 1: Lifecycle and JSON-RPC correctness

**Files:** `mcp/server.mjs`, `test/mcp-hardening.test.mjs`

- [x] Add failing tests for pre-initialization calls, initialized-notification gating, duplicate initialization, invalid IDs, invalid params, and compatible version negotiation.
- [x] Implement explicit `new`, `initializing`, and `ready` lifecycle states for stateful sessions.
- [x] Preserve a stateless mode for transport-managed HTTP sessions while validating request structure.
- [x] Run the focused MCP tests and commit.

### Task 2: Universal model inventory resolution

**Files:** `mcp/models.mjs`, `mcp/schema.mjs`, `mcp/server.mjs`, `test/mcp-hardening.test.mjs`

- [x] Add failing tests for compatible-model selection, hard capability rejection, policy tradeoffs, current-model continuity, unavailable models, and empty inventories.
- [x] Add bounded model inventory validation and complete JSON Schema definitions.
- [x] Implement deterministic ranking that strongly penalizes under-capable models and returns a stable `modelResolution` object.
- [x] Run focused tests and commit.

### Task 3: Secure stateful Streamable HTTP

**Files:** `mcp/http.mjs`, `mcp/index.mjs`, `test/mcp-hardening.test.mjs`

- [x] Add failing tests for session creation, required session and version headers, unknown and expired sessions, DELETE termination, Accept validation, bearer authentication, and non-loopback refusal.
- [x] Implement secure UUID session IDs, bounded session count, TTL cleanup, protocol-header consistency, optional bearer authentication, and session deletion.
- [x] Retain Host and Origin protections, the 1 MiB body limit, and GET 405 behavior.
- [x] Run HTTP tests and commit.

### Task 4: Discoverability, documentation, and smoke verification

**Files:** `mcp/server.mjs`, `scripts/mcp-smoke.mjs`, `docs/mcp.md`, `README.md`, `package.json`, `test/mcp-hardening.test.mjs`

- [x] Add failing tests for the server metadata resource, completion suggestions, detailed output schema, and the end-to-end initialized stdio flow.
- [x] Add completion capability and `completion/complete` for routing policy values.
- [x] Update the smoke test to complete the MCP lifecycle before discovery and tool execution.
- [x] Document session headers, authentication, model inventories, resources, completions, and client setup.
- [x] Run all MCP tests, TypeScript build, and stdio smoke verification; review the complete diff and fast-forward merge to `main`.
