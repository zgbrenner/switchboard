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

That was first measured on a single scenario (GSM8K), where it could be dismissed as an artifact of
a homogeneous corpus: on one task type at one difficulty band, no router can beat random by more
than noise, by construction. It has since been re-measured on **five pooled HELM Lite scenarios**
spanning math, multi-subject knowledge, commonsense QA, medical QA and long-context narrative QA.
Pooling did what it was expected to do — the tier distribution stopped being degenerate and the
ceiling for a perfect prompt-ordering router rose from +0.3 points over random to +3.8. Switchboard
captured **none** of it, and on the full pool it lands **below** random at matched cost. The
single-scenario excuse is gone; the finding survived a fairer test.

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
# One scenario per invocation. ~95-475 HTTP GETs each against a public GCS bucket, no API key.
node scripts/fetch-oracle.mjs --scenario=gsm          --out=benchmarks/data/helm-gsm.jsonl
node scripts/fetch-oracle.mjs --scenario=mmlu         --out=benchmarks/data/helm-mmlu.jsonl
node scripts/fetch-oracle.mjs --scenario=med_qa       --out=benchmarks/data/helm-med_qa.jsonl
node scripts/fetch-oracle.mjs --scenario=narrative_qa --out=benchmarks/data/helm-narrative_qa.jsonl
node scripts/fetch-oracle.mjs --scenario=commonsense  --out=benchmarks/data/helm-commonsense.jsonl

# Pool them. --data= takes a comma-separated list, and may be repeated.
node scripts/benchmark-oracle.mjs \
  --data=benchmarks/data/helm-gsm.jsonl,benchmarks/data/helm-mmlu.jsonl \
  --data=benchmarks/data/helm-med_qa.jsonl \
  --data=benchmarks/data/helm-narrative_qa.jsonl,benchmarks/data/helm-commonsense.jsonl
