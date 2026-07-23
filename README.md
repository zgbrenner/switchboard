# Switchboard

Switchboard is a privacy-first browser extension that locally analyzes a draft prompt and selects the most appropriate visible ChatGPT or Claude model before the prompt is sent.

## Current status

The repository contains a complete dependency-light Manifest V3 foundation:

- Local deterministic and semantic-prototype routing across `fast`, `balanced`, `deep`, and `max` tiers
- Hard capability floors for files, vision, long context, code, and web research
- Local attachment inspection for text, Markdown, HTML, JSON, CSV, PDF, DOCX, PPTX, XLSX, ZIP, and common images
- File-type verification using extension, declared MIME type, and magic bytes
- ZIP central-directory checks that reject path traversal, excessive expansion, extreme compression ratios, unsupported compression, and oversized archives before extraction
- ChatGPT and Claude site adapters that discover the composer, intercept send, inspect locally, select a visible model, and fail safely when the UI changes
- Local-only preference learning from manual overrides without retaining prompt text
- Popup and options interfaces with data deletion and conservative existing-conversation behavior
- Model-pack contracts that require immutable source revisions and SHA-256 hashes
- A 32-case strict router benchmark and reproducible Scout/Arbiter training and ONNX export toolchain

The first release uses the deterministic and semantic-prototype router by default. The neural Scout, Arbiter, and Judge stages are defined as local model packs and will be added after their task-specific checkpoints are trained, converted, benchmarked, and packaged.

## Build

Requirements:

- Node.js 22 or newer
- TypeScript 5.8 or newer, installed by `npm install`

```bash
npm install
npm run verify
```

The unpacked extension is written to `dist/`. A reproducible install archive and SHA-256 file can be created with:

```bash
npm run package
```

Release artifacts are written to `release/`.

## Install locally

1. Run `npm install` and `npm run build`.
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

Prompt text, extracted attachment text, assistant responses, and browsing history are not persisted. Model packs must be shipped with immutable revisions and verified asset hashes. See [docs/privacy.md](docs/privacy.md).

## Architecture

```text
Draft prompt + recent local context + captured attachments
                         |
                         v
             bounded file inspection
                         |
                         v
     hard capabilities + deterministic signals
                         |
                         v
          semantic prototype scoring (current)
                         |
                         v
      Scout -> Arbiter -> optional Judge (planned packs)
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
