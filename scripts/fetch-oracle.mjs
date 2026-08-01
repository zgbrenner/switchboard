/**
 * Build an outcome-labelled routing corpus from Stanford HELM's public results.
 *
 * Every number this produces was measured by Stanford CRFM when they ran the models, and is
 * republished verbatim. Nothing here calls a model, and no API key is required.
 *
 *   HELM    https://storage.googleapis.com/crfm-helm-public/<suite>/benchmark_output/runs/<ver>/<run>/
 *             instances.json           -> id, input.text (the clean prompt, no few-shot prefix)
 *             display_predictions.json -> instance_id, predicted_text,
 *                                         stats{<metric>, num_prompt_tokens, num_output_tokens}
 *   Prices  https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
 *
 * HELM instance ids are stable across suite versions, so one scenario yields a dense
 * (prompt x model) matrix. Output is JSONL, one row per (prompt, model) pair:
 *
 *   {instance_id, prompt, model, scenario, subset, metric, correct, prompt_tokens, output_tokens,
 *    output_tokens_measured, cost_usd, priced}
 *
 * `subset` matters. Several HELM scenarios are really a family of independent sub-scenarios --
 * `mmlu:subject=econometrics`, `legalbench:subset=proa` -- each with its OWN instance-id space
 * starting at `id0`. Instance ids are unique only within (scenario, subset), so both the fetcher
 * (which caches one instances.json per subset) and any consumer joining on prompt identity must key
 * on the pair. Decoding-only run parameters (`stop=none`) address the same instances and are
 * deliberately folded into the same subset.
 *
 * Usage:
 *   node scripts/fetch-oracle.mjs --scenario=gsm --suite=lite --out=benchmarks/data/helm-gsm.jsonl
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const GCS_LIST = 'https://storage.googleapis.com/storage/v1/b/crfm-helm-public/o';
const GCS_OBJECT = 'https://storage.googleapis.com/crfm-helm-public/';
const PRICES_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

/** Metric names HELM uses for binary correctness, in preference order. */
const SCORE_KEYS = ['final_number_exact_match', 'exact_match', 'quasi_exact_match', 'math_equiv_chain_of_thought'];

function flag(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function getJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
    }
  }
  throw lastError;
}

/** List pseudo-directories directly under a GCS prefix, following pagination. */
async function listPrefixes(prefix) {
  const output = [];
  let token;
  do {
    const url = `${GCS_LIST}?delimiter=%2F&maxResults=1000&prefix=${encodeURIComponent(prefix)}${token ? `&pageToken=${token}` : ''}`;
    const page = await getJson(url);
    output.push(...(page.prefixes ?? []));
    token = page.nextPageToken;
  } while (token);
  return output;
}

/**
 * The sub-scenario a run addresses: the run name's parameter list with the model and any
 * decoding-only parameter removed. `mmlu:subject=econometrics,method=multiple_choice_joint,model=x`
 * -> `subject=econometrics,method=multiple_choice_joint`; `gsm:model=x` and `gsm:,stop=none,model=x`
 * both -> `` (one instance set, two decoding configurations).
 */
function subsetOf(leaf) {
  return leaf
    .slice(leaf.indexOf(':') + 1)
    .replace(/,?model=[^,]+/, '')
    .replace(/,?stop=[^,]+/, '')
    .replace(/^,|,$/g, '');
}

async function findRuns(suite, scenario) {
  const runs = [];
  for (const version of await listPrefixes(`${suite}/benchmark_output/runs/`)) {
    for (const run of await listPrefixes(version)) {
      const leaf = run.replace(/\/$/, '').split('/').pop() ?? '';
      if (leaf.split(':')[0] !== scenario) continue;
      const model = /model=([^,/]+)/.exec(leaf)?.[1];
      if (model) runs.push({ model, subset: subsetOf(leaf), run: run.replace(/\/$/, '') });
    }
  }
  return runs;
}

function scoreOf(stats) {
  for (const key of SCORE_KEYS) {
    if (key in stats) return { metric: key, correct: stats[key] };
  }
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value === 'number' && (key.includes('match') || key.includes('accuracy') || key === 'f1_score')) {
      return { metric: key, correct: value };
    }
  }
  return { metric: null, correct: null };
}

const normalizeName = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Index LiteLLM prices by normalized name so HELM's `amazon_nova-pro-v1:0` finds `amazon.nova-pro-v1:0`.
 * Entries priced at zero are placeholders (several Llama-2/3 rows) and are dropped rather than trusted.
 */
