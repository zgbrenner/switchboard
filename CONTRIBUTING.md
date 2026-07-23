# Contributing

## Local checks

Every change must pass:

```bash
npm run verify
```

This runs strict TypeScript checking, Node tests, the extension build, manifest resource checks, permission checks, and a scan for remote executable URLs.

## Pull requests

Keep routing behavior, file extraction, and provider adapters in separate modules. Add a failing test before changing deterministic routing, file detection, ZIP safety, personalization, or model-pack validation.

Provider UI selectors must:

- Prefer accessible labels, roles, and stable test identifiers
- Include fallbacks rather than positional selectors
- Verify that a compatible option is visible
- Return a safe failure instead of blocking the send action

Do not add telemetry, remote code, broad host permissions, raw prompt persistence, or automatic model downloads from moving branches.
