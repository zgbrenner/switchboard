# Local neural router roadmap

Switchboard's neural cascade is intentionally not enabled until task-specific checkpoints outperform the deterministic baseline under browser constraints.

## Planned stages

### Scout

- Base: `jhu-clsp/ettin-encoder-17m`
- Purpose: multi-task prediction of domain, complexity, required capabilities, route tier, and confidence
- Target: quantized ONNX compatible with Transformers.js on WebGPU and WASM

### Arbiter

- Base: `cross-encoder/ettin-reranker-17m-v1`
- Purpose: score the prompt against abstract route-policy descriptions
- Runs only on the top candidate routes

### Judge

- Initial candidate: `onnx-community/SmolLM2-135M-Instruct-ONNX`
- Purpose: constrained adjudication only when Scout, Arbiter, and deterministic signals disagree
- Loaded lazily and unloaded after inactivity

## Release gate

A model pack may be enabled only when it has:

- A task-specific validation set with simple, ambiguous, adversarial, multilingual, file-dependent, coding, research, and high-stakes prompts
- Harmful under-routing measured separately from wasteful over-routing
- Confidence calibration results
- WebGPU and WASM latency and memory measurements
- An immutable source revision
- SHA-256 and byte length for every packaged asset
- No network dependency at inference time

## Pack format

The runtime contract is defined in `src/models/manifest.ts`. Moving revisions such as `main` are rejected. A pack is self-contained and may not execute remote code or fetch unverified weights.
