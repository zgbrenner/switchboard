# Runtime Routing Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, provider-neutral runtime trajectory and escalation core that complements Switchboard's preflight router.

**Architecture:** Normalize tool observations into bounded digest-only steps, derive deterministic failure/progress signals, apply a guarded one-way policy, and retain state in bounded in-memory sessions. The existing preflight tier remains the minimum floor.

**Tech Stack:** TypeScript 5.8, Node.js 22 built-ins, Node test runner, no runtime dependencies.

## Global Constraints

- No network egress or provider-specific code in P0.
- Raw tool arguments and outputs are not stored by default.
- Runtime routing may never demote beneath the initial preflight tier.
- Budget checks run before all intervention logic.
- Production behavior must be introduced test-first.

---

### Task 1: Runtime contracts and trajectory normalization

**Files:**
- Create: `src/runtime/types.ts`
- Create: `src/runtime/digest.ts`
- Create: `src/runtime/trajectory.ts`
- Test: `test/runtime-core.test.mjs`

**Interfaces:**
- Produces: `normalizeRuntimeObservation`, `RuntimeEvidenceStep`, `RuntimeObservationInput`, `RuntimePolicyConfig`.

- [ ] Write failing tests for stable object-order-independent digests, pending observations, bounded optional previews, and default raw-value non-retention.
- [ ] Run the focused test and confirm failure because the runtime module does not exist.
- [ ] Implement stable serialization, SHA-256 digests, validation, and trajectory normalization.
- [ ] Compile and run the focused tests until green.

### Task 2: Deterministic runtime signals

**Files:**
- Create: `src/runtime/signals.ts`
- Modify: `test/runtime-core.test.mjs`

**Interfaces:**
- Consumes: `RuntimeEvidenceStep`, `RuntimePolicyConfig`.
- Produces: `detectRuntimeSignals`, `isVerifiedProgress`.

- [ ] Add failing tests for repeated pairs, repeated error classes, ping-pong, rewrite/retest, consecutive failures, and steps since verified progress.
- [ ] Confirm each test fails for the missing behavior.
- [ ] Implement detectors over completed evidence only.
- [ ] Run focused tests and refactor only after green.

### Task 3: Guarded policy and session state

**Files:**
- Create: `src/runtime/policy.ts`
- Create: `src/runtime/session.ts`
- Create: `src/runtime/index.ts`
- Modify: `test/runtime-core.test.mjs`

**Interfaces:**
- Produces: `evaluateRuntimePolicy`, `RuntimeSession`, `RuntimeSessionStore`.

- [ ] Add failing tests proving budget precedence, effort-first recovery, one-way tier switching, restart instructions, human escalation, bounded retention, TTL expiry, and capacity eviction.
- [ ] Confirm focused tests fail for missing policy/session behavior.
- [ ] Implement the minimal policy, session, and store required by the tests.
- [ ] Run the full test suite, typecheck, lint, format check, build, and smoke test.

### Task 4: Package and documentation surface

**Files:**
- Modify: `package.json`
- Create: `docs/runtime-routing.md`

**Interfaces:**
- Produces: package export `switchboard-mcp/runtime`.

- [ ] Add the runtime export and document host integration without claiming automatic proxy interception.
- [ ] Run `npm run verify`, `npm run benchmark`, and `npm audit --audit-level=high`.
- [ ] Review the diff against this plan and merge only after all gates are green.
