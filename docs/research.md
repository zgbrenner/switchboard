# Research notes

Switchboard borrows concepts from open specifications and projects, not hosted routing infrastructure. The current MCP server remains local and dependency-light.

## MCP and protocol design

- **Model Context Protocol specification:** lifecycle initialization, tools, resources, prompts, completion, structured content, stdio, and Streamable HTTP semantics.
- **JSON-RPC 2.0:** request, response, notification, error-code, and ID validation behavior.
- **MCP security guidance:** loopback-first binding, Host and Origin validation, session management, and authorization for exposed HTTP servers.

Switchboard implements a focused MCP surface rather than wrapping the full SDK. This keeps runtime dependencies small, but it makes protocol regression tests and specification review essential whenever MCP behavior changes.

## Routing research

- **vLLM Semantic Router:** typed signals, composable routing decisions, capability-aware policies, and separation between hard routing constraints and soft preferences.
- **Aurelio Labs Semantic Router:** representative route descriptions, semantic similarity, route-specific thresholds, and explicit no-match behavior.
- **RouteLLM:** estimating the benefit of a stronger model separately from the user's cost-quality threshold.
- **RouterBench, LLMRouterBench, and related evaluations:** strong-versus-weak routing objectives, oracle gap, weighted regret, calibration, and the danger of sophisticated routers failing to beat simple baselines.

Switchboard therefore preserves deterministic baselines, penalizes harmful under-routing more heavily than conservative over-routing, and keeps model names outside learned labels.

## Universal host model resolution

The MCP 0.4 resolver is intentionally deterministic. It uses host-supplied abstract metadata rather than provider-specific assumptions:

- Quality tier
- Effort levels
- Capability support
- Availability
- Relative cost and latency
- Current-model continuity

Confirmed capability mismatches are hard exclusions. Unknown capability support is penalized but remains visible. This design follows the principle that the host is authoritative about which models it can actually invoke.

## Local inference research

- **Ettin encoder and reranker families:** compact task-specific Scout and Arbiter candidates.
- **MiniLM encoder and cross-encoder families:** bootstrap semantic and ranking candidates.
- **SmolLM2-135M-Instruct:** optional small generative adjudicator candidate.

Neural scoring remains future work. Switchboard runs with no runtime dependencies and requires no model download.

## File handling research

- **Microsoft MarkItDown:** document-conversion architecture and format-specific adapters.
- **Archive parser hardening:** central-directory inspection, path traversal controls, decompression limits, and metadata-only fallback.

The MCP server accepts only bounded host-supplied file summaries: name, type, size, text length, and a short excerpt. It never receives or opens file bytes.

## Future deterministic signals

- **RE2-style regular-expression constraints:** bounded user-defined matching without pathological backtracking.
- **Tree-sitter:** code-aware structure signals without requiring a generative model.
- **Language identification and script-aware routing:** more reliable multilingual handling and out-of-distribution detection.

Future additions should prove measurable value through ablation. Complexity that does not improve harmful under-routing, calibration, capability recall, or cost-quality regret should be removed.

## Security principles retained from research

- Local and private by construction
- No remote executable code
- Strict bounded inputs
- Explicit capability floors
- Stateful HTTP sessions with expiry and deletion
- Authentication required for non-loopback binding
- Host and Origin validation remain independent of authentication
- Timing-safe bearer-token comparison
- Provider-independent routing labels
- Advisory MCP output rather than pretending the server controls the host
