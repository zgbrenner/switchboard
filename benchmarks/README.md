# Switchboard router benchmarks

The benchmark suite evaluates the **shared routing engine** used by the MCP server and the retained browser-extension foundation. It does not replace MCP lifecycle, schema, or transport tests.

## What a router case defines

Each checked-in case specifies:

- A request
- Optional recent context or file metadata
- The minimum acceptable tier
- The maximum reasonable tier where applicable
- Mandatory capabilities
- Expected safety behavior such as deferral

Provider model names are not benchmark labels. Cases use the abstract `fast`, `balanced`, `deep`, and `max` tiers so the evaluation remains valid when model offerings change.

## Run the benchmark

```bash
npm run benchmark
npm run benchmark -- --strict
```

Strict mode should fail when the router:

- Selects below the minimum acceptable tier
- Misses a mandatory capability
- Exceeds configured harmful-under-routing or calibration gates
- Fails required out-of-distribution deferral behavior

Over-routing is reported separately. It can waste latency or premium usage, but it is not treated as equivalent to harmful under-routing.

## MCP verification is separate

MCP server behavior is covered through the Node test suite and stdio smoke test:

```bash
npm test
npm run build
npm run mcp:smoke
```

Those checks cover behavior such as:

- Initialization and initialized-notification ordering
- Strict JSON-RPC and argument validation
- Tool discovery and structured output
- Model-inventory validation and ranking
- Resources, prompts, and policy completion
- Stateful HTTP session creation and deletion
- Required protocol and session headers
- Host and Origin validation
- Bearer authentication
- Session expiry and active-session limits
- Non-loopback binding protection
- Stdio protocol isolation

A router benchmark can pass while the MCP server is still protocol-incompatible; both layers must be verified.

## Concrete model resolution tests

The host model resolver should be tested with inventories that include:

- Adequate and underpowered tiers
- Multiple effort-level combinations
- Confirmed capability support
- Confirmed capability mismatches
- Unknown capabilities
- Unavailable models
- Cost and latency tradeoffs across all policies
- An adequate current model during a contextual conversation
- Stable tie-breaking by model ID

A model explicitly lacking a required capability must never be recommended.

## Corpus growth

The current checked-in corpus is a safety and regression suite, not a substitute for a large locked production evaluation set.

Grow it through reviewed examples covering:

- Adjacent-tier boundaries
- High-stakes domains
- Current research and source verification
- Difficult coding and security analysis
- Files, vision, and long context
- Short context-dependent follow-ups
- Conflicting instructions
- Multilingual prompts
- Adversarial and out-of-distribution inputs
- Policy tradeoffs

Do not automatically collect raw user prompts. New benchmark examples should be authored, properly licensed, or derived only from privacy-preserving aggregate behavior that cannot reconstruct user content.

## Release interpretation

A change is not better merely because average accuracy rises. Review:

1. Harmful under-routing first.
2. Mandatory capability recall.
3. High-stakes subset performance.
4. Calibration and deferral.
5. Weighted regret and over-routing.
6. Latency and memory.
7. MCP protocol and transport compatibility.
