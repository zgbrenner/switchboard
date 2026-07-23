# Switchboard

Switchboard is a privacy-first browser extension that locally analyzes a draft prompt and selects the most appropriate visible ChatGPT or Claude model before the prompt is sent.

## Current status

The repository contains a working Manifest V3 foundation with:

- Local deterministic routing across `fast`, `balanced`, `deep`, and `max` tiers
- Hard capability floors for files, vision, long context, code, and web research
- Two packaged local routing stages: a MiniLM sentence-embedding Scout and a MiniLM cross-encoder Arbiter
- An optional lazy SmolLM2-135M Judge for ambiguous decisions
- Automatic deterministic fallback when model assets are absent, disabled, or fail to initialize
- Local attachment inspection for text, Markdown, HTML, JSON, CSV, PDF, DOCX, PPTX, XLSX, ZIP, and common images
- File-type verification using extension, declared MIME type, and magic bytes
- ZIP central-directory checks that reject path traversal, excessive expansion, extreme compression ratios, unsupported compression, and oversized archives before extraction
- Isolated file conversion with a hard timeout and metadata-only fallback
- ChatGPT and Claude site adapters that discover the composer, intercept send, inspect locally, select a visible model, verify the current control, and fail safely when the UI changes
- Local-only preference learning from manual overrides without retaining prompt text
- Popup and options interfaces with data deletion and conservative existing-conversation behavior
- Model-pack contracts that require immutable source revisions and SHA-256 hashes
- A strict router benchmark and reproducible Scout and Arbiter training and ONNX export toolchain
- Reproducible extension ZIP packaging with a SHA-256 checksum

The bootstrap model configuration provides immediate semantic routing after its model assets are fetched during development. The training toolchain remains the path to replacing those general-purpose models with smaller task-specific Ettin checkpoints after the new checkpoints outperform the deterministic and bootstrap baselines.

## Build

Requirements:

- Node.js 22 or newer
- npm

Install dependencies and the two core local model packs:

```bash
npm install
npm run models:fetch:core
npm run verify
```

The core model pack is downloaded only during development from immutable Hugging Face revisions, hashed locally, and copied into the extension. At runtime, remote model loading is disabled.

To include the optional 135M Judge as well:

```bash
npm run models:fetch:all
npm run verify
```

A build without model packs is also valid. Switchboard will retain deterministic and semantic-prototype routing:

```bash
npm install
npm run verify
```

The unpacked extension is written to `dist/`. Create a reproducible install archive and SHA-256 file with:

```bash
npm run package
```

Release artifacts are written to `release/`.

## Install locally

1. Run the build commands above.
2. Open `chrome://extensions` in Chrome or another Chromium browser.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the repository's `dist` directory.
6. Open ChatGPT or Claude and send a prompt.

Switchboard displays its route and explanation near the lower-right corner. Existing-conversation protection is enabled by default, so it recommends without changing models after a conversation already has history. This can be changed in the extension settings.

## Privacy boundary

Switchboard has no backend, account, analytics, advertising, or telemetry. The extension requests only:

- `storage`, for local settings and derived category preferences
- Host access to `chatgpt.com` and `claude.ai`, where routing occurs

Prompt text, extracted attachment text, assistant responses, and browsing history are not persisted. Model inference uses packaged extension assets, remote model loading is disabled, and model packs must use immutable revisions with verified asset hashes. See [docs/privacy.md](docs/privacy.md).

## Architecture

```text
Draft prompt + recent local context + captured attachments
                         |
                         v
          isolated bounded file inspection
                         |
                         v
     hard capabilities + deterministic signals
                         |
                         v
        Scout embeddings + Arbiter ranking
                         |
                         v
        optional Judge on ambiguous routes
                         |
                         v
        abstract tier and capability decision
                         |
                         v
     ChatGPT or Claude visible model adapter
```

Detailed documents:

- [Architecture](docs/architecture/overview.md)
- [File inspection](docs/architecture/file-inspection.md)
- [Model roadmap](docs/architecture/model-roadmap.md)
- [Training toolchain](training/README.md)
- [Router benchmark](benchmarks/README.md)
- [Privacy and threat model](docs/privacy.md)
- [Research notes](docs/research.md)
- [Contributing](CONTRIBUTING.md)

## Development principles

- Local and private by construction
- Capability compatibility before model quality scoring
- Conservative under uncertainty
- Provider model names are adapter data, never learned routing labels
- Automatic actions must be visible and reversible
- UI automation must fail open without blocking the user's prompt
- No remote executable code

## License

MIT
