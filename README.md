# Switchboard

Switchboard is a privacy-first local router for AI requests. It is available as an MCP server and as the existing Chromium extension foundation.

## MCP server

Build once, then point any local MCP client at the stdio entry point:

```bash
npm install
npm run build
node /absolute/path/to/switchboard/mcp/index.mjs --transport=stdio
```

The MCP server exposes:

- `route_request`, which returns an abstract `fast`, `balanced`, `deep`, or `max` tier
- Required capabilities such as web, files, vision, long context, and code
- Confidence, effort, task categories, scores, and concise routing reasons
- Optional concrete model ranking from a host-supplied model inventory
- Read-only routing-policy, capability, and server/privacy resources
- A reusable `route_before_answering` prompt with policy completion
- Stateful local stdio and Streamable HTTP transports
- Secure HTTP session IDs, protocol-version validation, expiry, deletion, and optional bearer authentication

It does not persist request content, model inventories, or tool results, and it does not call a remote routing service. See [MCP server documentation](docs/mcp.md).

## Existing extension foundation

The repository also contains the existing Manifest V3 foundation for ChatGPT and Claude, including deterministic routing, optional packaged local models, bounded file inspection, provider adapters, local preference learning, tests, and release tooling.

## Development

Requirements:

- Node.js 22 or newer
- npm

```bash
npm install
npm test
npm run build
npm run mcp:smoke
```

To fetch the optional extension model packs:

```bash
npm run models:fetch:core
npm run verify
```

## Privacy boundary

Switchboard has no account, analytics, advertising, or telemetry. Prompt text, context, extracted attachment text, model inventories, tool results, assistant responses, and browsing history are not persisted. MCP stdio writes only JSON-RPC messages to standard output and sends diagnostics to standard error.

## Documentation

- [MCP server](docs/mcp.md)
- [Architecture](docs/architecture/overview.md)
- [File inspection](docs/architecture/file-inspection.md)
- [Model roadmap](docs/architecture/model-roadmap.md)
- [Training toolchain](training/README.md)
- [Router benchmark](benchmarks/README.md)
- [Privacy and threat model](docs/privacy.md)
- [Research notes](docs/research.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT
