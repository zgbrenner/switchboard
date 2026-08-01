/**
 * Evaluate the router against measured per-model outcomes.
 *
 * Unlike `npm run benchmark`, which scores the router against hand-authored tier labels, this
 * scores it against outcomes that were actually observed: for every prompt, whether each candidate
 * model answered correctly and what that answer cost. That makes accuracy, cost and the oracle gap
 * computable rather than asserted.
 *
 * Run `npm run eval:fetch` first to populate benchmarks/data/.
 *
 * Usage:
 *   node scripts/benchmark-oracle.mjs                                  # benchmarks/data/helm-gsm.jsonl
 *   node scripts/benchmark-oracle.mjs --data=a.jsonl,b.jsonl           # pooled, comma-separated
 *   node scripts/benchmark-oracle.mjs --data=a.jsonl --data=b.jsonl    # pooled, repeated flag
 *
 * Pooling matters. A single HELM scenario is one task type at one difficulty band, and routing gains
 * come from heterogeneity -- some prompts genuinely need a stronger model and others do not. On a
 * homogeneous corpus no router can beat random at matched cost by more than noise, by construction,
 * so a single-scenario result measures the corpus as much as the router. Pass several scenarios to
 * evaluate against traffic that actually varies.
 *
 * READ THE CAVEATS THIS PRINTS. The corpus is a public academic benchmark, not the agentic and
 * authoring traffic Switchboard is designed for, and the gap matters when interpreting the numbers.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const tscBin = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const TIERS = ['fast', 'balanced', 'deep', 'max'];
const dataPaths = process.argv
  .filter((a) => a.startsWith('--data='))
  .flatMap((a) => a.slice('--data='.length).split(','))
  .map((path) => path.trim())
  .filter(Boolean);
if (dataPaths.length === 0) dataPaths.push('benchmarks/data/helm-gsm.jsonl');
const strict = process.argv.includes('--strict');

const missing = dataPaths.filter((path) => !existsSync(path));
if (missing.length > 0) {
  console.error(`No outcome data at ${missing.join(', ')}.\nRun: npm run eval:fetch\n`);
  process.exit(1);
}

if (!existsSync('.test-dist/router/route.js')) {
  const compile = spawnSync(process.execPath, [tscBin, '-p', 'tsconfig.test.json'], { stdio: 'inherit' });
  if (compile.status !== 0) process.exit(compile.status ?? 1);
}
const { routeRequest } = await import('../.test-dist/router/route.js');

/** Deterministic PRNG so every reported figure is reproducible. */
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const loaded = [];
for (const path of dataPaths) {
  const rowsInFile = (await readFile(path, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.priced && row.cost_usd !== null && row.prompt);
  if (rowsInFile.length === 0) {
    console.error(`${path} contained no priced rows.`);
    process.exit(1);
  }
  loaded.push(...rowsInFile);
}

// ---- Model roster across pooled scenarios ----------------------------------------------------
// HELM did not run every scenario against the same models (its gsm run is missing one that every
// other lite scenario has), and the LiteLLM price join can drop a different model per file. The
// density filter below demands a prompt be answered by every model in the roster, so a roster built
// from the union would require each scenario to contain models it was never run against and would
// silently discard whole scenarios. The roster is therefore the INTERSECTION over pooled scenarios.
//
// The alternative -- tiering within each scenario and combining only at the scoring level -- was
// rejected: it lets one model sit in `fast` for one scenario and `deep` for another, which is not a
// configuration any host can implement. A host supplies one inventory, not one per request type, so
// one price-ranked tiering over one common inventory is the faithful model of the deployed system.
const scenarioNames = [...new Set(loaded.map((row) => row.scenario))].sort();
const modelsPerScenario = new Map(scenarioNames.map((name) => [name, new Set()]));
for (const row of loaded) modelsPerScenario.get(row.scenario).add(row.model);
const roster = new Set(modelsPerScenario.get(scenarioNames[0]));
for (const name of scenarioNames) {
  for (const model of [...roster]) if (!modelsPerScenario.get(name).has(model)) roster.delete(model);
}
const rosterDropped = new Set(loaded.map((row) => row.model)).size - roster.size;
const rows = loaded.filter((row) => roster.has(row.model));

// ---- Model tiering -------------------------------------------------------------------------
// Switchboard recommends a tier, not a model, so the dataset's models are bucketed into the four
// tiers by mean cost per prompt. Price order is the only provider-independent ranking available,
// which is exactly the assumption a host makes when it supplies an inventory.
const perModel = new Map();
for (const row of rows) {
  const entry = perModel.get(row.model) ?? { n: 0, correct: 0, cost: 0 };
  entry.n++;
  entry.correct += row.correct;
  entry.cost += row.cost_usd;
  perModel.set(row.model, entry);
}
const models = [...perModel.entries()]
  .map(([model, v]) => ({ model, accuracy: v.correct / v.n, meanCost: v.cost / v.n }))
  .sort((a, b) => a.meanCost - b.meanCost);

const tierOf = new Map();
models.forEach((entry, index) => {
  tierOf.set(entry.model, TIERS[Math.min(TIERS.length - 1, Math.floor((index / models.length) * TIERS.length))]);
});
const modelsByTier = Object.fromEntries(TIERS.map((t) => [t, models.filter((m) => tierOf.get(m.model) === t)]));

// ---- Per-prompt outcome matrix -------------------------------------------------------------
// HELM instance ids are unique only within a (scenario, sub-scenario) pair -- every sub-scenario's
// ids restart at `id0`. Keying on the bare id silently merges gsm's `id0` with mmlu's, so the key is
// the triple. `subset` is absent from files fetched before it was added; those are single-subset.
const byPrompt = new Map();
for (const row of rows) {
  const key = `${row.scenario}\u0000${row.subset ?? ''}\u0000${row.instance_id}`;
  const entry = byPrompt.get(key) ?? { prompt: row.prompt, scenario: row.scenario, outcomes: new Map() };
  entry.outcomes.set(row.model, { correct: row.correct, cost: row.cost_usd });
  byPrompt.set(key, entry);
}
const seenPerScenario = new Map(scenarioNames.map((name) => [name, 0]));
for (const entry of byPrompt.values()) seenPerScenario.set(entry.scenario, seenPerScenario.get(entry.scenario) + 1);
const prompts = [...byPrompt.values()].filter((p) => p.outcomes.size === models.length);

/** Expected (accuracy, cost) of choosing a tier: the mean over the models in it. */
function tierOutcome(entry, tier) {
  const candidates = modelsByTier[tier];
  if (!candidates?.length) return { correct: 0, cost: 0 };
  let correct = 0;
  let cost = 0;
  for (const { model } of candidates) {
    const outcome = entry.outcomes.get(model);
    correct += outcome.correct;
    cost += outcome.cost;
  }
  return { correct: correct / candidates.length, cost: cost / candidates.length };
}

// ---- Route every prompt ---------------------------------------------------------------------
const decisions = prompts.map((entry) => ({
  entry,
  tier: routeRequest({ prompt: entry.prompt, context: [], files: [], preferences: { policy: 'balanced' } }).tier,
}));

function score(assignments) {
  let correct = 0;
  let cost = 0;
  for (const { entry, tier } of assignments) {
    const outcome = tierOutcome(entry, tier);
    correct += outcome.correct;
    cost += outcome.cost;
  }
  return { accuracy: correct / assignments.length, costPer1k: (cost / assignments.length) * 1000 };
}

const switchboard = score(decisions);

const constant = Object.fromEntries(TIERS.map((tier) => [tier, score(decisions.map((d) => ({ entry: d.entry, tier })))]));

// Oracle: cheapest model that scored best on this prompt. Identical to "cheapest model that answered
// correctly" for the binary metrics (exact_match and friends), and defined for the continuous ones
// HELM also reports -- narrative_qa and natural_qa are scored by f1_score, where demanding an exact
// 1.0 would call almost every prompt unsolvable and understate the oracle badly.
let oracleCorrect = 0;
let oracleCost = 0;
let unsolvable = 0;
for (const entry of prompts) {
  const best = [...entry.outcomes.values()].sort((a, b) => b.correct - a.correct || a.cost - b.cost)[0];
  if (!best || best.correct === 0) {
    unsolvable++;
    continue;
  }
  oracleCorrect += best.correct;
  oracleCost += best.cost;
}
const oracle = { accuracy: oracleCorrect / prompts.length, costPer1k: (oracleCost / prompts.length) * 1000 };

const bestSingle = models.reduce((a, b) => (b.accuracy > a.accuracy ? b : a));

// ---- Ceiling for any prompt-only router -----------------------------------------------------
// The cheapest-correct oracle above is not a fair target: it picks a *model* after seeing the
// answer. This ceiling is the fair one. It routes by each prompt's true tier-sensitivity --
// acc(max) - acc(fast), i.e. how much an upgrade would actually buy -- while holding the same tier
// mix Switchboard chose. It is the most any router could score by ordering these prompts perfectly,
// and it is what the gap below should be read against.
function tierSensitivityCeiling() {
  const gains = decisions.map(({ entry }) => tierOutcome(entry, TIERS.at(-1)).correct - tierOutcome(entry, TIERS[0]).correct);
  const order = decisions.map((_, i) => i).sort((a, b) => gains[b] - gains[a]);
  // Hand the most expensive tiers to the prompts with the most to gain, keeping the mix identical.
  const mix = decisions.map((d) => d.tier).sort((a, b) => TIERS.indexOf(b) - TIERS.indexOf(a));
  const assigned = new Array(decisions.length);
  order.forEach((promptIndex, rank) => {
    assigned[promptIndex] = mix[rank];
  });
  return score(decisions.map((d, i) => ({ entry: d.entry, tier: assigned[i] })));
}
const ceiling = tierSensitivityCeiling();

// ---- Best random tier mix at Switchboard's exact cost ----------------------------------------
// A fairer economic comparison than the shuffle: what accuracy could you buy with the same money by
// mixing two constant tiers at random, with no per-prompt decision at all? A router has to beat
// this to justify existing.
function bestMixAtBudget(budget) {
  let best = null;
  for (let i = 0; i < TIERS.length; i++) {
    for (let j = i + 1; j < TIERS.length; j++) {
      const lo = constant[TIERS[i]];
      const hi = constant[TIERS[j]];
      if (budget < lo.costPer1k || budget > hi.costPer1k) continue;
      const share = (budget - lo.costPer1k) / (hi.costPer1k - lo.costPer1k);
      const accuracy = lo.accuracy + share * (hi.accuracy - lo.accuracy);
      if (!best || accuracy > best.accuracy) best = { accuracy, mix: `${TIERS[i]}/${TIERS[j]}` };
    }
  }
  return best;
}
const matchedMix = bestMixAtBudget(switchboard.costPer1k);

// Random-at-matched-cost: keep the router's tier distribution, shuffle which prompt gets which.
// If the router carries no signal about difficulty, this scores the same and costs the same.
//
// `strata` controls what "random" is allowed to know. Unstratified, the shuffle destroys everything
// the router knew, so beating it only proves the router discriminates SOMETHING -- on a pooled
// corpus that can be satisfied by telling scenarios apart and nothing more. Stratified by scenario,
// the shuffle preserves each scenario's tier mix and only scrambles the order within it, so beating
// it requires ordering prompts inside a domain. Both are reported; they answer different questions,
// and a router that passes the first and fails the second is a domain classifier, not a router.
const PERMUTATIONS = 200;
function permutationTest(seed, strata) {
  const random = lcg(seed);
  const groups = new Map();
  decisions.forEach((decision, index) => {
    const key = strata ? decision.entry.scenario : '';
    const group = groups.get(key) ?? [];
    group.push(index);
    groups.set(key, group);
  });
  const accuracies = [];
  for (let iteration = 0; iteration < PERMUTATIONS; iteration++) {
    const shuffled = decisions.map((d) => d.tier);
    for (const indices of groups.values()) {
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[indices[i]], shuffled[indices[j]]] = [shuffled[indices[j]], shuffled[indices[i]]];
      }
    }
    accuracies.push(score(decisions.map((d, i) => ({ entry: d.entry, tier: shuffled[i] }))).accuracy);
  }
  accuracies.sort((a, b) => a - b);
  const mean = accuracies.reduce((s, v) => s + v, 0) / accuracies.length;
  return {
    mean,
    low: accuracies[Math.floor(0.025 * PERMUTATIONS)],
    high: accuracies[Math.floor(0.975 * PERMUTATIONS)],
    p: (accuracies.filter((a) => a >= switchboard.accuracy).length + 1) / (PERMUTATIONS + 1),
  };
}
const pooledPerm = permutationTest(20260728, false);
const withinPerm = scenarioNames.length > 1 ? permutationTest(20260729, true) : null;
const permMean = pooledPerm.mean;
const pValue = pooledPerm.p;

