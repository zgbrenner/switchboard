# Switchboard architecture

Switchboard is a local MCP server wrapping a shared routing engine.

The server has no runtime dependencies and requires no model download, network egress, or credentials.

## Shared routing contract

The router consumes a bounded request:

```text
prompt
recent context
file metadata and excerpts
routing policy
local category adjustments
```

It emits provider-independent metadata:

```text
quality tier: fast | balanced | deep | max
reasoning effort: low | medium | high | max
required capabilities
confidence and tier scores
task categories and concise reasons
```

Provider names and model names are not learned routing labels.

## MCP request flow

```text
MCP client or host
       |
       v
JSON-RPC and lifecycle validation
       |
       v
bounded route_request schema validation
       |
       v
shared Switchboard router
  1. detect capabilities
  2. apply hard floors
  3. extract deterministic task and complexity signals
  4. score abstract route prototypes
  5. apply local policy and category adjustments
  6. calibrate tier, effort, confidence, and reasons
       |
       v
optional model inventory resolver
  1. exclude unavailable models
  2. exclude confirmed capability mismatches
  3. rank tier and effort adequacy
  4. penalize unknown capabilities
  5. apply quality, cost, latency, and continuity policy
       |
       v
structured MCP tool result
       |
       v
host decides whether and how to apply it
```

The MCP server never invokes a provider model and cannot force a host to switch models.

## Stdio boundary

The stdio process owns one stateful MCP session:

- Standard input receives newline-delimited JSON-RPC.
- Standard output contains only newline-delimited JSON-RPC responses.
- Diagnostics go to standard error.
- The session moves through `new`, `initializing`, and `ready` lifecycle phases.
- `initialize` and `notifications/initialized` are required before ordinary operations.

No routing content is written to disk.

## Streamable HTTP boundary

The HTTP server binds to `127.0.0.1` by default and maintains bounded in-memory MCP sessions.

Each session stores only:

- Cryptographically random session ID
- Negotiated MCP protocol revision
- MCP lifecycle state
- Last-activity time

The transport validates:

- Host
- Origin
- Bearer token when configured
- Content type
- Required `Accept` media types
- Request body size
- Session ID
- Negotiated protocol revision
- Session expiry and active-session limit

Non-loopback binding is refused unless bearer authentication is configured. Sessions can be terminated with `DELETE` and expire automatically after inactivity.

## Host model inventory resolver

`route_request` can operate without a model inventory. In that case it returns only abstract routing metadata and `modelResolution.status` is `not-provided`.

When a host supplies `availableModels`, each entry can contain:

- Stable ID and optional title/family
- Abstract quality tier
- Supported effort levels
- Capability support
- Relative cost and latency
- Availability

Confirmed capability incompatibility is a hard exclusion. Unknown support receives a penalty rather than an automatic exclusion. Models below the required tier receive a much larger penalty than conservative over-routing. An adequate current model can receive a continuity preference when context is present.

## Optional neural routing

The current MCP server does not require packaged local models. The shared router remains useful through deterministic and lightweight semantic scoring.

The repository contains optional model-pack and training work for Scout, Arbiter, and Judge stages. A neural pack should become a default only after it improves the locked routing benchmark without worsening harmful under-routing, calibration, latency, memory, privacy, or supply-chain guarantees.

## Safety properties

- Required capabilities are evaluated before cost or latency preferences.
- High-stakes and complex requests cannot be downgraded solely because the user asks for speed.
- Host model inventories are bounded and strictly validated.
- Unknown capability support is visible in the result.
- Model recommendations are deterministic for equal inputs and inventories.
- MCP routing remains advisory to the host.
- Stdio protocol output is isolated from diagnostics.
- HTTP sessions are bounded, expiring, authenticated when exposed, and explicitly deletable.
- Prompt, context, file excerpts, model inventories, and route decisions are not persisted.
- Extension adapter failure does not block the original prompt.
