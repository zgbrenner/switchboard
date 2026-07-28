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
 *   {instance_id, prompt, model, scenario, metric, correct, prompt_tokens, output_tokens,
 *    output_tokens_measured, cost_usd, priced}
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

async function findRuns(suite, scenario) {
  const runs = [];
  for (const version of await listPrefixes(`${suite}/benchmark_output/runs/`)) {
    for (const run of await listPrefixes(version)) {
      const leaf = run.replace(/\/$/, '').split('/').pop() ?? '';
      if (leaf.split(':')[0] !== scenario) continue;
      const model = /model=([^,/]+)/.exec(leaf)?.[1];
      if (model) runs.push({ model, run: run.replace(/\/$/, '') });
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
console.log(`  ${runs.length} runs across ${distinctModels} distinct models`);
if (runs.length === 0) {
  console.error(`No runs found for ${suite}:${scenario}. Check the scenario name.`);
  process.exit(1);
}

const priceIndex = buildPriceIndex(await getJson(PRICES_URL));
console.log(`  ${priceIndex.size} priced model names from LiteLLM`);

const prompts = new Map();
const rows = [];
let completed = 0;

for (const { model, run } of runs) {
  completed++;
  let predictions;
  try {
    predictions = await getJson(`${GCS_OBJECT}${run}/display_predictions.json`);
  } catch {
    console.log(`  [${completed}/${runs.length}] skip ${model} (incomplete upstream run)`);
    continue;
  }
  if (prompts.size === 0) {
    for (const instance of await getJson(`${GCS_OBJECT}${run}/instances.json`)) {
      if (instance?.id) prompts.set(instance.id, instance.input?.text ?? '');
    }
  }
  const price = priceIndex.get(normalizeName(model.split('_').pop() ?? model)) ?? priceIndex.get(normalizeName(model));
  for (const record of predictions) {
    const { metric, correct } = scoreOf(record.stats ?? {});
    if (correct === null) continue;
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
      metric,
      correct,
      prompt_tokens: promptTokens,
      output_tokens: outputTokens,
      output_tokens_measured: measured,
      cost_usd: price ? promptTokens * price.input_cost_per_token + outputTokens * price.output_cost_per_token : null,
      priced: Boolean(price),
    });
  }
  console.log(`  [${completed}/${runs.length}] ${model}: ${predictions.length} instances, priced=${Boolean(price)}`);
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
const priced = rows.filter((row) => row.priced).length;
const estimated = rows.filter((row) => !row.output_tokens_measured).length;
console.log(`\nWrote ${rows.length} (prompt x model) rows to ${out}`);
console.log(`  ${priced} rows carry a real USD cost; ${rows.length - priced} models are unpriced and are excluded from cost math.`);
console.log(`  ${estimated} rows have estimated output token counts (HELM recorded 0).`);
