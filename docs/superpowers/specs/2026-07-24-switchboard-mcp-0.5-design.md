# Switchboard MCP 0.5 design

## Goal

Turn Switchboard from a single-decision router into a provider-independent routing control plane that can plan multi-stage work, honor host budgets, explain decisions, validate model inventories, compare policies, and evaluate routing quality without storing prompt content.

## Scope

Switchboard 0.5 remains a local MCP server. It does not invoke provider models, force host model changes, add a gateway, persist prompts, or require neural model downloads.

## Route request

`route_request` keeps every 0.4 field and adds optional inputs:

- `profile`: reusable domain or operating profile.
- `budget`: normalized cost, latency, and quality constraints.
- `planMode`: `single`, `auto`, or `multi`.
- `apiVersion`: stable Switchboard response contract version.

The result adds:

- `apiVersion` and compatibility metadata.
- `profile` and effective policy.
- `confidenceEvidence`, decomposing score margin, deterministic evidence, and capability certainty.
- `executionPlan`, containing one or more independently routable stages.
- `budgetAssessment`, explaining whether the recommendation fits host constraints.

## Profiles

Built-in profiles are `general`, `coding`, `legal`, `research`, `creative`, `security`, `finance`, `medical`, `low-cost`, and `low-latency`. Profiles adjust policy, category boosts, minimum tier, and required capabilities, but cannot lower deterministic safety floors.

## Diagnostics tools

- `explain_route`: return a human-readable explanation and structured decision evidence.
- `compare_routes`: compare policies or profiles for the same request.
- `simulate_policy`: run one request across selected policies without changing state.
- `validate_model_inventory`: validate and summarize host model metadata without routing a prompt.
- `evaluate_router`: calculate harmful under-routing, over-routing, capability recall, exact-tier accuracy, and a confusion matrix for a bounded batch.

All tools are read-only, deterministic for the same inputs, and non-persistent.

## Compatibility

The default API contract is `2026-07-24`. Existing 0.4 request fields remain valid. Existing response fields are retained. New fields are additive. Server metadata publishes supported API contract versions and a compatibility policy.

## Security and privacy

All new inputs are bounded and strictly validated. Evaluation batches are processed in memory and discarded. No raw prompt, expected label, model inventory, plan, or diagnostic result is persisted. Existing stdio and HTTP transport protections remain unchanged.

## Verification

Regression tests cover backward-compatible routing, profiles, budgets, execution plans, confidence evidence, inventory validation, policy comparison, evaluation metrics, schema bounds, and metadata discovery. The stdio smoke test discovers all tools and verifies an enhanced `route_request` response.
