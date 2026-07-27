# Switchboard MCP 0.5 implementation plan

**Status:** Fully implemented and locally verified. Fast-forward merge to `main` is the only remaining publication step.

**Goal:** Add planning, profiles, budgets, diagnostics, reproducible evaluation, model capability negotiation, privacy-preserving aggregate preference learning, and an additive versioned response contract to the local Switchboard MCP server.

## Constraints

- Local and provider independent
- MCP only by default
- No provider invocation, gateway, telemetry, prompt persistence, or GitHub Actions
- Preserve 0.4 request and response compatibility
- Bound all inputs, outputs, evaluations, and persistent aggregate state

## Completed work

- [x] Built-in routing profiles and strict lookup
- [x] Budget normalization and model-compatibility assessment
- [x] Confidence evidence and multi-stage execution plans
- [x] Complete input and output JSON Schema 2020-12 contracts for all tools
- [x] Route explanation, comparison, and simulation tools
- [x] Provider-independent model-inventory validation and capability negotiation
- [x] Reproducible router evaluation with optional preference observation
- [x] Category-only override learning with isolated in-memory defaults
- [x] Explicit opt-in persistent aggregate state
- [x] Atomic serialized writes, 1 MiB limit, retryable failed loads, and reset semantics
- [x] Safety floors preventing harmful learned downgrades
- [x] MCP-only default package and production build
- [x] Updated README and MCP documentation

## Verification completed

- [x] TypeScript type checking
- [x] 77 Node tests, 77 passed, 0 failed
- [x] MCP-only production build
- [x] Real stdio smoke covering lifecycle, discovery, planning, model resolution, learning, evaluation, and completion
- [x] No GitHub Actions added or used
- [ ] Fast-forward the exact verified branch to `main`
