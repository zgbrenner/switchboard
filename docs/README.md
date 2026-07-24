# Switchboard documentation

This index separates current Switchboard MCP 0.5.0 behavior from the retained browser-extension foundation, optional local-model work, and historical implementation records.

## Current product documentation

### [MCP server reference](mcp.md)

The authoritative reference for:

- Stdio and stateful Streamable HTTP
- MCP lifecycle and supported protocol revisions
- Switchboard API contract `2026-07-24`
- `route_request`, profiles, budgets, confidence evidence, and execution plans
- Concrete host-model ranking
- `explain_route`, `compare_routes`, and `simulate_policy`
- `validate_model_inventory`
- `evaluate_router`
- Resources, prompts, completion, authentication, Host/Origin controls, and limits
- Privacy guarantees and host-enforcement limitations

### [Architecture](architecture/overview.md)

The shared local router, MCP request flow, model-inventory resolution, transport boundaries, and secondary browser-extension interface.

### [Privacy and threat model](privacy.md)

Data processed in memory, non-persistence guarantees, evaluation-data handling, stdio and HTTP security controls, extension permissions, and trust boundaries.

### [Contributing](../CONTRIBUTING.md)

Verification requirements and rules for changing lifecycle behavior, schemas, profiles, budgets, execution plans, diagnostics, evaluation, model resolution, transports, routing, or documentation.

## Shared router and evaluation

### [Router benchmarks](../benchmarks/README.md)

The checked-in shared-router benchmark and strict safety metrics. MCP 0.5 also exposes bounded in-memory evaluation through `evaluate_router`; protocol and transport behavior remains covered by Node tests and the stdio smoke test.

### [Research notes](research.md)

Specifications and open-source projects that informed MCP, deterministic and semantic routing, secure transport, file handling, and the local-model roadmap.

## Secondary extension foundation

### [File handling](architecture/file-inspection.md)

MCP accepts bounded file metadata and excerpts supplied by a host; it does not open arbitrary local files. This document also describes the retained browser-extension file-inspection subsystem.

The extension foundation is not required for MCP operation and is not the primary installation path.

## Optional local-model roadmap

### [Local-model roadmap](architecture/model-roadmap.md)

Optional packaged Scout, Arbiter, and Judge concepts, supply-chain controls, and release gates. Switchboard MCP works without downloading or training these models.

### [Experimental training toolchain](../training/README.md)

Research tooling for task-specific routing models. It is not part of MCP setup and its outputs are not enabled by default.

## Historical implementation records

Files under `docs/superpowers/specs/` and `docs/superpowers/plans/` record designs and implementation plans from specific development stages. They are useful for provenance but are not authoritative product documentation. Current README, MCP, architecture, and privacy documentation controls when historical records conflict.

## Current release facts

- Package and MCP server version: **0.5.0**
- Switchboard API contract: `2026-07-24`
- Primary interface: local MCP server
- Tools: `route_request`, `explain_route`, `compare_routes`, `simulate_policy`, `validate_model_inventory`, `evaluate_router`
- Transports: stdio and stateful Streamable HTTP
- MCP revision: `2025-11-25`
- Compatible revisions: `2025-06-18`, `2025-03-26`
- Remote routing service: none
- Persisted routing or evaluation content: none
- GitHub Actions required: no
