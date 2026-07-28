# Contributing to Switchboard

Switchboard is a local MCP server. It has no runtime dependencies; everything under `mcp/` imports only `mcp/` and Node builtins, and the routing engine in `src/` compiles to `dist/js/`.

## Local verification

Focused MCP work should pass:

```bash
npm install
npm test
npm run build
npm run mcp:smoke
```

The complete repository gate is:

```bash
npm run verify
```

Run checks locally. Do not add GitHub Actions or depend on GitHub-hosted CI minutes.

## MCP contribution rules

### Lifecycle and JSON-RPC

Changes to `mcp/server.mjs` must preserve:

- `initialize` and `notifications/initialized` ordering
- Valid string or finite-number IDs
- Notification behavior without responses
- Standard JSON-RPC error structure
- Compatibility with the documented MCP revisions
- `ping` before and after initialization
- Strict params validation

Add a failing regression test before changing lifecycle or protocol behavior.

### Tool schemas

`route_request` runtime validation and advertised JSON Schema must remain aligned.

When adding or changing an input:

- Set an explicit bound
- Reject unknown properties
- Reject whitespace-only identifiers where meaningful
- Reject invalid booleans instead of silently coercing them
- Keep model names and provider brands outside routing labels
- Update structured output schema and examples
- Update `docs/mcp.md`, `README.md`, and architecture/privacy docs when public behavior changes

### Model inventory resolver

Changes to `mcp/models.mjs` must preserve:

- Hard exclusion for confirmed missing required capabilities
- Strong penalties for under-tier and under-effort candidates
- Visible unknown-capability reporting
- Stable deterministic ordering
- Policy-specific quality, cost, and latency tradeoffs
- Continuity preference only when the current model remains adequate
- No provider-specific hard coding

Add tests for adequate, underpowered, unavailable, capability-incompatible, unknown-capability, equal-score, and current-model cases.

### Stdio transport

- Standard output may contain only newline-delimited JSON-RPC messages.
- Diagnostics belong on standard error.
- Message size limits must remain enforced.
- Parse errors must not terminate an otherwise usable session.

Do not configure the shipped stdio client example through an unsilenced npm script.

### Streamable HTTP

Changes to `mcp/http.mjs` must preserve:

- Loopback binding by default
- Authentication requirement for non-loopback binding
- Host validation
- Origin validation
- Required content type and `Accept` values
- 1 MiB body limit unless a separately reviewed change updates all tests and docs
- Cryptographically random session IDs
- Negotiated protocol-version binding
- Session expiry and maximum-session limits
- Explicit session deletion
- Timing-safe bearer-token comparison
- No retention of routing content in session state

Add transport-level tests for every security behavior you change.

## Shared router changes

Add a failing benchmark or unit test before changing:

- Deterministic routing
- Semantic route scoring
- Capability detection
- Policy bias
- High-stakes floors
- Context-dependent routing
- Out-of-distribution handling
- Preference adjustments

Evaluate harmful under-routing separately from wasteful over-routing. A lower average error rate does not justify a regression in consequential under-routing.

## File handling

For MCP, file inputs are bounded metadata and excerpts supplied by the host. Do not add arbitrary filesystem access to `route_request` without a separate security design and explicit user approval.

For the extension path, add tests before changing file detection, Open XML parsing, PDF behavior, archive handling, extraction bounds, worker timeouts, or metadata-only fallback.

## Local-model research

A candidate model may not become a default until it:

- Beats the current baseline on a locked reviewed set
- Does not worsen harmful under-routing
- Meets calibration and out-of-distribution gates
- Meets interface-specific latency, memory, and size limits
- Uses immutable and verified assets
- Requires no remote inference
- Fails safely when absent or invalid

Do not commit access tokens, private model artifacts, generated training output, or user prompts.

## Documentation

The authoritative hierarchy is:

1. `README.md`
2. `docs/README.md`
3. `docs/mcp.md`
4. Current architecture and privacy documents
5. Secondary subsystem and roadmap documents
6. Historical specs and plans

When behavior changes, update all affected current documents in the same branch. Historical implementation records should not be rewritten to look current; add a status note only when necessary.

Before merging documentation changes, confirm that:

- Version numbers agree
- Commands exist in `package.json`
- Links resolve to repository paths
- MCP is not described as able to force host model selection
- Neural models are not described as required or shipped unless that is true
- Privacy claims match the implementation
- The branch contains no unrelated code changes

## Pull requests and commits

Keep changes focused and use descriptive commit messages. Review the complete diff before merging. A documentation-only branch should contain only Markdown changes unless a version or package metadata correction is explicitly required.
