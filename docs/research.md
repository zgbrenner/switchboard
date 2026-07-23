# Research notes

Switchboard borrows concepts, not server infrastructure, from these projects and specifications:

- Microsoft MarkItDown: document-to-Markdown conversion patterns and format-specific adapters
- vLLM Semantic Router: typed signals, composable routing decisions, and capability-aware policies
- Aurelio Labs Semantic Router: route descriptions, representative utterances, and calibrated semantic thresholds
- RouteLLM, RouterBench, and LLMRouterBench: strong-versus-weak routing objectives, cost-quality curves, and oracle-gap evaluation
- Transformers.js: packaged local inference through ONNX, WebGPU, and WASM
- Ettin encoder and reranker families: compact encoder and cross-encoder candidates
- SmolLM2-135M-Instruct: optional small generative adjudicator
- RE2 and Tree-sitter: future bounded user rules and code-aware signals
- PDF.js: future robust packaged PDF extraction

The default extension deliberately avoids external runtime dependencies until the neural checkpoints and additional parsers are packaged, benchmarked, and supply-chain pinned.
