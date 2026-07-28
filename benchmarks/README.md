# Routing evaluation

Switchboard is evaluated two ways. They answer different questions and neither alone is sufficient.

| | `npm run benchmark` | `npm run benchmark:oracle` |
|---|---|---|
| Ground truth | Hand-authored tier labels | Measured per-model outcomes |
| Answers | "Did routing change unexpectedly?" | "Is routing actually any good?" |
| Data | `router-cases.jsonl` (in repo) | Stanford HELM (fetched) |
| Runs offline | Yes | After `npm run eval:fetch` |

## The honest summary

**On a public academic benchmark, Switchboard's heuristics are not distinguishable from a random
router at the same cost.** That result is printed by `npm run benchmark:oracle` and is reproduced
below. It is a real limitation, not a rounding error, and it is stated here rather than buried,
because a routing product that hides its evaluation is not worth installing.

## `npm run benchmark` — regression corpus

`router-cases.jsonl` holds 32 cases with an expected tier range and required capabilities. These are
**expert judgements written by the author of the router**, so a high score here is evidence that
behaviour has not drifted, and nothing more. It cannot tell you the router is good, because the same
person defined both the question and the answer.

Use it as a regression gate. `--strict` exits non-zero on a harmful under-route or a capability miss.
Over-routing is reported but not gated; it wastes money rather than producing a wrong answer.

The property tests in `test/router-properties.test.mjs` complement it by asserting invariants that
need no labels at all: determinism, policy monotonicity, floor inviolability, cosmetic invariance,
and a keyword-flip stability bound. Those are the strongest claims Switchboard can make without
outcome data, and five of them fail against the pre-0.6 router.

Cases use the abstract `fast`, `balanced`, `deep` and `max` tiers rather than provider model names,
so the corpus stays valid as model offerings change.

## `npm run benchmark:oracle` — measured outcomes

```bash
npm run eval:fetch        # ~94 HTTP GETs against a public GCS bucket, no API key
npm run benchmark:oracle
```

