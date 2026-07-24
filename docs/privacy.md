# Privacy and threat model

Switchboard is designed to make routing decisions locally without creating a second copy of the user's AI activity.

This document covers both current interfaces:

1. The MCP server, which is the primary product surface.
2. The retained Chromium extension foundation.

## MCP data processed

A `route_request` call may temporarily contain:

- The current prompt
- Up to eight recent conversation turns
- Bounded file metadata and excerpts supplied by the host
- Routing policy and bounded category adjustments
- An optional host model inventory
- The current model ID, when supplied for continuity-aware ranking

The MCP server processes this data in memory for one routing decision.

It does not persist:

- Prompt text
- Conversation context
- File excerpts
- Model inventories
- Current model IDs
- Route decisions
- Tool results
- Embeddings
- Browsing history

The MCP server does not open arbitrary file paths, read the user's filesystem through `route_request`, call a provider model, or contact a remote routing service.

## MCP stdio boundary

For stdio:

- Standard input receives MCP JSON-RPC messages.
- Standard output is reserved for JSON-RPC responses.
- Diagnostics are written to standard error.
- Routing content is not logged by the MCP implementation.
- The process retains only in-memory lifecycle state while running.

The launching MCP client controls the process environment and can observe any data it sends to the server. Switchboard cannot protect data from the host that intentionally supplies it.

## MCP HTTP boundary

Stateful Streamable HTTP sessions retain only:

- Random session ID
- Negotiated protocol revision
- Lifecycle state
- Last-activity timestamp

They do not retain routing content.

Default controls:

- Bind to `127.0.0.1`
- Validate Host and Origin headers
- Require POST `Accept` to advertise `application/json` and `text/event-stream`
- Limit request bodies to 1 MiB
- Require the negotiated protocol revision after initialization
- Expire idle sessions after 30 minutes
- Limit active sessions to 256
- Support explicit deletion with `DELETE`

Optional bearer authentication uses timing-safe token comparison. Switchboard refuses non-loopback binding unless bearer authentication is configured.

Bearer authentication is not a substitute for network segmentation, TLS termination, Host allowlisting, or Origin allowlisting when the server is intentionally exposed beyond the local machine.

## Browser-extension data processed

The retained extension foundation may temporarily process:

- The current unsent draft
- Bounded recent conversation turns
- User-selected attachment bytes and bounded extracted text
- Visible model-picker labels

This processing occurs in extension-owned browser contexts. Temporary prompt and file content is released after routing and is not written to extension storage.

## Browser-extension data persisted

The extension foundation stores only:

- Extension settings
- Bounded numeric category adjustments derived from overrides
- Aggregate counters and adapter-health metadata where implemented
- Local model-pack metadata and integrity information where installed

It must not persist prompt text, file excerpts, assistant responses, page content, URL paths, or browsing history.

## Browser-extension permissions

The extension foundation is intentionally limited to:

- `storage`
- Extension-owned offscreen processing where configured
- `https://chatgpt.com/*`
- `https://claude.ai/*`

It should not request tabs, history, cookies, identity, downloads, clipboard, native messaging, or broad web access unless a future feature has a documented and separately reviewed requirement.

MCP stdio itself requires no browser host permissions. MCP HTTP opens only the configured local listening socket.

## Threats and controls

| Threat | Control |
|---|---|
| Prompt or context leakage through a routing backend | No routing backend or remote inference |
| Accidental MCP logging | Stdio protocol/diagnostic separation and no content logging in server code |
| Malformed or oversized MCP input | Strict object schemas, bounded strings/arrays, unknown-property rejection, and 1 MiB transport limit |
| Untrusted model metadata | Bounded host inventory, strict types, duplicate rejection, capability-aware ranking, and advisory output |
| DNS rebinding or Host confusion | Explicit Host validation |
| Cross-origin browser request | Origin validation and explicit allowlist |
| Unauthorized HTTP use | Optional bearer authentication; mandatory for non-loopback binding |
| Stolen or abandoned session | Random IDs, protocol binding, inactivity expiry, bounded sessions, and explicit deletion |
| Timing leakage during token comparison | Equal-length timing-safe comparison |
| Malicious archive in extension path | Central-directory bounds, ratio limits, path checks, entry limits, and metadata-only fallback |
| Misleading extension or MIME type | Extension, declared MIME, magic-byte, and package-structure checks |
| Supply-chain model replacement | Immutable revisions, exact byte lengths, and per-asset SHA-256 verification |
| Provider interface change | Visible post-selection verification and safe fallback without blocking send |
| Silent browser model change | Visible extension status and manual control |
| Excessive persisted context | Derived bounded metadata only and erase-all controls |
| Remote-code policy violation | Executable assets packaged and reviewed; remote model loading disabled |

## Trust boundaries and limitations

- An MCP host can retain or transmit any information it sends to Switchboard; that behavior is outside the server's control.
- A host can ignore or misapply the returned recommendation.
- Inaccurate host-supplied model capabilities can produce an inaccurate model ranking.
- Bearer tokens protect access but do not encrypt HTTP traffic. Use a trusted local connection or appropriate TLS termination when traffic leaves loopback.
- The retained extension executes on third-party sites whose interface and scripts can change.
- Privacy guarantees apply to Switchboard's implementation, not to the AI provider or MCP client that receives the original request.

## Data deletion

The MCP server has no routing-content database to clear. Terminating the process or deleting an HTTP session removes its in-memory protocol state.

The extension foundation includes local data-deletion controls for its settings, derived preferences, counters, and adapter metadata.
