# Local neural router roadmap

Switchboard supports a conservative bootstrap neural cascade now and a task-specific training path for later replacement.

## Bootstrap runtime

### Scout

- Model: `onnx-community/all-MiniLM-L6-v2-ONNX`
- Quantization: Q4
- Purpose: embed the request and abstract route policies in the same local semantic space
- Execution: packaged Transformers.js and ONNX Runtime Web through WASM

### Arbiter

- Model: `Xenova/ms-marco-MiniLM-L-6-v2`
- Quantization: UINT8
- Purpose: jointly score the request against the strongest candidate route descriptions
- Execution: only after Scout narrows the candidates

### Judge

- Model: `onnx-community/SmolLM2-135M-Instruct-ONNX`
- Quantization: Q4F16
- Purpose: constrained adjudication only when the baseline, Scout, and Arbiter remain uncertain
- Installation: optional and disabled by default

All three repositories are fetched from immutable revisions by `scripts/fetch-models.mjs`. Every asset is hashed and recorded in a local model-pack manifest. The extension disables remote model loading and uses only packaged paths.

## Task-specific replacement path

The included training toolchain targets:

### Trained Scout

- Base: `jhu-clsp/ettin-encoder-17m`
- Objective: multi-task prediction of domain, complexity, required capabilities, route tier, and calibrated confidence

### Trained Arbiter

- Base: `cross-encoder/ettin-reranker-17m-v1`
- Objective: task-specific route-policy ranking with difficult adjacent-tier negatives

The task-specific models should replace the bootstrap models only after they outperform both deterministic routing and the bootstrap cascade on a locked human-reviewed evaluation set.

## Release gate

A model pack may be enabled by default only when it has:

- A task-specific validation set with simple, ambiguous, adversarial, multilingual, file-dependent, coding, research, and high-stakes prompts
- Harmful under-routing measured separately from wasteful over-routing
- Confidence calibration results
- Browser latency and peak-memory measurements
- An immutable source revision
- SHA-256 and byte length for every packaged asset
- No network dependency at inference time

## Pack format

The runtime contract is defined in `src/models/manifest.ts`. Moving revisions such as `main` are rejected. A pack is self-contained and may not execute remote code or fetch unverified weights.