`scripts/fetch-oracle.mjs` builds a dense `(prompt x model) -> (correct?, cost)` matrix from
[Stanford HELM's](https://crfm.stanford.edu/helm/) public results, joined to
[LiteLLM's](https://github.com/BerriAI/litellm) published price table. Every number was measured by
Stanford CRFM when they ran the models; nothing here calls a model and no API key is required.

Models are bucketed into Switchboard's four tiers by mean cost per prompt, because price rank is the
only provider-independent ordering available — the same assumption a host makes when it supplies a
model inventory.

### Result (HELM `lite:gsm`, 1000 prompts x 49 priced models)

| Strategy | Accuracy | $/1k prompts |
|---|---|---|
| always-fast | 62.4% | $0.06 |
| always-balanced | 65.2% | $0.38 |
| always-deep | 79.9% | $2.12 |
| always-max | 83.6% | $12.26 |
| best single model | 95.6% | $4.93 |
| **Switchboard** | **65.6%** | **$0.44** |
| oracle (cheapest correct) | 99.6% | $0.01 |

Switchboard: 95% CI 64.2%–67.1% (bootstrap, n=1000). Random router at matched cost: 65.7%,
**p = 0.677**. Tier distribution: `fast=0 balanced=970 deep=29 max=1`.

### What this means

The router sends 97% of these prompts to a single tier. On grade-school math word problems none of
its English keyword signals fire, so it degenerates into a constant `balanced` router — and a
constant router is, by construction, indistinguishable from a random one at matched cost.

The oracle row is why routing is worth attempting at all: **99.6% accuracy at 1/400th the cost of
always-max**. Almost none of that headroom is currently captured.

### Caveats

These bind on every number above.

- **Distribution shift is severe.** HELM prompts are short, single-turn, self-contained questions
  with one verifiable answer. Switchboard targets multi-turn agentic and authoring requests with
  attachments and no single correct answer. Treat this as a lower bound on a distribution the router
  was not designed for.
- **Benchmark correctness is not good routing.** A model can be "correct" on GSM8K and still be the
  wrong choice for a task.
- **Tiers are price-ranked.** A cost/quality inversion in the inventory places a strictly dominated
  model in a tier and penalises every strategy that selects it.
- **Costs are LiteLLM list prices** at fetch time, ignoring caching, batching and negotiated rates.
- **The effort axis is unevaluated.** HELM records no reasoning-effort label, so only the tier axis
  is measured here.
- **HELM records `num_output_tokens` as 0 for a minority of runs.** Those fall back to a
  ~4-characters-per-token estimate and are flagged `output_tokens_measured: false`.

### Reproducing

Deterministic: fixed PRNG seeds, 200 permutations, 1000 bootstrap resamples. Re-running `eval:fetch`
may shift costs slightly as LiteLLM's price table moves. Fetched data lands in `benchmarks/data/`
and is gitignored.

## Growing the corpus

Add reviewed examples covering adjacent-tier boundaries, high-stakes domains, source verification,
difficult code and security analysis, files and long context, short context-dependent follow-ups,
conflicting instructions, multilingual prompts, adversarial input, and policy tradeoffs.

Do not collect raw user prompts. New cases must be authored, properly licensed, or derived only from
privacy-preserving aggregates that cannot reconstruct user content.

## Diagnosing the gap

`benchmark:oracle` reports two figures that say *why* a router is or is not working, not just
whether it is.

**Ceiling (perfect ordering).** The cheapest-correct oracle picks a model after seeing the answer,
so it is not a target any router could hit. The ceiling is the fair one: it holds the router's own
tier mix fixed and hands the expensive tiers to the prompts with the most to gain. It is the most
any router could score by ordering these prompts perfectly.

**Headroom captured.** Where the router sits between random and that ceiling.

On `lite:gsm` today: random 65.7% → Switchboard 65.6% → perfect ordering **65.9%**.

That ceiling is the finding. Perfect ordering is worth only +0.2 points here — because the router
puts 970 of 1000 prompts in a single tier, and there is nothing to order in a constant assignment.
**The binding constraint is a degenerate tier distribution, not a weak difficulty signal.** Any work
on ranking prompts is capped at +0.2 points until the router spreads across tiers on this
distribution at all.

## What has been tried

Recorded so it is not repeated. Discipline: deterministic 60/20/20 folds by hash of `instance_id`,
signals designed on train only, dev for go/no-go, two entirely unseen domains (`med_qa`,
`legalbench`) for transfer, test touched once.

| Approach | Best held-out result | Verdict |
|---|---|---|
| Structural/length features | gsm dev +0.003 (p=0.32); med_qa −0.002; legalbench −0.008 | Did not replicate; negative on transfer |
| Hashed TF-IDF + cosine k-NN | gsm dev +0.002 (p=0.36); pooled p=0.23–0.70 | No signal held out |
| Pre-registered easy-quartile rule | +0.003…+0.007 on 3 of 4 corpora, p=0.11–0.13 | Consistently positive, never significant |
| Cascade (needs generated output) | gsm +0.010 at recall 0.9; med_qa negative at every verifier quality | Works only where the cheap tier is strong |

Two things worth knowing from that work:

- **Length predicts difficulty at ρ = −0.37 on math word problems and −0.13 on medical QA.** The
  feature that looks strong in one domain is close to useless in another, which is why anything
  tuned on a single corpus should be assumed not to transfer until shown otherwise.
- **Tier-gain is inverted-U in difficulty** (gsm, by hardness band: 0.05 / 0.21 / 0.29 / 0.36 /
  0.25). The easiest prompts gain almost nothing from an upgrade, and so do the hopeless ones.
  A monotone "harder → more expensive" rule is the wrong shape.

## What would close the gap

Ranked by expected value, honestly:

1. **Make the tier distribution non-degenerate on realistic traffic.** Nothing else can pay until
   this does — see the ceiling above.
2. **Recommend cascades where the cheap tier is strong.** Information observed *after* generation
   converts into real gains where pre-generation prediction does not, and Switchboard already emits
   multi-stage execution plans. It is advisory, so the host performs the verification.
3. **An outcome-labelled corpus from Switchboard's real distribution.** Every result here is on
   single-turn academic QA. The strongest public candidate, RouterBench, ships only as Python
   pickles and is unavailable in some environments.
4. **Calibrating `confidence` against measured outcomes**, so it becomes a probability rather than
   the evidence score it is today.

## Reading a change

A change is not better merely because average accuracy rises. Review, in order: harmful
under-routing, mandatory capability recall, high-stakes subset performance, calibration and
deferral, over-routing, latency, and MCP protocol compatibility. A router benchmark can pass while
the server is protocol-incompatible; both layers must be verified.
