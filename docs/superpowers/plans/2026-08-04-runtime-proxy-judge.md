# Runtime Proxy and Judge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task, with test-driven development and verification before completion.

**Goal:** Ship a separately executable same-wire proxy and a pluggable, fail-open runtime judge on top of the merged P0 runtime core.

**Tech stack:** TypeScript 5.8, Node.js 22 built-ins, native fetch and streams, Node test runner, zero runtime dependencies.

## Task 1: Judge contract and reconciliation

**Files:** `src/judge/*`, `src/runtime/session.ts`, `test/judge.test.mjs`

- [x] Write red tests for deterministic authority, judge escalation, fail-open behavior, bounded remote payloads, and hashed session identifiers.
- [x] Add `RuntimeJudge`, deterministic and remote adapters, coordinator, and runtime decision reconciliation.
- [x] Prove a judge cannot demote or override a deterministic intervention.

## Task 2: Wire recovery and restart transforms

**Files:** `src/proxy/wire.ts`, `src/proxy/types.ts`, `test/proxy-wire.test.mjs`

- [x] Write red tests for OpenAI call/output pairing, Anthropic tool use/results, `is_error`, action classification, stable sessions, and clean restarts.
- [x] Normalize both wires into P0 observations without retaining raw values.
- [x] Preserve tool facts and artifacts while dropping narration and reasoning on switch/restart.

## Task 3: Proxy controller and configuration

**Files:** `src/proxy/config.ts`, `src/proxy/controller.ts`, `test/proxy-controller.test.mjs`

- [x] Write red tests for alias rewriting, runtime escalation, route floors, and non-loopback authentication.
- [x] Validate bounded route, session, budget, credential, and bind configuration.
- [x] Run preflight once per session, deduplicate accumulated history, and select only configured models at or above the current tier.

## Task 4: HTTP forwarding, streaming, and inspection

**Files:** `src/proxy/server.ts`, `src/proxy/usage.ts`, `test/proxy-server.test.mjs`

- [x] Write integration tests against real local mock upstream servers.
- [x] Forward JSON and SSE responses, meter usage on a tee'd stream, and preserve client bytes.
- [x] Add health, authenticated inspection, routing headers, local budget/human stops, request limits, and upstream credential isolation.

## Task 5: CLI, packaging, and documentation

**Files:** `proxy/index.mjs`, `package.json`, `tsconfig.mcp.json`, `scripts/build.mjs`, `scripts/packed-smoke.mjs`, `docs/proxy.md`, `docs/runtime-judge.md`

- [x] Add public exports and the `switchboard-proxy` binary.
- [x] Fix the P0 package-build gap by compiling all `src/**/*.ts`.
- [x] Expand the packed artifact smoke test to import runtime, judge, and proxy exports and start an ephemeral proxy.
- [ ] Run full verification, benchmark, dependency audit, CodeQL, package installation, and a final diff review before merging.
