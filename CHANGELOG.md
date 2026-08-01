# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] — 2026-07-31

A request-preparation release, plus a verification pass that found the release process itself had
drifted: the server had been bumped to 0.7.0 internally without the package, the registry manifest,
or this changelog following, and `npm run verify` — the project's own mandatory gate — did not
actually pass on a clean checkout.

### Added

- **`prepare_request`**, a configurable preflight pipeline with four independently toggleable
  stages, always applied in order: routing, file-to-Markdown conversion, local prompt compression
  (ONNX sidecar with a deterministic lossless fallback), and reply-brevity steering.

### Fixed — release process

- **`package.json`, `server.json`, and `package-lock.json` still said `0.6.0`** while
  `mcp/server/metadata.mjs` reported `SERVER_INFO.version: '0.7.0'` to every MCP client. A published
  package would have described itself two different ways depending on which field a caller read.
  All four are now `0.7.0`.
- **`npm test` and `npm run build` crashed with `ENOENT` on Windows.** Both spawned `tsc` as a bare
  command without a shell, which Windows cannot execute directly (it is a `.cmd` shim). Fixed by
  invoking `node_modules/typescript/bin/tsc` directly through `process.execPath`, which needs no
  shell and has no quoting hazards — the same fix applied to `scripts/benchmark.mjs` and
  `scripts/benchmark-oracle.mjs`.
- **`scripts/test.mjs` pointed `SWITCHBOARD_ROUTER_MODULE` at a path that never existed**
  (`.test-dist/js/router/route.js` instead of the actual compiled `.test-dist/router/route.js`),
  silently failing any test file that imports `mcp/server.mjs` without overriding the variable
  itself. Two test files (`mcp-protocol-errors`, `tools-contract`) could not run at all as a result.
- **Five test files still asserted the 0.5-era server identity** (`serverInfo.version === '0.5.0'`,
  a 9-tool surface missing `prepare_request`) after the version and tool-list bump, so
  `npm run verify` failed out of the box on a fresh clone. Assertions updated to match the current
  contract.

### Fixed — routing

- **The `code` capability fired on ordinary English words.** `class` and `function` matched as bare
  words in the capability pattern, so prompts like "Explain the legal class action settlement
  process" or "Describe the function of the judiciary" were flagged as requiring a code-capable
  model with no programming content anywhere in the request. This is exactly the half of Switchboard
  the README asks users to trust as deterministic and tested. `class` and `function` are no longer
  matched as bare words; real code requests still fire through `code` itself, a language name, a
  fenced block, or another technical term in the pattern.