// Bootstrap CI on Switchboard's own accuracy.
const boot = lcg(987654321);
const bootAccuracies = [];
for (let iteration = 0; iteration < 1000; iteration++) {
  let correct = 0;
  for (let i = 0; i < decisions.length; i++) {
    const pick = decisions[Math.floor(boot() * decisions.length)];
    correct += tierOutcome(pick.entry, pick.tier).correct;
  }
  bootAccuracies.push(correct / decisions.length);
}
bootAccuracies.sort((a, b) => a - b);

const tierCounts = Object.fromEntries(TIERS.map((t) => [t, decisions.filter((d) => d.tier === t).length]));
const distinctTiers = TIERS.filter((t) => tierCounts[t] > 0).length;
const oracleGapClosed = (switchboard.accuracy - constant.fast.accuracy) / (oracle.accuracy - constant.fast.accuracy || 1);

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const usd = (v) => `$${v.toFixed(4)}`;

console.log(`\nOutcome-labelled routing evaluation  (${dataPaths.join(', ')})`);
console.log(`  ${prompts.length} prompts x ${models.length} priced models, dense matrix, ${unsolvable} prompt(s) no model solved`);
if (rosterDropped > 0) {
  console.log(`  ${rosterDropped} model(s) dropped: not present in every pooled scenario, so not part of a common inventory.`);
}
console.log('');

