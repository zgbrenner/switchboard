# Switchboard documentation

Switchboard 0.5.0 is an MCP-first, local request-planning and model-routing server.

## Authoritative documentation

- [MCP server reference](mcp.md): lifecycle, transports, tools, schemas, routing, budgets, evaluation, resources, and limitations
- [Aggregate learning](mcp-learning.md): category-only feedback, persistence, isolation, safety floors, and reset behavior
- [Privacy and threat model](privacy.md): runtime data boundaries and transport controls
- [Architecture](architecture/overview.md): shared router and MCP request flow
- [Contributing](../CONTRIBUTING.md): development and local verification requirements

## Shared router and evaluation

- [Router benchmarks](../benchmarks/README.md)
- [Research notes](research.md)

## Historical material

The browser-extension, local-model, training, and implementation-plan documents remain for provenance. They are not part of the default MCP installation or build. Current README and MCP documentation control when historical documents conflict.

## Release facts

- Version: **0.5.0**
- API contract: `2026-07-24`
- MCP revision: `2025-11-25`
- Compatible MCP revisions: `2025-06-18`, `2025-03-26`
- Tools: 9
- Transports: stdio and stateful Streamable HTTP
- Default build: MCP-only
- Remote routing service: none
- GitHub Actions required: no
