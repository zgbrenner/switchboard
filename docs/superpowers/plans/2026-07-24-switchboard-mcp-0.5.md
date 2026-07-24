# Switchboard MCP 0.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for status tracking.

**Goal:** Add planning, profiles, budgets, diagnostics, evaluation, and an additive versioned response contract to the local Switchboard MCP server.

**Architecture:** Keep `routeRequest` as the shared classifier. Add focused pure modules for profiles, enhanced decision construction, diagnostics, and evaluation. Extend strict schemas and expose the new functionality through read-only MCP tools.

**Tech Stack:** Node.js 22, ECMAScript modules, JSON-RPC 2.0, JSON Schema 2020-12, MCP 2025-11-25.

## Global Constraints

- Local and provider-independent.
- No model invocation, gateway, browser automation, account system, telemetry, or prompt persistence.
- Preserve every 0.4 request field and response field.
- New response fields are additive.
- All arrays and strings remain bounded.
- No GitHub Actions.

---

### Task 1: Profiles and enhanced routing result

**Files:** `mcp/profiles.mjs`, `mcp/enhance.mjs`, `mcp/schema.mjs`, `test/mcp-0.5.test.mjs`

- [ ] Add profile definitions and strict profile lookup.
- [ ] Add budget normalization, confidence evidence, budget assessment, and execution-plan construction.
- [ ] Extend `route_request` validation and schemas without breaking 0.4 inputs.
- [ ] Add regression tests for profiles, budgets, single and multi-stage plans, and compatibility fields.

### Task 2: Diagnostics and model inventory validation

**Files:** `mcp/diagnostics.mjs`, `mcp/schema.mjs`, `mcp/server.mjs`, `test/mcp-0.5.test.mjs`

- [ ] Add reusable model inventory normalization and validation.
- [ ] Add `explain_route`, `compare_routes`, `simulate_policy`, and `validate_model_inventory`.
- [ ] Return structured and text content for every diagnostic tool.
- [ ] Add tests for deterministic comparisons, explanations, and invalid inventories.

### Task 3: Router evaluation tool

**Files:** `mcp/evaluation.mjs`, `mcp/schema.mjs`, `mcp/server.mjs`, `test/mcp-0.5.test.mjs`

- [ ] Add bounded evaluation-case validation.
- [ ] Calculate harmful under-routing, over-routing, exact-tier accuracy, capability recall, and a confusion matrix.
- [ ] Expose `evaluate_router` as a read-only MCP tool.
- [ ] Add tests for perfect, under-routed, over-routed, and capability-miss batches.

### Task 4: API metadata, smoke coverage, and documentation

**Files:** `mcp/server.mjs`, `scripts/mcp-smoke.mjs`, `package.json`, `README.md`, `docs/mcp.md`, `docs/README.md`

- [ ] Publish Switchboard API contract `2026-07-24` and compatibility guarantees.
- [ ] Bump the package and server to 0.5.0.
- [ ] Expand the stdio smoke flow to discover all tools and verify the enhanced route response.
- [ ] Document profiles, budgets, execution plans, diagnostics, evaluation, and limitations.
- [ ] Review the complete diff, run focused verification, and fast-forward merge to `main`.
