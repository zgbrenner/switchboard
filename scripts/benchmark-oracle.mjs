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
 * READ THE CAVEATS THIS PRINTS. The corpus is a public academic benchmark, not the agentic and
 * authoring traffic Switchboard is designed for, and the gap matters when interpreting the numbers.
 */
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const TIERS = ['fast', 'balanced', 'deep', 'max'];
const dataPath = process.argv.find((a) => a.startsWith('--data='))?.slice('--data='.length) ?? 'benchmarks/data/helm-gsm.jsonl';
const strict = process.argv.includes('--strict');

if (!existsSync(dataPath)) {
  console.error(`No outcome data at ${dataPath}.\nRun: npm run eval:fetch\n`);
  process.exit(1);
}

if (!existsSync('.test-dist/router/route.js')) {
  const compile = spawnSync('tsc', ['-p', 'tsconfig.test.json'], { stdio: 'inherit', shell: process.platform === 'win32' });
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

const rows = (await readFile(dataPath, 'utf8'))
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((row) => row.priced && row.cost_usd !== null && row.prompt);

if (rows.length === 0) {
  console.error(`${dataPath} contained no priced rows.`);
  process.exit(1);
}

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
const byPrompt = new Map();
for (const row of rows) {
  const entry = byPrompt.get(row.instance_id) ?? { prompt: row.prompt, outcomes: new Map() };
  entry.outcomes.set(row.model, { correct: row.correct, cost: row.cost_usd });
  byPrompt.set(row.instance_id, entry);
}
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

// Oracle: cheapest model that actually answered correctly.
let oracleCorrect = 0;
let oracleCost = 0;
let unsolvable = 0;
for (const entry of prompts) {
  const winners = [...entry.outcomes.entries()].filter(([, o]) => o.correct === 1).sort((a, b) => a[1].cost - b[1].cost);
  if (winners.length === 0) {
    unsolvable++;
    continue;
  }
  oracleCorrect++;
  oracleCost += winners[0][1].cost;
}
const oracle = { accuracy: oracleCorrect / prompts.length, costPer1k: (oracleCost / prompts.length) * 1000 };

const bestSingle = models.reduce((a, b) => (b.accuracy > a.accuracy ? b : a));

// Random-at-matched-cost: keep the router's tier distribution, shuffle which prompt gets which.
// If the router carries no signal about difficulty, this scores the same and costs the same.
const random = lcg(20260728);
const PERMUTATIONS = 200;
const permutedAccuracies = [];
for (let iteration = 0; iteration < PERMUTATIONS; iteration++) {
  const shuffled = decisions.map((d) => d.tier);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  permutedAccuracies.push(score(decisions.map((d, i) => ({ entry: d.entry, tier: shuffled[i] }))).accuracy);
}
permutedAccuracies.sort((a, b) => a - b);
const permMean = permutedAccuracies.reduce((s, v) => s + v, 0) / permutedAccuracies.length;
const permLow = permutedAccuracies[Math.floor(0.025 * PERMUTATIONS)];
const permHigh = permutedAccuracies[Math.floor(0.975 * PERMUTATIONS)];
const betterThanChance = permutedAccuracies.filter((a) => a >= switchboard.accuracy).length;
const pValue = (betterThanChance + 1) / (PERMUTATIONS + 1);

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

console.log(`\nOutcome-labelled routing evaluation  (${dataPath})`);
console.log(`  ${prompts.length} prompts x ${models.length} priced models, dense matrix, ${unsolvable} prompt(s) no model solved\n`);

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

console.log(`\n  Switchboard accuracy 95% CI: ${pct(bootAccuracies[25])} - ${pct(bootAccuracies[975])} (bootstrap, n=1000)`);
console.log(`  Tier distribution: ${TIERS.map((t) => `${t}=${tierCounts[t]}`).join('  ')}`);
console.log(`  Oracle gap closed vs always-fast: ${(oracleGapClosed * 100).toFixed(1)}%`);
console.log(
  `\n  Random at matched cost (same tier mix, shuffled): ${pct(permMean)} [${pct(permLow)} - ${pct(permHigh)}], p=${pValue.toFixed(3)}`,
);
if (distinctTiers <= 1) {
  console.log('  !! The router assigned every prompt to one tier on this corpus, so it is behaving as a constant');
  console.log('     router here and the permutation test cannot distinguish it from chance.');
} else if (pValue > 0.05) {
  console.log('  !! Switchboard is NOT distinguishable from a random router at the same cost on this corpus.');
} else {
  console.log('  Switchboard beats a random router at matched cost on this corpus.');
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
console.log('    - HELM records no reasoning-effort label, so this evaluates the tier axis only.\n');

if (strict && distinctTiers > 1 && pValue > 0.05) {
  console.error('FAIL (--strict): router is not distinguishable from random at matched cost.');
  process.exit(1);
}
