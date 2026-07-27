# Switchboard MCP 0.5 Implementation Plan

**Status:** Implementation substantially complete on `agent/mcp-0.5`; full repository verification and evaluation-isolation work remain before merge.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for status tracking.

**Goal:** Add planning, profiles, budgets, diagnostics, evaluation, aggregate preference learning, and an additive versioned response contract to the local Switchboard MCP server.

**Architecture:** Keep `routeRequest` as the shared classifier. Add focused pure modules for profiles, enhanced decision construction, diagnostics, evaluation, capability negotiation, and category-only preference learning. Extend strict schemas and expose the functionality through bounded MCP tools.

**Tech Stack:** Node.js 22, ECMAScript modules, JSON-RPC 2.0, JSON Schema 2020-12, MCP 2025-11-25.

## Global Constraints

- Local and provider-independent.
- No model invocation, gateway, browser automation, account system, telemetry, or prompt persistence.
- Preserve every 0.4 request field and response field.
- New response fields are additive.
- All arrays, strings, persisted state, and evaluation batches remain bounded.
- No GitHub Actions.

---

### Task 1: Profiles and enhanced routing result

**Files:** `mcp/profiles.mjs`, `mcp/enhance.mjs`, `mcp/schema.mjs`, `mcp/output-schema.mjs`, `test/mcp-0.5.test.mjs`, `test/mcp-budget-model-compatibility.test.mjs`

- [x] Add profile definitions and strict profile lookup.
- [x] Add budget normalization, confidence evidence, budget assessment, and execution-plan construction.
- [x] Extend `route_request` validation and schemas without breaking 0.4 inputs.
- [x] Add regression tests for profiles, budgets, single and multi-stage plans, and compatibility fields.
- [x] Prevent budget results from reporting success when the recommended model is under-capable or no compatible model exists.

### Task 2: Diagnostics and model inventory validation

**Files:** `mcp/diagnostics.mjs`, `mcp/models.mjs`, `mcp/schema.mjs`, `mcp/server.mjs`, `test/mcp-0.5.test.mjs`

- [x] Add reusable model inventory normalization and validation.
- [x] Add `explain_route`, `compare_routes`, `simulate_policy`, and `validate_model_inventory`.
- [x] Return structured and text content for every diagnostic tool.
- [x] Add tests for deterministic comparisons, explanations, invalid inventories, and explicit capability-negotiation rejection reasons.
- [ ] Add strict output schemas to every diagnostic and evaluation tool, not only `route_request`.

### Task 3: Router evaluation tool

**Files:** `mcp/evaluation.mjs`, `mcp/schema.mjs`, `mcp/server.mjs`, `test/mcp-0.5.test.mjs`

- [x] Add bounded evaluation-case validation.
- [x] Calculate harmful under-routing, over-routing, exact-tier accuracy, capability recall, and a confusion matrix.
- [x] Expose `evaluate_router` as a read-only MCP tool.
- [x] Add tests for under-routed, over-routed, exact, and capability-recall batches.
- [ ] Make evaluation independent of learned preference state by default, with an explicit opt-in when preference-adjusted evaluation is desired.

### Task 4: Aggregate preference learning

**Files:** `mcp/learning.mjs`, `mcp/server.mjs`, `mcp/output-schema.mjs`, `test/mcp-0.5.test.mjs`, `test/mcp-learning-isolation.test.mjs`, `docs/mcp-learning.md`

- [x] Add category-only override recording and bounded aggregate weights.
- [x] Reject raw prompts, context, files, notes, and unknown override properties.
- [x] Add read and reset tools with correct MCP annotations.
- [x] Prevent learned downgrades from bypassing capability or high-stakes safety floors.
- [x] Isolate unconfigured in-memory stores per MCP session.
- [x] Share state only when an explicit persistent path is configured.
- [x] Serialize writes and make reads wait for queued mutations.
- [x] Add a 1 MiB persistent-state limit, atomic writes, retryable failed loads, and focused regressions.
- [x] Document persistence, trust boundaries, safety behavior, and reset semantics.

### Task 5: API metadata, smoke coverage, and documentation

**Files:** `mcp/server.mjs`, `scripts/mcp-smoke.mjs`, `package.json`, `README.md`, `docs/mcp.md`, `docs/mcp-learning.md`, `docs/README.md`

- [x] Publish Switchboard API contract `2026-07-24` and compatibility guarantees.
- [x] Bump the package and server to 0.5.0.
- [x] Expand the stdio smoke flow to discover the enhanced tool surface and route response.
- [x] Document profiles, budgets, execution plans, diagnostics, evaluation, capability negotiation, aggregate learning, and limitations.
- [ ] Update the main MCP reference with `modelRequirements` budget violations and the final evaluation-preference contract.

### Task 6: Final verification and publication

- [x] Run focused isolated learning tests: 5 passed, 0 failed.
- [x] Run focused isolated model-compatibility budget tests: 4 passed, 0 failed.
- [ ] Materialize the complete branch in a repository-aware runtime.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run mcp:smoke`.
- [ ] Fix any integration failures found by those commands.
- [ ] Review the final complete diff.
- [ ] Fast-forward merge to `main` only after fresh full verification.
