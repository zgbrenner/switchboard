# Experimental Switchboard model training

The MCP server does not require trained neural models. Switchboard MCP 0.4.0 routes requests with the shared deterministic and lightweight semantic engine and can rank a host-supplied model inventory without downloading model weights.

This directory contains experimental tooling for task-specific local Scout and Arbiter models. It supports research and future model-pack development; it is not part of the MCP installation path and its outputs are not enabled by default.

## Intended model roles

### Scout

A compact encoder intended to estimate:

- Abstract route tier
- Required capabilities
- Task family
- Confidence
- Out-of-distribution evidence

### Arbiter

A compact cross-encoder intended to score a request against abstract route-policy descriptions when simpler evidence is ambiguous.

Provider names and commercial model names must not be training labels.

## Prepare seed data

```bash
python -m training.prepare_data
```

The command writes deterministic examples under `training/generated/`, which is intentionally ignored by Git.

The checked-in seed data and router smoke benchmark are not sufficient to train a production release model.

## Dataset requirements

Before training a release candidate, use properly licensed or authored examples covering:

- Simple transformations and low-risk requests
- Adjacent-tier boundary cases
- Difficult coding, legal, security, financial, medical, and technical analysis
- Current research and primary-source verification
- Attachments, scanned documents, images, and long context
- Short context-dependent follow-ups
- Conflicting speed and quality instructions
- Multilingual and adversarial prompts
- Explicit capability mismatches
- Out-of-distribution requests that should defer

Keep source groups isolated across training, calibration, validation, and locked evaluation. A human-reviewed locked set must remain separate from teacher-generated labels.

Raw prompts from MCP users or extension users must not be collected automatically for training.

## Install research dependencies

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r training/requirements.txt
```

## Pin immutable base revisions

Resolve and record the exact Hugging Face commit for each base model. Never train or package from `main`, an unpinned branch, or a moving tag.

Candidate families documented elsewhere include compact Ettin encoders and rerankers. A candidate is not approved merely because it is small.

## Train Scout

```bash
python -m training.train_scout \
  --revision <ETTIN_ENCODER_COMMIT> \
  --train training/generated/scout-train.jsonl \
  --validation training/generated/scout-validation.jsonl
```

The current experimental Scout design uses abstract tier and capability labels. Calibration thresholds must be derived from held-out data rather than copied from a teacher model.

## Train Arbiter

```bash
python -m training.train_arbiter \
  --revision <ETTIN_RERANKER_COMMIT> \
  --train training/generated/arbiter-train.jsonl \
  --validation training/generated/arbiter-validation.jsonl
```

The Arbiter scores a request against each provider-independent route-policy description.

## Export a verified pack

```bash
python -m training.export_pack \
  --model-dir training/output/scout \
  --output model-packs/generated/scout \
  --pack-id switchboard-scout-v1-fp32 \
  --stage scout \
  --source-repository jhu-clsp/ettin-encoder-17m \
  --source-revision <ETTIN_ENCODER_COMMIT>
```

A pack manifest must include:

- Immutable source repository and revision
- Exact byte size of every asset
- SHA-256 of every asset
- Runtime and quantization metadata
- Label ordering
- Calibration values
- Dataset revision and evaluation metrics

Quantization labels must describe the actual exported artifact. Do not relabel an unquantized model without exporting and benchmarking the quantized graph.

## Evaluation requirements

Report at minimum:

- Acceptable-route rate
- Harmful under-routing
- Wasteful over-routing
- Weighted routing regret
- Expected calibration error
- Out-of-distribution deferral
- Capability precision and recall
- High-stakes subset results
- Cold and warm latency
- Peak memory
- Final package size

The most important failure is harmful under-routing. A smaller or faster model that routes consequential work too low should not ship.

## Interface-specific validation

### MCP or Node runtime

Validate:

- Local-only asset loading
- Deterministic fallback when the pack is missing or corrupt
- Cancellation and timeout behavior
- No change to the public `route_request` output contract
- Node latency and memory

### Browser extension

Also validate:

- Transformers.js and ONNX Runtime Web compatibility
- WASM fallback
- WebGPU acceleration where available
- Manifest V3 content-security policy
- Worker/offscreen loading
- Browser memory and cold start
- Exact packaged resource exposure

## Release gate

Do not enable a trained model by default until it:

1. Beats the deterministic and existing bootstrap baselines on a locked reviewed evaluation set.
2. Meets the harmful-under-routing and calibration thresholds.
3. Passes high-stakes, adversarial, multilingual, context, file, vision, coding, and research subsets.
4. Meets runtime-specific size, latency, and memory limits.
5. Has immutable and verified assets.
6. Requires no remote inference or runtime download.
7. Fails safely to the existing router.

## Relationship to MCP model inventories

Training a Switchboard router model is different from supplying `availableModels` to MCP:

- A Switchboard router model improves the internal classification of the request.
- `availableModels` describes concrete models the host can invoke.
- The model inventory resolver remains deterministic and provider-independent.
- A future neural router must still return the same abstract tier, effort, capability, and model-resolution schema.
