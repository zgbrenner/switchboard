# Switchboard documentation

This index separates current Switchboard MCP 0.4.0 behavior from the retained browser-extension foundation, optional local-model work, and historical implementation records.

## Current product documentation

### [MCP server reference](mcp.md)

The authoritative reference for:

- Stdio and stateful Streamable HTTP transports
- MCP lifecycle and supported protocol revisions
- `route_request` input and output
- Optional host model inventories and concrete model ranking
- Routing policies, resources, prompts, and completion
- HTTP sessions, bearer authentication, Host/Origin controls, and limits
- Privacy guarantees and the host-enforcement limitation

### [Architecture](architecture/overview.md)

The current shared-router architecture, including MCP request flow, model-inventory resolution, transport boundaries, and the secondary browser-extension interface.

### [Privacy and threat model](privacy.md)

Data processed in memory, data that is not persisted, stdio and HTTP security controls, extension permissions, and known trust boundaries.

### [Contributing](../CONTRIBUTING.md)

Local verification requirements and rules for changing the MCP lifecycle, schemas, model resolver, transports, router, extension foundation, or documentation.

## Shared router and evaluation

### [Router benchmarks](../benchmarks/README.md)

The benchmark contract for the shared routing engine used by both MCP and the extension foundation. MCP protocol and transport behavior is covered separately by Node tests and the stdio smoke test.

### [Research notes](research.md)

The specifications and open-source projects that informed the MCP server, deterministic routing, semantic routing, secure transport, file inspection, and model roadmap.

## Secondary extension foundation

### [File handling](architecture/file-inspection.md)

The MCP server accepts bounded file metadata and excerpts supplied by a host; it does not open arbitrary local files. This document also describes the retained browser-extension file-inspection subsystem.

The extension foundation remains in the repository for ChatGPT and Claude browser integration. It is not required for MCP operation and should not be treated as the primary Switchboard installation path.

## Optional local-model roadmap

### [Local-model roadmap](architecture/model-roadmap.md)

Optional packaged Scout, Arbiter, and Judge concepts, supply-chain controls, and release gates. The current MCP server works without downloading or training these models.

### [Experimental training toolchain](../training/README.md)

Research and development tooling for task-specific routing models. The toolchain is not part of the MCP quick start and its outputs are not enabled by default.

## Historical implementation records

Files under `docs/superpowers/specs/` and `docs/superpowers/plans/` record designs and implementation plans from specific development stages. They are useful for provenance but are not authoritative product documentation. When a historical plan conflicts with the current README, MCP reference, architecture, or privacy document, the current product documentation controls.

## Current release facts

- Package and MCP server version: **0.4.0**
- Primary tool: `route_request`
- Primary interface: local MCP server
- Supported transports: stdio and stateful Streamable HTTP
- Current MCP revision: `2025-11-25`
- Compatible revisions: `2025-06-18`, `2025-03-26`
- Remote routing service: none
- Persisted routing content: none
- GitHub Actions required: no
