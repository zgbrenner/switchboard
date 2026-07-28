# Switchboard documentation

Switchboard is a local MCP server that recommends a quality tier, reasoning effort, required
capabilities, an execution plan, a budget verdict, and a concrete model for an AI request — before
the request runs.

Start with the [README](../README.md) for installation and a working example.

## Reference

- **[MCP reference](mcp.md)** — every tool, resource and prompt, with full input and output
  contracts, error codes, and transport details.
- **[Architecture overview](architecture/overview.md)** — how a request becomes a routing decision:
  signal extraction, the tier ladder, floors, and policy.

## Evaluation

- **[Routing evaluation](../benchmarks/README.md)** — how routing quality is measured, what the
  measured numbers actually are, and what they do not show. Read this before trusting any quality
  claim, including ours.

## Privacy and learning

- **[Privacy and threat model](privacy.md)** — what Switchboard stores, what it refuses to accept,
  and the boundary it is designed to hold.
- **[Aggregate learning](mcp-learning.md)** — how category-level preference feedback works, what it
  can and cannot influence, and how to disable or delete it.

## Background

- **[Research notes](research.md)** — the specifications and prior work Switchboard draws on.

## Project

- **[Changelog](../CHANGELOG.md)**
- **[Contributing](../CONTRIBUTING.md)**
- **[Security policy](../SECURITY.md)**

## Release facts

| | |
|---|---|
| Version | 0.6.0 |
| API contract | `2026-07-24` |
| MCP revisions | `2025-11-25` (current), `2025-06-18`, `2025-03-26` |
| Tools | 9 |
| Transports | stdio, stateful Streamable HTTP |
| Runtime dependencies | none |
| Remote routing service | none |
| Node.js | 22+ |