if (scenarioNames.length > 1) {
  // Heterogeneity is the precondition for routing to be able to pay at all. tier-gain is
  // acc(max) - acc(fast): how much an upgrade buys on this scenario. If it is the same everywhere,
  // there is nothing for a router to exploit no matter how good its per-prompt signal is.
  console.log('  Per-scenario (heterogeneity check):');
  console.log('    scenario        prompts  dropped  metric                  fast      max     gain   SWITCHBOARD  tier mix');
  for (const name of scenarioNames) {
    const subset = decisions.filter((d) => d.entry.scenario === name);
    if (subset.length === 0) continue;
    const fast = score(subset.map((d) => ({ entry: d.entry, tier: TIERS[0] })));
    const max = score(subset.map((d) => ({ entry: d.entry, tier: TIERS.at(-1) })));
    const gain = max.accuracy - fast.accuracy;
    const metric = [...new Set(rows.filter((r) => r.scenario === name).map((r) => r.metric))].join('/');
    const mix = TIERS.map((t) => `${t[0]}=${subset.filter((d) => d.tier === t).length}`).join(' ');
    const columns = [
      name.padEnd(15),
      String(subset.length).padStart(7),
      String(seenPerScenario.get(name) - subset.length).padStart(8),
      `  ${metric.padEnd(22)}`,
      pct(fast.accuracy).padStart(6),
      pct(max.accuracy).padStart(8),
      `${gain >= 0 ? '+' : ''}${(gain * 100).toFixed(1)}`.padStart(8),
      pct(score(subset).accuracy).padStart(11),
      `  ${mix}`,
    ];
    console.log(`    ${columns.join(' ')}`);
  }
  console.log('');
}

