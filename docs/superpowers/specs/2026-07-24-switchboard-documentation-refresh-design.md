# Switchboard 0.4 Documentation Refresh Design

**Status:** Approved by the request to update all documentation after the MCP 0.4.0 hardening merge.

## Goal

Make every user-facing document describe Switchboard consistently as a privacy-first local MCP request and model router, with the Chromium extension retained as a secondary foundation rather than the primary product narrative.

## Documentation hierarchy

1. `README.md` is the concise product overview and quick start.
2. `docs/README.md` is the documentation index and status map.
3. `docs/mcp.md` is the authoritative MCP protocol, transport, schema, security, and client-integration reference.
4. Architecture and privacy documents describe the shared router first, then explain MCP- and extension-specific boundaries.
5. File inspection, model training, and browser-extension documents are explicitly scoped as optional or future-facing subsystems.
6. Superpowers specs and plans remain historical implementation records; current ones may receive a status note but are not rewritten as product reference documentation.

## Required consistency

All current documentation must agree that:

- The current package and MCP server version is 0.4.0.
- The primary MCP tool is `route_request`.
- The router emits provider-independent `fast`, `balanced`, `deep`, and `max` tiers.
- Hosts may supply an optional model inventory for concrete model ranking.
- Stdio and stateful Streamable HTTP are supported.
- HTTP uses session IDs, negotiated protocol headers, expiry, deletion, Host/Origin checks, and optional bearer authentication.
- Non-loopback HTTP binding requires bearer authentication.
- MCP routing is advisory; the host decides whether to call the tool and apply its recommendation.
- Prompt, context, file excerpts, model inventories, and decisions are processed in memory and are not persisted.
- The browser extension foundation remains in the repository but is not required to use the MCP server.
- Neural model packs and task-specific training are optional roadmap work, not a prerequisite for MCP operation.

## Validation

The refresh is complete when all linked user-facing Markdown files are internally consistent, commands match `package.json`, links resolve to existing repository paths, stale extension-first claims are removed, and a final diff contains documentation-only changes.