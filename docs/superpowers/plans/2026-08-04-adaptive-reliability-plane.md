# Adaptive Reliability Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add health-aware multi-upstream selection, capability filtering, bounded retries and fallbacks, circuit breaking, and privacy-safe telemetry to the Switchboard proxy without adding runtime dependencies or complicating the default setup.

**Architecture:** Preserve preflight tier floors and same-wire provider compatibility. Normalize each tier to an endpoint pool, extract structured request requirements, choose through an in-memory health registry, execute through one retry coordinator, and emit bounded content-free telemetry.

**Tech Stack:** TypeScript 5.8, Node.js 22 built-ins, Fetch API, Node test runner, Biome, no runtime dependencies.

## Global Constraints

- Existing single-upstream proxy configuration remains valid.
- Runtime routing may never select below the preflight tier floor.
- Responses requests only target Responses-compatible routes; Messages requests only target Messages-compatible routes.
- No prompt text, response content, tool arguments, tool outputs, API keys, or raw session identifiers enter health or telemetry state.
- Retries occur at one layer only, use capped exponential backoff with jitter, and stop before any streaming bytes are forwarded.
- The published package retains zero runtime dependencies.

---

### Task 1: Restore the baseline verification gate

**Files:**
- Modify: `src/runtime/policy.ts`

**Interfaces:**
- Consumes: existing runtime policy behavior.
- Produces: a format-clean baseline with no behavior change.

- [ ] Reproduce the current `npm run format:check` failure from CI and confirm it points only to `budgetDecision` formatting.
- [ ] Apply the exact Biome formatting result without changing runtime logic.
- [ ] Run `npm run format:check` and the runtime tests.
- [ ] Commit the isolated repair.

### Task 2: Add failing adaptive configuration and requirement tests

**Files:**
- Create: `test/proxy-adaptive-config.test.mjs`
- Create: `test/proxy-requirements.test.mjs`

**Interfaces:**
- Produces expected public contracts: `ProxyRoutingProfile`, endpoint arrays, `extractProxyRequirements`, `filterCompatibleUpstreams`.

- [ ] Test that a legacy route object normalizes to a one-element endpoint pool with a stable ID.
- [ ] Test that an endpoint array preserves order, validates unique IDs, and applies profile defaults.
- [ ] Test explicit tools, vision, JSON, reasoning, context, output-token, and zero-retention incompatibilities.
- [ ] Open a pull request and verify the new tests fail because the contracts do not exist.

### Task 3: Normalize endpoint pools and simplified profiles

**Files:**
- Modify: `src/proxy/types.ts`
- Modify: `src/proxy/config.ts`
- Modify: `src/proxy/index.ts`
- Modify: `examples/switchboard.proxy.example.json`

**Interfaces:**
- Produces: `ProxyRoutingProfile`, `ProxyEndpointCapabilities`, `ProxyUpstreamPool`, normalized routing and reliability settings.

- [ ] Implement object-or-array route input while normalizing every tier to an immutable array.
- [ ] Generate stable endpoint IDs from wire, tier, base URL, and model when omitted; reject duplicates.
- [ ] Add `balanced`, `reliability`, `latency`, and `cost` profile defaults.
- [ ] Add optional capability, privacy, weight, timeout, retry, circuit-breaker, and retry-bucket settings with strict bounds.
- [ ] Run the focused configuration tests and refactor only after green.

### Task 4: Extract and enforce request requirements

**Files:**
- Create: `src/proxy/requirements.ts`
- Modify: `src/proxy/index.ts`
- Modify: `src/proxy/controller.ts`
- Test: `test/proxy-requirements.test.mjs`

**Interfaces:**
- Produces: `extractProxyRequirements(wire, body, options)` and `filterCompatibleUpstreams(pool, requirements)`.

- [ ] Extract structured requirements without retaining content.
- [ ] Treat explicit `false` capability metadata as incompatible; preserve unknown capabilities unless strict matching is enabled.
- [ ] Require explicit zero-data-retention support when configured.
- [ ] Reject requests whose estimated input or requested output exceeds declared endpoint limits.
- [ ] Return a structured local incompatibility error rather than stripping parameters.
- [ ] Run focused tests and the existing proxy controller tests.

### Task 5: Add failing health, circuit, and selection tests

**Files:**
- Create: `test/proxy-health.test.mjs`

**Interfaces:**
- Produces expected contracts: `ProxyHealthRegistry`, `selectHealthyUpstream`, endpoint snapshots.

- [ ] Test EWMA latency and error updates.
- [ ] Test circuit open after the configured consecutive retryable failures.
- [ ] Test one half-open probe and close-on-success or reopen-on-failure.
- [ ] Test bounded `Retry-After` cooldown.
- [ ] Test profile-specific scoring, current-load penalty, configured weight, and deterministic session-stable tie breaking.
- [ ] Verify the focused tests fail because the health module does not exist.

