# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] — 2026-07-28

A correctness and credibility release. Several controls the 0.5 documentation described did not
work, and the routing quality claims could not be checked. Both are addressed here.

### Fixed — routing

- **`policy` was a no-op.** `best`, `balanced`, `fast` and `conserve` returned an identical tier for
  every prompt tested: the policy bias fed a softmax blend whose deterministic-affinity term
  dominated every bias value. Policy now shifts the routing score before thresholding. Floors are
  applied afterwards, so no policy can route beneath a safety floor.
- **`confidence` was structurally floored.** An empty prompt reported `0.925`. It is now a
  saturating curve over the total weight of the signals that actually fired: no evidence yields
  `0.25`, strong evidence approaches `0.97`. It is an evidence score, not a calibrated probability.
- **Non-Latin prompts were unroutable.** Every CJK, Cyrillic, Arabic, Hangul and Devanagari prompt
  fell through to `fast`. Script detection now holds a `balanced` floor, sets `shouldUseJudge`, and
  lowers confidence instead of guessing.
- **An attachment could lower a floor** the prompt had already established, because the floor was
  assigned rather than raised. It also charged a flat score premium regardless of size, so a
  100-byte note pushed an already-`deep` request to `max`. Both fixed.
- **`"what is the weather today"` routed to `deep`**: bare recency words sat in the research pattern
  at weight 3.4. Recency is now a separate signal that sets the `web` capability at weight 0.5.
- The tier decision no longer comes from the argmax of a distribution that always agreed with the
  deterministic ladder. The ladder decides; the distribution is reported for margin and explanation.
- Signal coverage: the transformation pattern now spans an intervening noun ("make this *sentence*
  friendlier"), and instruction counting recognises comma-separated clauses, so a multi-part task
  that opens with "summarize" is no longer scored as a simple transformation.

### Fixed — protocol

- **`id: null` on every protocol-level error.** The MCP schema types `RequestId` as `string | number`
  and marks the field optional, so `null` is invalid. The official SDK discards such a response and
  the caller hangs until its own timeout. The id is now echoed when readable and omitted when not.
- **Unknown tool names returned `isError: true`.** A name that never reached a handler is a protocol
  error; it now answers `-32602`.
- **Every escaped exception reported `-32602 Invalid params`**, blaming the caller for server
  faults. Argument validation now throws a distinct `ValidationError`, so caller mistakes answer
  `-32602` and internal faults answer `-32603`.
- **`resources/read` reused `-32002`** for an unknown URI, the same code this server uses for
  "not initialized". Unknown URIs now answer `-32602`.

### Fixed — model resolution

- `modelResolution.status` reported `recommended` for a candidate whose own `meetsRequirements` was
  `false`. A new `best-effort` status names the shortfall while still returning the closest
  candidate. **This adds a value to the `status` enum**; consumers matching on it exhaustively
  should handle `best-effort`.

### Added

- **Outcome-based routing evaluation.** `npm run eval:fetch` builds a dense
  `(prompt × model) → (correct?, cost)` matrix from Stanford HELM's public results joined to
  LiteLLM's price table — no API key, no model calls. `npm run benchmark:oracle` scores the router
  against it with oracle, always-fast, always-max, best-single-model and random-at-matched-cost
  baselines, plus bootstrap confidence intervals and a permutation test.
- `test/router-properties.test.mjs`: determinism, policy monotonicity, floor inviolability, cosmetic
  invariance, keyword-flip stability, and confidence honesty. Five of these fail against 0.5.
- `test/mcp-protocol-errors.test.mjs` covering the JSON-RPC semantics above.
- CI across Node 22/24 on Ubuntu and Windows, including a test that installs the packed tarball into
  a clean project and drives the binary over stdio.
- Biome for linting and formatting, configured to fail the build on any stdout write under `mcp/`
  or `src/`.

### Changed

- **The package is publishable.** `private: true` is removed and a `bin` is now reachable via
  `npx switchboard-mcp`. Adds `files`, `exports`, `license`, `repository`, `homepage`, `bugs`,
  `keywords`, `author`, `mcpName`, and `prepack`/`prepublishOnly` hooks so the compiled router is
  present in the tarball — without which an installed package could not start at all.
- README rewritten: per-client install blocks (Claude Code, Claude Desktop, VS Code, Cursor) with
  Windows variants, a full `route_request` parameter table, a real response payload, a
  troubleshooting table, a complete configuration table including three previously undocumented
  environment variables, and an honest limitations section.
- `benchmarks/README.md` now leads with the measured result rather than the corpus description.

### Removed

- **The legacy browser-extension surface** (`src/extension`, `src/files`, `src/models`, `styles`,
  `extension`, `model-packs`, `training`) and the ten test files that covered only it. It was
  excluded from the build, was not part of the product, and was the sole cause of a typecheck
  failure that silently prevented the entire test suite from running.
- **`@huggingface/transformers`**, the sole runtime dependency, reachable only from the deleted
  legacy runtime. `node_modules` drops from 719 MB to 25 MB (dev only) and `npm audit` from five
  high-severity advisories to zero. The shipped package now has **no runtime dependencies**.
- `scripts/package-release.mjs`, which built a browser-extension zip. `npm pack` is the release
  artifact.

### Security

- No runtime dependencies means no runtime supply chain.
- Argument validation errors no longer echo unbounded caller input into internal error paths.

## [0.5.0] — 2026-07-24

MCP 0.5: nine tools with bounded input and output contracts, seven resources, one prompt,
completions, stdio and Streamable HTTP transports, and privacy-preserving aggregate preference
learning.

> Note: `npm run verify` did not pass in this release. A typecheck failure in legacy extension code
> caused `npm test` to exit before running any test. Fixed in 0.6.0.
