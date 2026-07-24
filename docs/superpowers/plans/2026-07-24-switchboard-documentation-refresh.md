# Switchboard 0.4 Documentation Refresh Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to execute this plan. Steps use checkbox syntax for status tracking.

**Goal:** Align all user-facing Switchboard documentation with the merged MCP 0.4.0 implementation.

**Architecture:** Use an MCP-first documentation hierarchy. Keep the shared router central, describe the extension as a secondary interface, and scope file inspection and neural training accurately.

**Tech Stack:** Markdown, Node.js 22 commands, MCP 2025-11-25 with compatibility for 2025-06-18 and 2025-03-26.

## Global constraints

- Documentation-only changes.
- No GitHub Actions.
- Do not claim that MCP can force a host to switch models.
- Do not claim trained task-specific models are shipped when they are not.
- Preserve privacy claims supported by the implementation.
- Keep commands synchronized with `package.json`.

---

### Task 1: Product overview and documentation index

**Files:** `README.md`, `docs/README.md`

- [ ] Rewrite the root README around MCP 0.4.0.
- [ ] Add quick starts for stdio and stateful Streamable HTTP.
- [ ] Explain optional model inventory resolution and the advisory-host limitation.
- [ ] Add a documentation index with current, secondary, roadmap, and historical sections.

### Task 2: Authoritative MCP reference

**Files:** `docs/mcp.md`

- [ ] Add an explicit 0.4.0 status block.
- [ ] Add the stateful HTTP request sequence and required headers.
- [ ] Add security guidance for bearer tokens and non-loopback binding.
- [ ] Clarify model inventory ranking, unknown capabilities, lifecycle, resources, completion, and limitations.

### Task 3: Architecture and privacy

**Files:** `docs/architecture/overview.md`, `docs/privacy.md`

- [ ] Rewrite architecture around the shared router and MCP-first data flow.
- [ ] Separate stdio, HTTP, and browser-extension runtime boundaries.
- [ ] Document stateful HTTP metadata, in-memory routing data, and non-persistence guarantees.
- [ ] Separate MCP network controls from browser-extension permissions.

### Task 4: Secondary subsystems and roadmap

**Files:** `docs/architecture/file-inspection.md`, `docs/architecture/model-roadmap.md`, `training/README.md`, `benchmarks/README.md`, `docs/research.md`

- [ ] Clarify that MCP accepts bounded file metadata/excerpts but does not open arbitrary local files.
- [ ] Scope browser file inspection to the extension foundation.
- [ ] Scope local neural models and training as optional roadmap work.
- [ ] Explain that benchmarks test the shared router and MCP protocol tests cover the server surface.
- [ ] Add MCP specification and secure transport design to research notes.

### Task 5: Contribution guidance and verification

**Files:** `CONTRIBUTING.md`

- [ ] Add MCP lifecycle, schema, model-resolution, and HTTP security contribution rules.
- [ ] Document focused verification commands and the complete local gate.
- [ ] Require documentation updates for public MCP behavior changes.
- [ ] Review the branch diff to confirm documentation-only scope and fast-forward merge to `main`.