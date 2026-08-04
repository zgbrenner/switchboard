# Runtime Routing Core Design

## Goal

Add a provider-neutral, local-only closed-loop routing core to Switchboard. The core observes bounded execution evidence after a task starts and returns guarded decisions to continue, increase effort, switch upward, restart with a clean context, escalate to a human, or stop for budget.

## Scope

This phase includes typed trajectories, deterministic evidence detectors, policy evaluation, runtime sessions, bounded session storage, tests, and a package export. It does not include an HTTP proxy, provider adapters, OAuth, streaming translation, or a remote model judge.

## Architecture

`src/runtime/trajectory.ts` converts raw tool observations into privacy-preserving steps using stable SHA-256 digests. Raw arguments and outputs are not retained by default. `src/runtime/signals.ts` derives deterministic signals from completed steps. `src/runtime/policy.ts` maps signals and session state to a one-way intervention ladder. `src/runtime/session.ts` owns bounded trajectory retention, cumulative budgets, intervention counters, and TTL-based storage.

The initial preflight tier is a hard floor. Runtime decisions may increase effort or move upward through the configured ladder, but never demote beneath that floor.

## Evidence Model

Each completed step records a sequence number, tool name, action kind, argument digest, optional output digest, success/failure state, optional normalized error class, relative cost, and context-token count. Pending calls are retained but excluded from failure and loop detectors until a result arrives.

Progress is deliberately narrow: a successful `execute` or `verify` step. Reads, searches, narration, and writes are useful activity but do not prove the task is closer to completion.

## Deterministic Signals

The core detects repeated action/observation pairs, repeated error classes, two-action ping-pong, write/fail/rewrite/fail cycles, consecutive failures, and steps since verified progress. Budget and context exhaustion are policy checks, not model judgments.

## Policy

Budget stops run first. The first recoverable intervention is an effort increase when available. A severe loop or repeated failure then advances one tier. At the strongest tier, repeated bad checkpoints cause a clean restart. Exhausted restart or switch budgets produce human escalation. Restart decisions preserve task artifacts and real tool outputs while instructing the host to drop assistant narration and provider-specific reasoning.

## Privacy and Failure Behavior

The runtime has no network access and no runtime dependency. Callers may opt into bounded previews, but the default stores only digests and structured metadata. If evidence is insufficient, the decision is `continue`. Invalid observations are rejected rather than guessed.

## Testing

Tests cover digest stability, non-retention of raw values, every detector, verified-progress semantics, budget precedence, one-way tiers, effort escalation, restart/human behavior, bounded trajectory retention, session expiry, and capacity eviction.