### Task 6: Implement adaptive health-aware selection

**Files:**
- Create: `src/proxy/health.ts`
- Modify: `src/proxy/index.ts`
- Modify: `src/proxy/types.ts`

**Interfaces:**
- Produces: `ProxyHealthRegistry`, `ProxyEndpointSnapshot`, `ProxySelectionContext`, and attempt lifecycle methods.

- [ ] Implement bounded endpoint state keyed by normalized endpoint ID.
- [ ] Implement passive health, latency, load, circuit, and rate-limit state transitions.
- [ ] Implement profile scoring with deterministic seed-based jitter.
- [ ] Prefer untried healthy endpoints while allowing controlled same-endpoint retries when the pool is exhausted.
- [ ] Run focused health tests and refactor only after green.

### Task 7: Add failing retry and streaming-safety tests

**Files:**
- Create: `test/proxy-reliability.test.mjs`

**Interfaces:**
- Produces expected contracts: `executeReliableFetch`, `RetryTokenBucket`, `isRetryableStatus`, `retryAfterMilliseconds`.

- [ ] Test network, 408, 409, 429, and 5xx retries, and terminal 4xx behavior.
- [ ] Test full-jitter bounds and bounded `Retry-After` precedence.
- [ ] Test retry token exhaustion prevents a storm.
- [ ] Test per-attempt timeout aborts a hung fetch.
- [ ] Test a retry chooses another compatible healthy endpoint.
- [ ] Test no retry occurs after a successful streaming response is returned for forwarding.
- [ ] Verify the focused tests fail because the reliability module does not exist.

### Task 8: Implement the single retry and fallback coordinator

**Files:**
- Create: `src/proxy/reliability.ts`
- Modify: `src/proxy/server.ts`
- Modify: `src/proxy/controller.ts`
- Modify: `src/proxy/types.ts`
- Modify: `src/proxy/index.ts`

**Interfaces:**
- Consumes: normalized pools, requirements, and `ProxyHealthRegistry`.
- Produces: actual selected endpoint, attempt trace, response, and routing headers.

- [ ] Implement one bounded attempt loop with a local retry token bucket.
- [ ] Apply per-attempt timeout, capped exponential backoff, full jitter, and bounded `Retry-After`.
- [ ] Cancel abandoned retryable response bodies before the next attempt.
- [ ] Rewrite the model and reasoning controls for the actual endpoint selected on each attempt.
- [ ] Update runtime usage and endpoint health from the actual endpoint, not the nominal first endpoint.
- [ ] Add actual endpoint ID, attempt count, and fallback status headers.
- [ ] Run focused reliability tests, proxy integration tests, and all runtime tests.

### Task 9: Add privacy-safe telemetry and status

**Files:**
- Create: `src/proxy/telemetry.ts`
- Modify: `src/proxy/server.ts`
- Modify: `src/proxy/types.ts`
- Modify: `src/proxy/index.ts`
- Create: `test/proxy-telemetry.test.mjs`

**Interfaces:**
- Produces: `ProxyTelemetrySink`, `ProxyTelemetryEvent`, bounded summary, and authenticated `/v1/switchboard/status` output.

- [ ] Test that telemetry includes operation, provider, model, endpoint ID, status, latency, attempts, tokens, cost, and decision metadata.
- [ ] Test that prompt, response, tool payloads, API keys, and raw session IDs cannot appear in serialized events.
- [ ] Implement a fail-isolated sink callback and bounded in-memory aggregate.
- [ ] Expose endpoint circuit, cooldown, latency, error, in-flight, and request totals through the status endpoint.
- [ ] Run focused telemetry and server tests.

### Task 10: Documentation, packaging, and full verification

**Files:**
- Modify: `docs/proxy.md`
- Modify: `docs/privacy.md`
- Modify: `docs/research.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `scripts/packed-smoke.mjs`
- Modify: `package.json` only if a new public export requires it.

**Interfaces:**
- Produces: documented stable configuration and packed public surface.

- [ ] Document the four profiles, endpoint pools, capability metadata, reliability defaults, status endpoint, and exact retry behavior.
- [ ] Add a migration example proving old configuration remains valid.
- [ ] Extend packed smoke coverage to import and exercise requirements, health, reliability, and telemetry exports.
- [ ] Run `npm run verify`, `npm run benchmark`, `npm audit --audit-level=high`, and the packed installation smoke test.
- [ ] Verify Node 22 and 24 on Ubuntu, macOS, and Windows plus CodeQL.
- [ ] Review the full diff for raw-content retention, credential forwarding, retry amplification, streaming corruption, and tier-floor regressions.
- [ ] Squash-merge only after every gate is green.