```

With no `--data=`, `benchmark:oracle` reads `benchmarks/data/helm-gsm.jsonl` alone. These invoke the
scripts directly rather than through `npm run … --`, because that form does not reliably forward
flags through every shell — PowerShell drops them silently, and `fetch-oracle` will then quietly
re-fetch its `gsm` default instead of the scenario you asked for.

`scripts/fetch-oracle.mjs` builds a dense `(prompt x model) -> (correct?, cost)` matrix from
[Stanford HELM's](https://crfm.stanford.edu/helm/) public results, joined to
[LiteLLM's](https://github.com/BerriAI/litellm) published price table. Every number was measured by
Stanford CRFM when they ran the models; nothing here calls a model and no API key is required.

Models are bucketed into Switchboard's four tiers by mean cost per prompt, because price rank is the
only provider-independent ordering available — the same assumption a host makes when it supplies a
model inventory.

### Why pooling, and what pooling requires

Routing can only pay where traffic is **heterogeneous** — where some prompts genuinely need a
stronger model and others do not. A single HELM scenario is one task type at one difficulty band, so
a negative result on it is partly a statement about the corpus. Pooling several scenarios is the
fairer test. Three things had to be right first:

- **Instance ids are unique only within a (scenario, sub-scenario) pair.** HELM ids are `id<N>`
  indices into each source dataset, so they collide across scenarios. Across the five files below,
  3537 distinct `(scenario, subset, id)` prompts collapse to **3096 bare ids**: 441 prompts vanish
  outright, and each key they landed on carries an outcome vector stitched together from two
  scenarios — one scenario's prompt text scored against another's model outcomes. Silent, and worse
  than a crash. The key is now the triple.
- **Several scenarios are families of sub-scenarios.** `mmlu` is five subjects and `legalbench` is
  five subsets, each with an independent id space starting at `id0`, and the fetcher previously
  loaded `instances.json` once per scenario — so every `mmlu` row after the first subject got the
  wrong prompt text. It now caches one instance map per sub-scenario and records a `subset` field.
- **The model roster is the intersection, not the union.** HELM ran `gsm` against 94 models and the
  other lite scenarios against 95. The density filter requires a prompt to have been answered by
  every model in the roster, so a union roster would demand outcomes that do not exist and discard
  whole scenarios. Intersecting costs one model here and evaluates every scenario against one
  identical inventory — which is also the situation a host is in. Tiering per scenario instead was
  rejected: it would put the same model in `fast` for one request type and `deep` for another, which
  is not a configuration anyone can deploy.

### Result A — single scenario (HELM `lite:gsm`, 1000 prompts x 49 priced models)

| Strategy | Accuracy | $/1k prompts |
|---|---|---|
| always-fast | 60.4% | $0.11 |
| always-balanced | 67.4% | $0.46 |
| always-deep | 79.9% | $2.12 |
| always-max | 83.6% | $12.26 |
| best single model | 95.6% | $4.93 |
| **Switchboard** | **67.5%** | **$0.50** |
| oracle (cheapest correct) | 99.6% | $0.04 |
| ceiling (perfect ordering) | 67.8% | $0.50 |

Switchboard: 95% CI 66.0%–69.0% (bootstrap, n=1000). Random router at matched cost: 67.6%,
**p = 0.990**. Tier distribution: `fast=0 balanced=983 deep=16 max=1`.

The router sends 98% of these prompts to a single tier. On grade-school math word problems none of
its English keyword signals fire, so it degenerates into a constant `balanced` router — and a
constant router is, by construction, indistinguishable from a random one at matched cost.

> These figures differ from the ones published before 2026-08 (65.6% vs 65.7% random, p = 0.677) on
> the same scenario and the same code path. Nothing about the router changed; **LiteLLM's price
> table did.** Tiers are price-ranked, so a repricing moves the tier boundaries and every strategy
> with them. Treat two runs fetched months apart as two different inventories, and do not compare
> their absolute accuracies. The qualitative finding — indistinguishable from random — held.

### Result B — five pooled scenarios (3537 prompts x 49 priced models)

`gsm` (math word problems) + `mmlu` (5 academic subjects) + `med_qa` (medical) + `narrative_qa`
(long-context reading comprehension) + `commonsense` (OpenBookQA).

Heterogeneity is real, and it is exactly what a single scenario could not show. `gain` is
acc(always-max) − acc(always-fast): how much an upgrade actually buys on that scenario.

| Scenario | Prompts | Metric | fast | max | gain | Switchboard | tier mix |
|---|---|---|---|---|---|---|---|
| commonsense | 500 | exact_match | 80.9% | 93.8% | **+13.0** | 80.5% | f=408 b=91 d=1 m=0 |
| gsm | 1000 | final_number_exact_match | 62.6% | 85.4% | **+22.8** | 61.8% | f=0 b=983 d=16 m=1 |
| med_qa | 1000 | quasi_exact_match | 56.3% | 75.5% | **+19.2** | 62.8% | f=2 b=612 d=369 m=17 |
| mmlu | 567 | exact_match | 59.4% | 72.2% | **+12.8** | 58.4% | f=210 b=334 d=20 m=3 |
| narrative_qa | 470 | f1_score | 74.9% | 61.2% | **−13.7** | 71.6% | f=0 b=215 d=230 m=25 |

| Strategy | Accuracy | $/1k prompts |
|---|---|---|
| always-fast | 64.5% | $0.11 |
| always-balanced | 63.5% | $0.44 |
| always-deep | 77.2% | $1.95 |
| always-max | 78.4% | $11.24 |
| best single model | 88.2% | $4.09 |
| **Switchboard** | **65.5%** | **$1.11** |
| oracle (cheapest correct) | 98.7% | $0.21 |
| ceiling (perfect ordering) | 70.1% | $0.67 |

Switchboard: 95% CI 64.6%–66.4%. Random at matched cost **66.3%, p = 1.000**. Stratified by
scenario, **65.5%, p = 0.642**. Tier distribution: `fast=620 balanced=2235 deep=636 max=46`.

### Result C — sensitivity: the four binary-metric scenarios (3067 prompts)

`narrative_qa` is the only pooled scenario scored by a continuous metric (token `f1_score`) and the
only one where the gain is **negative** — expensive models score *worse*. Dropping it is a
sensitivity check, not the headline; both results are reported because the choice changes the sign.

| Strategy | Accuracy | $/1k prompts |
|---|---|---|
| always-fast | 61.4% | $0.08 |
| always-balanced | 67.0% | $0.32 |
| always-deep | 76.8% | $1.43 |
| always-max | 79.3% | $8.06 |
| **Switchboard** | **67.5%** | **$0.53** |
| ceiling (perfect ordering) | 70.6% | $0.50 |

Random at matched cost **67.2%, p = 0.015** (z ≈ 2.3). Stratified by scenario, **67.6%, p = 0.861**.
Best random `balanced`/`deep` mix at the same spend: 68.8% — Switchboard **−1.3 points**.

### What this means

**Pooling confirmed the hypothesis about the corpus and refuted the hope about the router.**

1. **The degenerate tier distribution is gone.** On `gsm` alone the router put 98% of prompts in one
   tier; pooled it spreads `620 / 2235 / 636 / 46`. The README previously called that degeneracy
   *"the binding constraint"* — it was a property of the corpus, and a heterogeneous corpus removes
   it.
2. **Real headroom appeared.** Perfect prompt-ordering at the router's own tier mix is worth +0.3
   points on `gsm` and **+3.8 points** pooled (66.3% → 70.1%). There is now something to win.
3. **Switchboard captures none of it.** Pooled, it scores 65.5% against a random router's 66.3% at
   the same cost — *worse*, p = 1.000, headroom captured **−21.6%**.
4. **The one significant result is a domain classifier, not a router.** On the four binary-metric
   scenarios Switchboard does beat an unstratified shuffle (+0.3 points, p = 0.015). Stratify the
   shuffle by scenario — preserving each scenario's tier mix and scrambling only the order *within*
   it — and the effect vanishes entirely (p = 0.861). What the router has is a weak ability to tell
   medical QA from math word problems, not to tell a hard prompt from an easy one. `benchmark:oracle`
   now reports both tests for exactly this reason.
5. **The effect is economically irrelevant even where it is statistically real.** At $0.53/1k the
   best *no-decision* mix of two constant tiers scores 68.8% against Switchboard's 67.5%. On the
   full pool the gap is −5.9 points at $1.11/1k. A router that loses to a coin flip between two
   fixed tiers at the same budget is not paying for itself.
6. **Cheap is not always worse.** Pooled, `always-balanced` (63.5% at $0.44) is beaten by
   `always-fast` (64.5% at $0.11) — a strict cost/quality inversion at the tier level, and the
   router's single most common destination is the dominated tier. Part of the pooled deficit is this
   inventory artifact rather than the router's decisions, and price-rank tiering cannot see it.

The oracle row remains why routing is worth attempting at all: **98.7% at 1/50th the cost of
always-max**. Almost none of that headroom is currently captured.

### Caveats

These bind on every number above.

- **Distribution shift is severe.** HELM prompts are short, single-turn, self-contained questions
  with one verifiable answer. Switchboard targets multi-turn agentic and authoring requests with
  attachments and no single correct answer. Treat this as a lower bound on a distribution the router
  was not designed for.
- **Benchmark correctness is not good routing.** A model can be "correct" on GSM8K and still be the
  wrong choice for a task.
- **Pooled scenarios do not carry equal weight, and the weights are arbitrary.** HELM's per-scenario
  instance counts (1000 / 1000 / 567 / 500 / 470) set them. A different mix moves every pooled
  number. Nothing here claims this mix resembles production traffic.
- **Metrics are not commensurable.** Four scenarios are binary; `narrative_qa` is token `f1_score`
  in [0, 1]. Pooled "accuracy" is a mean over both, so it is a mean score, not a success rate. The
  oracle row is correspondingly defined as *cheapest model achieving the best score on that prompt*,
  which is identical to "cheapest correct" for binary metrics.
- **`narrative_qa`'s tier gain is negative (−13.7 points).** Expensive models produce longer answers
  and token-F1 penalises them, so on that scenario upgrading is actively harmful. This is a property
  of the metric more than of the models, and it is the single largest driver of the pooled deficit.
  It is kept in the headline pool because excluding inconvenient scenarios post hoc is how negative
  results get laundered; Result C reports the effect of removing it.
- **Tiers are price-ranked.** A cost/quality inversion in the inventory places a strictly dominated
  model in a tier and penalises every strategy that selects it — see point 6 above, where pooled
  `balanced` is dominated by `fast`.
- **Costs are LiteLLM list prices** at fetch time, ignoring caching, batching and negotiated rates.
  Absolute accuracies are not comparable across fetches; see the note under Result A.
- **The effort axis is unevaluated.** HELM records no reasoning-effort label, so only the tier axis
  is measured here.
- **HELM records `num_output_tokens` as 0 for a minority of runs** (~17% of rows here). Those fall
  back to a ~4-characters-per-token estimate and are flagged `output_tokens_measured: false`.
- **Roughly half of HELM's models have no LiteLLM price** and are excluded from all cost math, which
  biases the inventory toward models a commercial price table tracks.

### Reproducing

Deterministic: fixed PRNG seeds, 200 permutations per test, 1000 bootstrap resamples. 200
permutations floors any p-value at 1/201 ≈ 0.005, so p = 0.015 means 2 of 200 shuffles matched or
beat the router. Re-running the fetch may shift costs as LiteLLM's price table moves.

Fetched data lands in `benchmarks/data/` and is gitignored. The five scenarios above total **~330 MB**
(narrative_qa 156 MB, med_qa 90 MB, gsm 44 MB, mmlu 22 MB, commonsense 16 MB); the prompt text is
repeated once per (prompt, model) row, so long-context scenarios dominate. HELM's results are
published by Stanford CRFM under the terms of the underlying datasets; this repo redistributes none
of it and fetches on demand.

## Growing the corpus

Add reviewed examples covering adjacent-tier boundaries, high-stakes domains, source verification,
difficult code and security analysis, files and long context, short context-dependent follow-ups,
conflicting instructions, multilingual prompts, adversarial input, and policy tradeoffs.

Do not collect raw user prompts. New cases must be authored, properly licensed, or derived only from
privacy-preserving aggregates that cannot reconstruct user content.

## Diagnosing the gap

`benchmark:oracle` reports several figures that say *why* a router is or is not working, not just
whether it is.

**Ceiling (perfect ordering).** The cheapest-correct oracle picks a model after seeing the answer,
so it is not a target any router could hit. The ceiling is the fair one: it holds the router's own
tier mix fixed and hands the expensive tiers to the prompts with the most to gain. It is the most
any router could score by ordering these prompts perfectly.

**Headroom captured.** Where the router sits between random and that ceiling.

**Two permutation tests.** The unstratified shuffle destroys everything the router knew, so beating
it only proves the router discriminates *something* — on a pooled corpus that can be satisfied by
telling scenarios apart and nothing more. The shuffle stratified by scenario preserves each
scenario's tier mix and scrambles only the order within it, so beating *that* requires ordering
prompts inside a domain. A router that passes the first and fails the second is a domain classifier.

On `lite:gsm` alone: random 67.6% → Switchboard 67.5% → perfect ordering **67.8%**. Perfect ordering
is worth only +0.3 points, because the router puts 983 of 1000 prompts in a single tier and there is
nothing to order in a constant assignment.

Pooled over five scenarios: random 66.3% → Switchboard 65.5% → perfect ordering **70.1%**.

That pair is the finding. The previous edition of this file named a degenerate tier distribution as
*"the binding constraint"* and predicted that work on ranking prompts was capped at +0.2 points
until the router spread across tiers at all. **Pooling removed the degeneracy and the cap — and the
router still did not move.** The constraint was correctly identified as *necessary*; it turned out
not to be *sufficient*. With +3.8 points of ordering headroom now on the table, the binding
constraint is what it was originally suspected to be: the difficulty signal itself.

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
| **Pooling scenarios into a heterogeneous corpus** (2026-08) | 5 scenarios, 3537 prompts: −0.8 points vs random, p = 1.000; 4 binary-metric scenarios: +0.3 points, p = 0.015 unstratified but p = 0.861 stratified by scenario | **Fixed the corpus, not the router.** Degeneracy and the ceiling both resolved; capture did not follow |

Two things worth knowing from that work:

- **Length predicts difficulty at ρ = −0.37 on math word problems and −0.13 on medical QA.** The
  feature that looks strong in one domain is close to useless in another, which is why anything
  tuned on a single corpus should be assumed not to transfer until shown otherwise.
- **Tier-gain is inverted-U in difficulty** (gsm, by hardness band: 0.05 / 0.21 / 0.29 / 0.36 /
  0.25). The easiest prompts gain almost nothing from an upgrade, and so do the hopeless ones.
  A monotone "harder → more expensive" rule is the wrong shape.

## What would close the gap

Ranked by expected value, honestly. Reordered after the 2026-08 pooled measurement, which retired
the item that used to sit at the top.

1. **A difficulty signal that orders prompts within a domain.** This is now the binding constraint,
   measured rather than assumed: the scenario-stratified permutation test says the router carries no
   within-domain ordering signal at all (p = 0.861), while perfect ordering is worth +3.8 points. Two
   families have already failed here — hand-crafted structural/length features and hashed TF-IDF
   k-NN — so this is a hard problem, not an unattempted one.
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
