# Switchboard Request Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four independently toggleable preflight stages to Switchboard: model routing, local prompt compression, reply-brevity steering, and file-to-Markdown conversion, plus reproducible release bundles and CI/CD.

**Architecture:** Preserve `route_request` and add a new `prepare_request` orchestration tool. The pipeline analyzes the original prompt first, converts local files before compression, compresses only eligible text through a local sidecar with deterministic fallback, then appends a byte-stable brevity instruction at the end. Heavy assets stay optional at npm install time and are bundled into platform release archives.

**Tech Stack:** Node.js 22 ESM, MCP JSON-RPC, Kompress-Small ONNX, a Go document-conversion sidecar, GitHub Actions, npm provenance, CycloneDX SBOMs, SHA-256 checksums.

## Global Constraints

- Every stage has an independent boolean toggle.
- Routing always sees the original uncompressed prompt.
- System and safety instructions are never compressed.
- Compression bypasses short inputs and falls back losslessly when the sidecar is unavailable.
- File conversion runs locally and never follows remote URLs.
- Reply brevity is appended at the tail and is idempotent.
- The base npm package remains usable without downloading model assets.
- Release bundles include the platform sidecar, model manifest, checksums, notices, and smoke tests.

---

### Task 1: Define pipeline contracts and failing tests

**Files:**
- Create: `test/pipeline.test.mjs`
- Create: `mcp/pipeline/contracts.mjs`
- Modify: `mcp/server/tools.mjs`
- Modify: `mcp/server/metadata.mjs`

**Interfaces:**
- Produces: `PREPARE_INPUT_SCHEMA`, `PREPARE_OUTPUT_SCHEMA`, `normalizePrepareArguments(value)`.

- [ ] Add tests proving independent toggles, original-prompt routing, idempotent brevity, and lossless fallback.
- [ ] Run `npm test` and confirm the new tests fail because `prepare_request` is missing.

### Task 2: Implement deterministic pipeline orchestration

**Files:**
- Create: `mcp/pipeline/prepare.mjs`
- Create: `mcp/pipeline/brevity.mjs`
- Create: `mcp/pipeline/chunking.mjs`
- Create: `mcp/pipeline/content.mjs`
- Modify: `mcp/server/tools.mjs`

**Interfaces:**
- Produces: `prepareRequest(args, dependencies)` returning route, prepared prompt, converted files, stage reports, warnings, and reversible receipts.

- [ ] Implement routing-first ordering.
- [ ] Implement paragraph-aware chunking with overlap and stable reconstruction.
- [ ] Implement byte-stable, idempotent brevity steering.
- [ ] Implement bypass and lossless fallback rules.
- [ ] Run `npm test` and confirm pipeline tests pass.

### Task 3: Add local compressor sidecar integration

**Files:**
- Create: `mcp/pipeline/sidecar.mjs`
- Create: `sidecar/compressor.py`
- Create: `sidecar/requirements.lock`
- Create: `models/kompress-small/model-manifest.json`
- Create: `scripts/fetch-model.mjs`

**Interfaces:**
- Consumes: chunks from `chunkText()`.
- Produces: `{ text, originalTokens, compressedTokens, model, transforms, receipt }`.

- [ ] Use Kompress-Small ONNX keep/drop scores with conservative thresholds and protected spans.
- [ ] Cache the loaded model per sidecar process.
- [ ] Return original text on timeout, malformed output, missing model, unsupported language, or negligible savings.
- [ ] Add fixture-driven sidecar protocol tests.

### Task 4: Add file-to-Markdown conversion

**Files:**
- Create: `sidecar/markitdown/main.go`
- Create: `sidecar/markitdown/go.mod`
- Create: `mcp/pipeline/files.mjs`
- Create: `test/file-conversion.test.mjs`

**Interfaces:**
- Produces: `{ name, mediaType, markdown, characters, warnings }`.

- [ ] Support PDF, DOCX, PPTX, XLSX/XLS, HTML, CSV, EPUB, IPYNB, JSON, Markdown, text, and ZIP.
- [ ] Reject URLs, path traversal, oversized archives, and unsupported file types.
- [ ] Preserve file headings and append converted Markdown before compression.
- [ ] Add golden tests for plain text, CSV, HTML, and failure cases.

### Task 5: Add CLI/library surfaces and documentation

**Files:**
- Create: `mcp/pipeline/index.mjs`
- Modify: `mcp/server.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Exports: `prepareRequest`, `createPipelineDependencies`, and pipeline configuration helpers.

- [ ] Document MCP usage, toggles, privacy, model footprint, file support, fallback behavior, and release bundles.
- [ ] Keep `route_request` backward compatible.

### Task 6: Add CI/CD and release bundles

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Create: `.github/dependabot.yml`
- Create: `scripts/package-release.mjs`
- Create: `scripts/release-smoke.mjs`
- Create: `scripts/generate-sbom.mjs`

**Interfaces:**
- Produces: npm tarball and `switchboard-full-<version>-<platform>-<arch>.zip` artifacts.

- [ ] Run typecheck, lint, formatting, unit, protocol, package-install, and sidecar tests across supported operating systems.
- [ ] Build sidecars for Windows x64, macOS arm64/x64, Linux x64/arm64.
- [ ] Generate SBOMs, provenance, checksums, and release notes.
- [ ] Publish npm and GitHub Release assets only from version tags after all matrix jobs succeed.
- [ ] Run a clean-machine smoke test against every release archive.

### Task 7: Verify and merge

- [ ] Run `npm run verify`.
- [ ] Pack and install the npm tarball into an empty project.
- [ ] Run MCP Inspector smoke tests.
- [ ] Run release bundle smoke tests.
- [ ] Review the PR diff and CI logs.
- [ ] Merge only after required checks are green.