function buildPriceIndex(prices) {
  const index = new Map();
  for (const [key, entry] of Object.entries(prices)) {
    if (!entry || typeof entry !== 'object') continue;
    const input = entry.input_cost_per_token;
    if (typeof input !== 'number' || input <= 0) continue;
    const last = normalizeName(key.split('/').pop() ?? key);
    if (!index.has(last)) index.set(last, entry);
    const whole = normalizeName(key);
    if (!index.has(whole)) index.set(whole, entry);
  }
  return index;
}

const suite = flag('suite', 'lite');
const scenario = flag('scenario', 'gsm');
const out = flag('out', `benchmarks/data/helm-${scenario}.jsonl`);

console.log(`Discovering ${suite}:${scenario} runs in the HELM public bucket...`);
const runs = await findRuns(suite, scenario);
const distinctModels = new Set(runs.map((entry) => entry.model)).size;
const distinctSubsets = new Set(runs.map((entry) => entry.subset)).size;
console.log(`  ${runs.length} runs across ${distinctModels} distinct models and ${distinctSubsets} sub-scenario(s)`);
if (runs.length === 0) {
  console.error(`No runs found for ${suite}:${scenario}. Check the scenario name.`);
  process.exit(1);
}

const priceIndex = buildPriceIndex(await getJson(PRICES_URL));
console.log(`  ${priceIndex.size} priced model names from LiteLLM`);

/** One prompt map per sub-scenario: instance ids restart at `id0` in each, so they cannot share one. */
const promptsBySubset = new Map();
const rows = [];
const seen = new Set();
let completed = 0;
let duplicates = 0;

for (const { model, subset, run } of runs) {
  completed++;
  let predictions;
  try {
    predictions = await getJson(`${GCS_OBJECT}${run}/display_predictions.json`);
  } catch {
    console.log(`  [${completed}/${runs.length}] skip ${model} (incomplete upstream run)`);
    continue;
  }
  let prompts = promptsBySubset.get(subset);
  if (!prompts) {
    prompts = new Map();
    for (const instance of await getJson(`${GCS_OBJECT}${run}/instances.json`)) {
      if (instance?.id) prompts.set(instance.id, instance.input?.text ?? '');
    }
    promptsBySubset.set(subset, prompts);
  }
  const price = priceIndex.get(normalizeName(model.split('_').pop() ?? model)) ?? priceIndex.get(normalizeName(model));
  for (const record of predictions) {
    const { metric, correct } = scoreOf(record.stats ?? {});
    if (correct === null) continue;
    // A handful of models were run twice on the same sub-scenario under different decoding configs
    // (`stop=none`). Keep the first observation so the matrix stays single-valued per cell.
    const cell = `${subset}\u0000${record.instance_id}\u0000${model}`;
    if (seen.has(cell)) {
      duplicates++;
      continue;
    }
    seen.add(cell);
    const promptTokens = record.stats?.num_prompt_tokens ?? 0;
    const measured = Boolean(record.stats?.num_output_tokens);
    // HELM records num_output_tokens as 0 for a sizeable minority of runs. Fall back to a
    // ~4-characters-per-token estimate over the text actually returned, and flag it as estimated.
    const outputTokens = record.stats?.num_output_tokens || Math.round((record.predicted_text ?? '').length / 4);
    rows.push({
      instance_id: record.instance_id,
      prompt: prompts.get(record.instance_id) ?? null,
      model,
      scenario,
      subset,
      metric,
      correct,
      prompt_tokens: promptTokens,
      output_tokens: outputTokens,
      output_tokens_measured: measured,
      cost_usd: price ? promptTokens * price.input_cost_per_token + outputTokens * price.output_cost_per_token : null,
      priced: Boolean(price),
    });
  }
  console.log(
    `  [${completed}/${runs.length}] ${model} ${subset || '(single subset)'}: ${predictions.length} instances, priced=${Boolean(price)}`,
  );
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
const priced = rows.filter((row) => row.priced).length;
const estimated = rows.filter((row) => !row.output_tokens_measured).length;
const instances = new Set(rows.map((row) => `${row.subset} ${row.instance_id}`)).size;
console.log(`\nWrote ${rows.length} (prompt x model) rows to ${out}`);
console.log(`  ${instances} distinct prompts across ${promptsBySubset.size} sub-scenario(s).`);
console.log(`  ${priced} rows carry a real USD cost; ${rows.length - priced} models are unpriced and are excluded from cost math.`);
console.log(`  ${estimated} rows have estimated output token counts (HELM recorded 0).`);
if (duplicates > 0)
  console.log(`  ${duplicates} duplicate (subset, instance, model) cells dropped (same model run under two decoding configs).`);