console.log('  Model tiers (by mean cost per prompt):');
for (const tier of TIERS) {
  const group = modelsByTier[tier];
  if (!group.length) continue;
  const lo = usd(group[0].meanCost * 1000);
  const hi = usd(group[group.length - 1].meanCost * 1000);
  console.log(`    ${tier.padEnd(9)} ${String(group.length).padStart(2)} models  ${lo}-${hi} /1k`);
}

console.log('\n  Strategy                    accuracy      $/1k prompts');
const line = (name, s) => console.log(`    ${name.padEnd(24)} ${pct(s.accuracy).padStart(7)}      ${usd(s.costPer1k).padStart(10)}`);
line('always-fast', constant.fast);
line('always-balanced', constant.balanced);
line('always-deep', constant.deep);
line('always-max', constant.max);
line('best single model', { accuracy: bestSingle.accuracy, costPer1k: bestSingle.meanCost * 1000 });
line('SWITCHBOARD', switchboard);
line('oracle (cheapest correct)', oracle);

line('ceiling (perfect ordering)', ceiling);

console.log(`\n  Switchboard accuracy 95% CI: ${pct(bootAccuracies[25])} - ${pct(bootAccuracies[975])} (bootstrap, n=1000)`);
if (matchedMix) {
  const delta = switchboard.accuracy - matchedMix.accuracy;
  console.log(
    `  Best random ${matchedMix.mix} mix at the same spend: ${pct(matchedMix.accuracy)}` +
      `  (Switchboard ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} points)`,
  );
}
const captured = (switchboard.accuracy - permMean) / (ceiling.accuracy - permMean || 1);
console.log(
  `  Headroom captured: ${(captured * 100).toFixed(1)}% ` +
    `(random ${pct(permMean)} -> Switchboard ${pct(switchboard.accuracy)} -> perfect ordering ${pct(ceiling.accuracy)})`,
);
console.log(`  Tier distribution: ${TIERS.map((t) => `${t}=${tierCounts[t]}`).join('  ')}`);
console.log(`  Oracle gap closed vs always-fast: ${(oracleGapClosed * 100).toFixed(1)}%`);
console.log(
  `\n  Random at matched cost (same tier mix, shuffled): ${pct(pooledPerm.mean)} [${pct(pooledPerm.low)} - ${pct(pooledPerm.high)}], p=${pValue.toFixed(3)}`,
);
if (withinPerm) {
  console.log(
    `  Random within each scenario (scenario tier mix held): ${pct(withinPerm.mean)} [${pct(withinPerm.low)} - ${pct(withinPerm.high)}], p=${withinPerm.p.toFixed(3)}`,
  );
}
if (distinctTiers <= 1) {
  console.log('  !! The router assigned every prompt to one tier on this corpus, so it is behaving as a constant');
  console.log('     router here and the permutation test cannot distinguish it from chance.');
} else if (pValue > 0.05) {
  console.log('  !! Switchboard is NOT distinguishable from a random router at the same cost on this corpus.');
} else {
  console.log('  Switchboard beats a random router at matched cost on this corpus.');
  if (withinPerm && withinPerm.p > 0.05) {
    console.log('  !! But NOT once the shuffle is stratified by scenario: the signal is between task types, not');
    console.log('     within them. On a corpus of one task type it would have nothing left to discriminate.');
  } else if (withinPerm) {
    console.log('  It also beats a shuffle stratified by scenario, so it orders prompts within a task type too.');
  }
}

