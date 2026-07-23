# Switchboard Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally testable Manifest V3 extension that routes ChatGPT and Claude prompts using bounded deterministic, semantic, file, and preference signals.

**Architecture:** Keep routing, file conversion, provider UI automation, local persistence, and model-pack validation isolated behind typed interfaces. The browser-native baseline operates without model assets, while future neural stages plug into the defined model runtime contract.

**Tech Stack:** TypeScript 5.8, ES2022 browser modules, Manifest V3, Node 22 test runner, Chrome storage, Web Streams.

## Global Constraints

- No backend, analytics, telemetry, or remote executable code.
- Persist only settings and derived numeric category preferences.
- Host permissions are limited to ChatGPT and Claude.
- File parsing is bounded before archive expansion.
- Provider-adapter failure may not block prompt submission.

---

### Task 1: Routing core
- [x] Define abstract tiers, capabilities, decisions, and reasons.
- [x] Add deterministic signal extraction and semantic route prototypes.
- [x] Enforce file, vision, and long-context floors.
- [x] Add bounded local preference learning and tests.

### Task 2: File inspection
- [x] Detect file types through extensions, MIME, and magic bytes.
- [x] Add bounded extraction for text, HTML, JSON, PDF, DOCX, PPTX, XLSX, ZIP, and images.
- [x] Reject ZIP bombs and unsafe paths before extraction.
- [x] Add tests for mismatch detection, limits, and central-directory safety.

### Task 3: Browser extension
- [x] Add service worker, content loader, popup, and options page.
- [x] Capture attachments and recent context locally.
- [x] Add accessible ChatGPT and Claude provider adapters.
- [x] Add visible recommendation, automatic switching, manual override, and safe fallback behavior.

### Task 4: Model-pack boundary
- [x] Define Scout, Arbiter, and Judge runtime interfaces.
- [x] Validate immutable source revisions and asset SHA-256 digests.
- [x] Document the benchmark and release gate.

### Task 5: Verification and documentation
- [x] Run strict TypeScript checking and Node tests.
- [x] Build an unpacked extension.
- [x] Verify manifest resources, least-privilege permissions, and absence of remote executable URLs.
- [x] Document installation, privacy, architecture, and remaining neural-model work.
