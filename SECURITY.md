# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/zgbrenner/switchboard/security/advisories/new),
not a public issue.

Please include:

1. **Vulnerability class** — e.g. input validation, path traversal, authentication bypass,
   denial of service, information disclosure.
2. **Affected component and version** — file paths and the version or commit you tested.
3. **Configuration** — transport (`stdio` or `http`), any flags or environment variables set,
   and your Node.js version.
4. **Reproduction steps** — exact requests, ideally a minimal script or a JSON-RPC transcript.
5. **Impact** — what an attacker gains, and what access they need to start.

We aim to acknowledge within 3 business days.

## Scope

Switchboard is a local, advisory MCP server with no runtime dependencies, no outbound network
requests, and no execution of user-supplied content.

**In scope:**

- JSON-RPC and tool-argument validation bypasses — anything accepted that the published input
  contract forbids, or rejected that it permits.
- HTTP transport controls: Host and Origin validation, bearer-token comparison, session issuance,
  expiry and deletion, active-session limits, non-loopback binding protection.
- Prompt, context, or file content reaching disk, logs, or another session — Switchboard's core
  guarantee is that it never persists request content.
- Preference-state handling: path traversal via `SWITCHBOARD_MCP_STATE_PATH`, corruption or
  truncation of the state file, unbounded growth, cross-process interference, file permissions.
- Resource exhaustion reachable from a single unauthenticated request.
- stdout contamination that corrupts the JSON-RPC stream.

**Out of scope:**

- The routing recommendation being wrong or suboptimal. Switchboard is advisory and the host decides
  what to invoke; poor routing is a quality bug, not a vulnerability. File it as an issue.
- Anything requiring an attacker to already control the machine, the host process, or the config.
- Denial of service that requires a valid bearer token on a deliberately exposed non-loopback bind.
- Vulnerabilities in Node.js itself — report those upstream.

## Security model

Switchboard binds to loopback and refuses to bind elsewhere without a bearer token. Host and Origin
validation are independent controls that remain active regardless. The threat model, including what
Switchboard deliberately does not defend against, is documented in
[docs/privacy.md](docs/privacy.md).

## Supported versions

Security fixes land on the latest minor release. Given the pre-1.0 version, older minors are not
backported.
