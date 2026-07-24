# Local-model roadmap

Switchboard MCP 0.4.0 works without downloading, training, or packaging a neural model.

The current shared router combines deterministic safety and capability signals with lightweight semantic route scoring. The optional model-inventory resolver ranks models supplied by the host; it does not require Switchboard to know provider model names in advance.

This document describes optional future local inference stages and the retained extension model-pack work. It is not part of the MCP quick start.

## Design goals

Any neural routing stage must preserve these properties:

- Local inference only
- No remote model call during routing
- Provider-independent labels
- Deterministic capability floors remain authoritative
- Safe deferral or fallback when a model is missing, corrupt, slow, or uncertain
- Immutable upstream revision
- Exact byte length and SHA-256 verification for every packaged asset
- Measured improvement over simpler baselines
- Browser and Node runtime limits appropriate to the interface that loads the model

## Candidate cascade

### Scout

Purpose:

- Embed requests and abstract route policies in a shared semantic space
- Estimate task family and likely tier quickly
- Detect requests that are far from known routing examples

Bootstrap candidate work has used MiniLM-family encoders. Task-specific research targets compact Ettin encoders.

### Arbiter

Purpose:

- Jointly score a request against candidate route policies
- Resolve adjacent-tier ambiguity
- Run only when deterministic and Scout evidence is contested or insufficient

Bootstrap work has used MiniLM cross-encoders. Task-specific research targets compact Ettin rerankers.

### Judge

Purpose:

- Adjudicate only unusually ambiguous cases
- Produce constrained structured routing evidence rather than a free-form answer
- Load lazily, if included at all

A small generative model such as SmolLM2-135M has been considered, but a Judge should remain optional unless it proves a material benefit after latency, memory, calibration, and privacy testing.

## MCP integration options

A future MCP neural runtime can be added behind the same `route_request` contract:

```text
validated route_request
        |
        v
deterministic evidence
        |
        v
optional Scout
        |
        v
conditional Arbiter
        |
        v
optional Judge or deferral
        |
        v
same abstract MCP output schema
```

The host-facing schema should not change merely because the internal router becomes more sophisticated.

The MCP server should continue to work in deterministic fallback mode when no model pack is installed.

## Extension integration

The retained extension foundation can package browser-compatible ONNX models through Transformers.js and ONNX Runtime Web. Remote model loading must remain disabled at runtime.

The extension has additional constraints:

- Manifest V3 content-security policy
- Packaged WASM and tokenizer assets
- Browser memory pressure
- Cold-start latency
- Shared offscreen or worker execution
- Asset exposure and integrity validation

A model that performs well in Python is not automatically suitable for the browser extension.

## Task-specific training targets

Research tooling has considered:

### Trained Scout

- Base family: `jhu-clsp/ettin-encoder-17m`
- Objective: abstract tier, task family, capability, confidence, and out-of-distribution evidence

### Trained Arbiter

- Base family: `cross-encoder/ettin-reranker-17m-v1`
- Objective: request-to-route-policy utility ranking with difficult adjacent-tier negatives

Model names and provider brands must not become training labels. Training outputs should remain useful when provider offerings change.

## Release gate

A model pack may become a default only when it:

- Beats the deterministic router and any existing bootstrap stage on a locked reviewed set
- Does not worsen harmful under-routing
- Reports over-routing separately from under-routing
- Has calibrated confidence and out-of-distribution behavior
- Passes high-stakes, context-dependent, multilingual, file-dependent, coding, research, and adversarial cases
- Meets interface-specific latency and peak-memory limits
- Uses an immutable source revision
- Includes exact byte length and SHA-256 for every asset
- Requires no network dependency at inference time
- Fails safely when unavailable or invalid

A model that merely improves average accuracy but increases high-stakes under-routing should not ship.

## Pack format

The extension model-pack contract is defined in `src/models/manifest.ts`. Moving revisions such as `main` are rejected. A pack is self-contained and cannot execute remote code or fetch unverified weights.

A future Node/MCP pack should use the same principles even if its runtime layout differs.

## Current status

- MCP operation: no model pack required
- Host concrete-model ranking: implemented through `availableModels`
- Provider-independent abstract routing: implemented
- Browser bootstrap model work: retained in the repository
- Task-specific trained release models: roadmap work, not enabled by default
