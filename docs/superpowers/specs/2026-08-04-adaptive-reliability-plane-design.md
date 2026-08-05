# Adaptive Reliability Plane Design

## Goal

Turn the optional Switchboard proxy into a health-aware, capability-aware, self-protecting routing plane while keeping the normal setup small: users choose a routing profile, list one or more upstreams per tier, and keep using the `switchboard` model alias.

## Research basis

The design combines patterns that have proved useful in production gateways and distributed systems:

- OpenRouter filters providers by request parameters and routes around recent outages before applying price or throughput preferences.
- LiteLLM, Portkey, and Bifrost separate provider retries from cross-provider fallbacks and expose budgets, timeouts, load balancing, and cooldowns.
- Envoy uses passive outlier detection, circuit breakers, retry budgets, and retry-aware cluster selection.
- Amazon's Builders' Library recommends one retry layer, capped exponential backoff with jitter, idempotency awareness, and a token bucket to prevent retries from amplifying an outage.
- OpenTelemetry's GenAI conventions define low-cardinality model, provider, operation, duration, token, and error fields while warning that prompt and response content may be sensitive.

Switchboard will adopt the mechanisms, not copy another gateway's architecture or dependencies.

## User surface

Existing single-route configuration remains valid. A tier may additionally contain an array of upstreams:

```json
{
  "routing": { "profile": "reliability" },
  "routes": {
    "responses": {
      "balanced": [
        { "id": "openai-primary", "baseUrl": "https://api.openai.com/v1", "model": "gpt-model", "apiKeyEnv": "OPENAI_API_KEY" },
        { "id": "backup", "baseUrl": "https://backup.example/v1", "model": "compatible-model", "apiKeyEnv": "BACKUP_KEY" }
      ]
    }
  }
}
```

The profiles are `balanced`, `reliability`, `latency`, and `cost`. They alter internal scoring weights, not safety floors. Advanced reliability settings remain optional.

## Components

### Request requirements

`src/proxy/requirements.ts` extracts only structured requirements from the request: tool use, vision input, JSON output, reasoning controls, estimated input size, requested output tokens, and any configured zero-data-retention requirement. It never stores prompt text.

Each upstream can declare capabilities. Explicit incompatibility removes an upstream before scoring. Unknown capability metadata stays eligible unless strict capability matching is enabled, preserving backward compatibility.

### Endpoint catalog and health registry

Every normalized upstream receives a stable ID. `src/proxy/health.ts` maintains bounded in-memory state per endpoint:

- exponentially weighted latency and error estimates;
- total, successful, failed, and rate-limited attempts;
- in-flight requests;
- consecutive failures;
- closed, open, and half-open circuit state;
- rate-limit cooldown from `Retry-After`;
- last success, failure, and selection time.

Three consecutive retryable failures open a circuit by default. When the cooldown expires, one half-open probe is allowed. A success closes the circuit; a failure reopens it. Non-retryable client errors do not poison endpoint health.

### Adaptive selection

Selection first applies wire, tier, capability, privacy, and context constraints. It then scores eligible endpoints using profile-specific weights over health, latency, cost, configured weight, and current load. Session-derived deterministic jitter prevents every process from picking the same endpoint while keeping routing explainable and stable.

If all endpoints are unhealthy, the oldest eligible half-open endpoint is probed. If no endpoint satisfies hard requirements, the proxy fails locally with a structured error instead of silently dropping request parameters.

### Retry and fallback coordinator

`src/proxy/reliability.ts` owns the only retry loop. The first attempt is free; every retry consumes a token from a local retry bucket. It retries connection failures and HTTP 408, 409, 429, and 5xx responses, matching the official OpenAI SDK retry classes. It uses capped exponential backoff with full jitter and honors a bounded `Retry-After` value.

Each retry reselects from healthy compatible endpoints, preferring an endpoint not already attempted. Non-streaming and streaming requests may retry only before a response body is forwarded. Once streaming begins, Switchboard never attempts to splice a second provider into the stream.

### Telemetry

`src/proxy/telemetry.ts` exposes a zero-dependency event sink and a bounded in-memory summary. Events use OpenTelemetry-compatible GenAI and HTTP attribute names where practical. Prompt text, response content, tool arguments, tool outputs, API keys, and raw session IDs are excluded.

The authenticated status endpoint returns aggregate route health and recent attempt metadata. The existing session inspection endpoint remains digest-only.

## Data flow

1. The controller performs preflight routing and establishes the minimum safe tier.
2. Structured request requirements are extracted.
3. The endpoint pool for the active tier is filtered and scored.
4. The reliability coordinator performs the request with a single bounded retry/fallback loop.
5. Attempt latency, status, rate-limit cooldown, cost, and usage update health and runtime session state.
6. Privacy-safe telemetry is emitted and routing headers identify the actual selected endpoint and attempt count.

## Failure behavior

- Invalid configuration fails at startup with the exact path of the invalid field.
- No compatible endpoint returns a local 422 error.
- Exhausted retry budget returns the last real upstream response or the original network error.
- A telemetry sink failure is isolated and never fails a model request.
- Health state is in-memory, bounded, and expires with the process; no database is introduced.
- Cross-wire provider translation remains out of scope. Responses requests only use Responses-compatible upstreams; Messages requests only use Messages-compatible upstreams.

## Testing

Tests cover backward-compatible configuration, arrays of endpoints, stable IDs, capability filtering, profile scoring, session-stable selection, circuit opening and half-open recovery, rate-limit cooldowns, retry classification, jitter bounds, retry token exhaustion, timeout cancellation, streaming non-splicing, telemetry redaction, status output, and packed-package imports. The full repository gate must pass on Node 22 and 24 across Ubuntu, macOS, and Windows with zero high-severity dependency advisories and CodeQL clean.