console.log('\n  CAVEATS — read before quoting any number above:');
console.log('    - This corpus is an academic benchmark (short, self-contained, single-turn questions with a');
console.log('      verifiable answer). Switchboard targets agentic and authoring requests: multi-turn, with');
console.log('      attachments, and usually with no single correct answer. Treat these as a lower bound on a');
console.log('      distribution the router was not designed for, not as a headline quality claim.');
console.log('    - "correct" is benchmark correctness, which is not the same as "well routed".');
console.log('    - Tiers are assigned by price rank. A cost/quality inversion in the inventory puts a strictly');
console.log('      dominated model in a tier and penalises every strategy that selects it.');
console.log('    - Costs use LiteLLM list prices at fetch time and ignore caching, batching and discounts.');
console.log('      Absolute accuracies from two fetches months apart are not comparable: repricing moves the');
console.log('      price-ranked tier boundaries, and every strategy with them.');
console.log('    - HELM records no reasoning-effort label, so this evaluates the tier axis only.');
if (scenarioNames.length > 1) {
  console.log('    - Pooled scenarios are weighted by HELM instance count, which is arbitrary. Nothing here');
  console.log('      claims the mix resembles production traffic.');
  const metrics = new Set(rows.map((row) => row.metric));
  if (metrics.has('f1_score')) {
    console.log('    - This pool mixes binary metrics with continuous f1_score, so "accuracy" is a mean score,');
    console.log('      not a success rate. Check the per-scenario gain column: a negative gain means expensive');
    console.log('      models score WORSE there, and every strategy that upgrades is penalised for it.');
  }
}
console.log('');

if (strict && distinctTiers > 1 && pValue > 0.05) {
  console.error('FAIL (--strict): router is not distinguishable from random at matched cost.');
  process.exit(1);
}
