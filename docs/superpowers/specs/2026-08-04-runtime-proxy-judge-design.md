# Runtime Proxy and Judge Design

## Goal

Turn Switchboard's preflight and runtime cores into an optional transparent control plane. Existing MCP behavior remains advisory and local. The new proxy is a separate executable that can observe complete agent trajectories on OpenAI Responses and Anthropic Messages wires, apply runtime decisions, select a configured upstream, and expose privacy-safe session inspection. A pluggable judge may add escalation when deterministic policy has not already intervened.

## Boundaries

The proxy does not implement cross-wire conversion. Each request remains on its incoming wire, and every configured tier for that wire must target a compatible upstream. This avoids corrupting provider-specific tool and reasoning payloads. The proxy uses ordinary API credentials only. It does not import subscription OAuth credentials, imitate first-party clients, or depend on Bun or an external routing vendor.

## Request lifecycle

1. Accept `/v1/responses` or `/v1/messages` on a loopback-only server by default.
2. Recover a stable session identifier from `x-switchboard-session`, vendor session metadata, or a digest of the first task and client fingerprint.
3. Extract the current task and completed tool observations from the request history.
4. Run Switchboard preflight once when a session is created. The resulting tier is a hard runtime floor.
5. Feed only unseen tool observations into `RuntimeSession`.
6. Apply deterministic budget and failure policy.
7. When deterministic policy still says `continue` despite warning signals, optionally consult a judge.
8. Rewrite the alias to the selected upstream model, clean provider-specific narration when switching or restarting, and forward the request.
9. Stream the response without buffering when requested while metering a tee'd copy for usage and cost.
10. Return routing headers and retain only bounded digests, counters, signals, and decisions.

## Judge model

`RuntimeJudge` accepts a bounded snapshot, signal codes, and the deterministic decision. The default deterministic judge makes no additional intervention. An optional remote adapter sends no prompt, raw tool arguments, outputs, previews, or metadata; even the caller's session identifier is hashed. Network failures, timeouts, malformed verdicts, and non-2xx responses fail open.

Deterministic non-continue decisions are authoritative and bypass the judge. A judge may escalate only a deterministic `continue`, and its verdict is reconciled into session state exactly once. Budget stops are never delegated.

## Proxy safety

- Non-loopback binding requires bearer authentication.
- Upstream credentials may be referenced through environment variables.
- Client authorization headers are not forwarded upstream.
- Requests are size-bounded.
- Session stores have TTL and LRU limits.
- `/health` and session inspection expose no prompt or raw tool content.
- `stop_budget` returns HTTP 429 locally.
- `escalate_human` returns HTTP 409 unless `humanMode` is explicitly configured to continue.

## Packaging

The npm package publishes separate `./runtime`, `./judge`, and `./proxy` exports and a `switchboard-proxy` executable. The build includes all TypeScript source directories. The packed-package smoke test imports every public export and starts both the MCP binary and an ephemeral proxy instance, preventing missing-build artifacts from passing CI.