- **The `code` capability also fired on "react" as a bare word** ("how should I react to my
  coworker's comment?"), the same class of false positive as `class`/`function` above. `react`
  requests still fire through `javascript`/`typescript`/`code` itself/a fenced block, which a genuine
  question about the framework almost always includes.
- **The `vision` capability fired on the idioms "picture this" and "chart out."** Unlike
  `class`/`function`/`react`, `picture` and `chart` have a real, common single-word vision use
  ("what's in this picture", "explain this chart"), so rather than dropping them as bare words, only
  the specific idiomatic phrasing is now excluded.
- **Aggregate learning could erase a context-complexity floor.** `route.ts`'s
  `context-complexity-floor` raises the floor to `deep` for `comparison` and `reasoning` categories
  alone (a short, vague follow-up to a task that needed deep reasoning), but the learning-layer
  downgrade guard in `mcp/learning.mjs` only recognized a fixed `high-stakes`/`legal`/`security`/
  `medical`/`finance` category set plus hard capabilities. Neither `comparison` nor `reasoning` set a
  capability, so recorded downgrade overrides could — and, reproducibly, did — push a
  floor-protected route down to `balanced` or lower. The guard's category set now matches every
  category `context-complexity-floor` treats as floor-worthy.
- **Aggregate learning could erase the non-Latin-script floor.** The same gap as above, for the
  `unreadableScript` floor (`unknown-language` category): a non-English request correctly held at
  `balanced` could be learned back down to `fast`, undermining the exact protection added in 0.6.0
  to stop non-English prompts being silently routed as if they were trivial.

### Fixed — reliability

- **`record_override` could permanently wedge after a single transient write failure.**
  `AggregatePreferenceStore` serializes writes by chaining `.then()` calls onto a tracked queue
  promise; chaining onto an already-rejected promise just re-propagates that rejection forever, so
  one transient failure (a full disk, a concurrent writer, any I/O hiccup) poisoned every future
  `record`/`reset`/`snapshot`/`apply` call on that store — permanently, with no further contention at
  all, recoverable only by restarting the process. The queue's own serialization point now always
  settles to resolved regardless of outcome, while each call still observes its own real result.
- **No cap on the number of distinct learned categories.** Each `record_override` call bounds its own
  1–16 categories, but nothing capped how many distinct category keys could accumulate over time.
  Left unbounded, this can grow the persisted state file past its own 1 MiB read limit — and every
  subsequent load, including `apply()`, which `route_request` calls on every invocation when
  preferences are shared, would then throw, breaking routing itself for every session sharing that
  state file. Capped at 2,000 distinct categories, comfortably under a quarter of the byte limit.
- **`persist()` leaked its temp file on a failed write.** The atomic write-then-rename left an orphaned
  `.tmp` file behind on any failure instead of cleaning it up.

### Removed

- **`src/router/personalization.ts`**, an orphaned override-learning implementation never imported by
  any runtime path — the live implementation is `mcp/learning.mjs`'s `AggregatePreferenceStore`,
  which has its own, different bias-clamping bounds. Kept only its own test, which risked misleading
  a future reader into thinking it was live or into wiring it in alongside the real implementation.

### Changed — performance

- **`semanticRouteScores` re-tokenized the four constant tier-prototype strings on every single
  `routeRequest` call.** Precomputing them once at module load measured a 52% reduction in this
  function's own cost and a 33% reduction in `routeRequest`'s end-to-end latency (front-loaded the
  same fix for the input text's own vector norm, recomputed once per call instead of once per tier).

### Fixed — pipeline

- **A chunk boundary could split a UTF-16 surrogate pair.** `chunkText`'s hard character-count
  fallback (used when a long run of text has no whitespace/punctuation to split on, e.g. a run of
  emoji) is a pure code-unit count with no content awareness, and could land between a high and low
  surrogate. `reassembleChunks` still recombines the split pair losslessly in JS-string space, but a
  lone surrogate has no valid UTF-8 encoding, so the compression sidecar — which re-encodes each
  chunk independently over its UTF-8 stdin pipe — would silently replace it with U+FFFD before the
  model ever saw it. The fallback now nudges the split point off any surrogate-pair boundary.
- **An unterminated brevity marker was left orphaned instead of cleaned up.** A start marker with no
  matching end marker (truncated content, or a malformed marker) was left in place, so the next call
  appended a second full block alongside it instead of replacing it. Now dropped along with
  everything after it, same as a well-formed block.

### Fixed — protocol

- **A schema-valid attachment could hang a client forever.** File attachments are valid up to 50 MiB
  decoded (`mcp/pipeline/files.mjs`), around 67 MiB base64-encoded, but the stdio transport's
  1 MiB line cap rejected any realistically sized attachment before it was even parsed — and that
  rejection can never carry a correlatable `id`, since the oversized line is never parsed, so a
  client that matches responses by `id` waits forever. stdio is a local pipe to whichever process
  spawned it, not a network listener, and `readline` already buffers a full line before this check
  runs regardless of the threshold, so raising the cap (to 100 MiB) does not change the transport's
  actual worst-case memory exposure — it only stops rejecting legitimate, schema-valid requests.
- **A prompt made entirely of invisible Unicode passed "non-whitespace" validation.**
  `String.prototype.trim()` does not strip zero-width space (U+200B), BOM/ZWNBSP (U+FEFF), or other
  Unicode format characters, so a prompt containing only those got routed as if it were meaningful
  content. `stringValue`'s `nonWhitespace` check now requires at least one character outside
  whitespace and the Unicode `Cf` (format) category — closing the gap everywhere it's used: prompts,
  context turns, attachment names, and model identifiers.

### Fixed — documentation

- **`docs/mcp.md` never documented `prepare_request`** and still called itself the "0.5 reference"
  at version `0.6.0`. Added a tool-surface section and bumped the header to `0.7.0`.
- **README undercounted the tool surface** ("nine tools", "the other eight tools", missing
  `prepare_request` from the Tools table) after the same tool was added.
- **The Honest limitations section didn't disclose that `confidence` can invert.** A keyword-avoidant
  request that happens to under-route can score *higher* confidence than the same scenario phrased
  with an explicit high-stakes keyword, since the score measures how much evidence fired, not whether
  the decision was correct. Documented alongside the existing "not a calibrated probability" caveat.

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
- Biome for linting and formatting, configured to fail the build on any stdout write under `mcp/`
  or `src/`.
- A committed snapshot of the published `tools/list` contract, so any change to a tool name,
  description, annotation or schema fails the test suite instead of shipping silently. Accept an
  intentional change with `npm run snapshot:update`.
- A description on every one of the 45 input-schema properties across the nine tools. These are what
  a model fills arguments from; previously none had one.

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
- **`npm run verify` is the release gate and it is manual.** This repository has no CI: GitHub-hosted
  runners are not available to it, and a permanently failing workflow is worse than an honest manual
  gate. `prepublishOnly` runs the same command so a publish cannot skip it, and CONTRIBUTING.md
  documents the two release checks nothing runs for you — installing the packed tarball into an empty
  project, and driving the server with the MCP Inspector.

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
