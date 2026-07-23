import type { QualityTier, RoutingDecision, RoutingRequest, RoutingReason } from '../shared/types.js';
import { ROUTE_PROTOTYPES, TIER_ORDER, tierAtLeast } from '../router/policies.js';

export interface LocalModelOptions {
  enabled: boolean;
  judgeEnabled: boolean;
}

interface TensorLike {
  data: Float32Array | BigInt64Array | number[];
  dims?: number[];
  tolist?: () => unknown;
}

interface ModelOutput {
  logits?: TensorLike;
}

type FeatureExtractor = (input: string | string[], options?: Record<string, unknown>) => Promise<TensorLike>;
type Tokenizer = (input: string | string[], options?: Record<string, unknown>) => Record<string, unknown>;
type SequenceModel = (input: Record<string, unknown>) => Promise<ModelOutput>;
type TextGenerator = (input: string, options?: Record<string, unknown>) => Promise<unknown>;

interface TransformersModule {
  env: {
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
    localModelPath: string;
    useBrowserCache?: boolean;
    backends: { onnx: { wasm: { wasmPaths: string } } };
  };
  pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<unknown>;
  AutoTokenizer: { from_pretrained(model: string, options?: Record<string, unknown>): Promise<Tokenizer> };
  AutoModelForSequenceClassification: { from_pretrained(model: string, options?: Record<string, unknown>): Promise<SequenceModel> };
}

const SCOUT_ID = 'switchboard/scout';
const ARBITER_ID = 'switchboard/arbiter';
const JUDGE_ID = 'switchboard/judge';
const INITIALIZATION_TIMEOUT_MS = 45_000;
const INFERENCE_TIMEOUT_MS = 15_000;

let transformersPromise: Promise<TransformersModule> | null = null;
let scoutPromise: Promise<FeatureExtractor | null> | null = null;
let arbiterPromise: Promise<{ tokenizer: Tokenizer; model: SequenceModel } | null> | null = null;
let judgePromise: Promise<TextGenerator | null> | null = null;

function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error(`${label} timed out.`)), milliseconds);
    promise.then(
      (value) => { globalThis.clearTimeout(timer); resolve(value); },
      (error: unknown) => { globalThis.clearTimeout(timer); reject(error); },
    );
  });
}

async function transformers(): Promise<TransformersModule> {
  transformersPromise ??= import('@huggingface/transformers').then((module) => {
    const value = module as unknown as TransformersModule;
    value.env.allowRemoteModels = false;
    value.env.allowLocalModels = true;
    value.env.localModelPath = chrome.runtime.getURL('models/');
    value.env.useBrowserCache = false;
    value.env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('wasm/');
    return value;
  });
  return transformersPromise;
}

async function loadScout(): Promise<FeatureExtractor | null> {
  scoutPromise ??= (async () => {
    try {
      const library = await transformers();
      const pipeline = await withTimeout(
        library.pipeline('feature-extraction', SCOUT_ID, { dtype: 'q4', device: 'wasm' }),
        INITIALIZATION_TIMEOUT_MS,
        'Scout initialization',
      );
      return pipeline as FeatureExtractor;
    } catch {
      return null;
    }
  })();
  return scoutPromise;
}

async function loadArbiter(): Promise<{ tokenizer: Tokenizer; model: SequenceModel } | null> {
  arbiterPromise ??= (async () => {
    try {
      const library = await transformers();
      const [tokenizer, model] = await withTimeout(Promise.all([
        library.AutoTokenizer.from_pretrained(ARBITER_ID),
        library.AutoModelForSequenceClassification.from_pretrained(ARBITER_ID, { dtype: 'uint8', device: 'wasm' }),
      ]), INITIALIZATION_TIMEOUT_MS, 'Arbiter initialization');
      return { tokenizer, model };
    } catch {
      return null;
    }
  })();
  return arbiterPromise;
}

async function loadJudge(): Promise<TextGenerator | null> {
  judgePromise ??= (async () => {
    try {
      const library = await transformers();
      const pipeline = await withTimeout(
        library.pipeline('text-generation', JUDGE_ID, { dtype: 'q4f16', device: 'wasm' }),
        INITIALIZATION_TIMEOUT_MS * 2,
        'Judge initialization',
      );
      return pipeline as TextGenerator;
    } catch {
      return null;
    }
  })();
  return judgePromise;
}

function routingText(request: RoutingRequest): string {
  return [
    request.prompt,
    ...request.context.slice(-4).map((turn) => `${turn.role}: ${turn.text}`),
    ...request.files.map((file) => `File ${file.name} (${file.detectedType}): ${file.excerpt}`),
  ].filter(Boolean).join('\n').slice(0, 14_000);
}

function normalizeScores(values: Readonly<Record<QualityTier, number>>): Record<QualityTier, number> {
  const raw = TIER_ORDER.map((tier) => values[tier]);
  const max = Math.max(...raw);
  const exponentials = raw.map((value) => Math.exp(value - max));
  const total = exponentials.reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(TIER_ORDER.map((tier, index) => [tier, (exponentials[index] ?? 0) / total])) as Record<QualityTier, number>;
}

function tensorRows(tensor: TensorLike): number[][] {
  const nested = tensor.tolist?.();
  if (Array.isArray(nested) && Array.isArray(nested[0])) return nested as number[][];
  const data = Array.from(tensor.data, Number);
  const rows = tensor.dims?.[0] ?? 1;
  const columns = rows > 0 ? Math.floor(data.length / rows) : data.length;
  return Array.from({ length: rows }, (_, row) => data.slice(row * columns, (row + 1) * columns));
}

function dot(left: readonly number[], right: readonly number[]): number {
  let value = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) value += (left[index] ?? 0) * (right[index] ?? 0);
  return value;
}

async function scoutScores(text: string): Promise<Record<QualityTier, number> | null> {
  const scout = await loadScout();
  if (!scout) return null;
  try {
    const output = await withTimeout(
      scout([text, ...TIER_ORDER.map((tier) => ROUTE_PROTOTYPES[tier])], { pooling: 'mean', normalize: true }),
      INFERENCE_TIMEOUT_MS,
      'Scout inference',
    );
    const rows = tensorRows(output);
    const input = rows[0];
    if (!input) return null;
    const raw = {} as Record<QualityTier, number>;
    TIER_ORDER.forEach((tier, index) => { raw[tier] = dot(input, rows[index + 1] ?? []) * 5; });
    return normalizeScores(raw);
  } catch {
    return null;
  }
}

async function arbiterScores(text: string, candidates: readonly QualityTier[]): Promise<Partial<Record<QualityTier, number>> | null> {
  const arbiter = await loadArbiter();
  if (!arbiter || candidates.length === 0) return null;
  try {
    const features = arbiter.tokenizer(Array.from({ length: candidates.length }, () => text), {
      text_pair: candidates.map((tier) => ROUTE_PROTOTYPES[tier]),
      padding: true,
      truncation: true,
      max_length: 512,
    });
    const output = await withTimeout(arbiter.model(features), INFERENCE_TIMEOUT_MS, 'Arbiter inference');
    const logits = output.logits;
    if (!logits) return null;
    const values = Array.from(logits.data, Number);
    const raw: Partial<Record<QualityTier, number>> = {};
    candidates.forEach((tier, index) => { raw[tier] = values[index] ?? Number.NEGATIVE_INFINITY; });
    const complete = Object.fromEntries(TIER_ORDER.map((tier) => [tier, raw[tier] ?? -12])) as Record<QualityTier, number>;
    return normalizeScores(complete);
  } catch {
    return null;
  }
}

function generatedText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value) || value.length === 0) return '';
  const first = value[0];
  if (typeof first === 'string') return first;
  if (typeof first === 'object' && first !== null && 'generated_text' in first) {
    const generated = (first as { generated_text?: unknown }).generated_text;
    return typeof generated === 'string' ? generated : '';
  }
  return '';
}

async function judgeTier(text: string, candidates: readonly QualityTier[]): Promise<QualityTier | null> {
  const judge = await loadJudge();
  if (!judge) return null;
  const prompt = [
    'You are a routing classifier. Return only one lowercase tier name.',
    `Allowed tiers: ${candidates.join(', ')}.`,
    'Choose the least expensive tier that can complete the request accurately. Prefer stronger tiers for subtle, high-stakes, file-dependent, research, security, legal, medical, or complex coding work.',
    `Request:\n${text.slice(0, 6_000)}`,
    'Tier:',
  ].join('\n');
  try {
    const output = await withTimeout(judge(prompt, { max_new_tokens: 6, do_sample: false, return_full_text: false }), INFERENCE_TIMEOUT_MS * 2, 'Judge inference');
    const answer = generatedText(output).trim().toLowerCase();
    return candidates.find((tier) => answer.includes(tier)) ?? null;
  } catch {
    return null;
  }
}

function capabilityFloor(decision: RoutingDecision): QualityTier {
  let floor: QualityTier = 'fast';
  if (decision.capabilities.files) floor = 'balanced';
  if (decision.capabilities.vision || decision.capabilities.longContext || decision.capabilities.web) floor = 'deep';
  return floor;
}

function rank(scores: Readonly<Record<QualityTier, number>>): Array<{ tier: QualityTier; score: number }> {
  return TIER_ORDER.map((tier) => ({ tier, score: scores[tier] })).sort((left, right) => right.score - left.score);
}

function boundedDowngrade(candidate: QualityTier, baseline: QualityTier): QualityTier {
  const candidateIndex = TIER_ORDER.indexOf(candidate);
  const baselineIndex = TIER_ORDER.indexOf(baseline);
  return candidateIndex < baselineIndex - 1 ? (TIER_ORDER[baselineIndex - 1] ?? baseline) : candidate;
}

export async function enhanceDecisionWithLocalModels(
  request: RoutingRequest,
  baseline: RoutingDecision,
  options: LocalModelOptions,
): Promise<RoutingDecision> {
  if (!options.enabled) return baseline;
  const text = routingText(request);
  const scout = await scoutScores(text);
  if (!scout) return baseline;

  const scoutRanked = rank(scout);
  const candidateSet = new Set<QualityTier>([
    baseline.tier,
    ...scoutRanked.slice(0, 3).map((entry) => entry.tier),
  ]);
  const candidates = TIER_ORDER.filter((tier) => candidateSet.has(tier));
  const arbiter = await arbiterScores(text, candidates);
  const raw = {} as Record<QualityTier, number>;
  for (const tier of TIER_ORDER) {
    raw[tier] = baseline.scores[tier] * 0.5 + scout[tier] * 0.28 + (arbiter?.[tier] ?? 0) * 0.22;
  }
  let fused = normalizeScores(raw);
  let ranked = rank(fused);
  let selected = ranked[0]?.tier ?? baseline.tier;
  const margin = (ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0);
  let usedJudge = false;

  if (options.judgeEnabled && (baseline.shouldUseJudge || margin < 0.12)) {
    const judged = await judgeTier(text, TIER_ORDER.filter((tier) => TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(capabilityFloor(baseline))));
    if (judged) {
      raw[judged] += 0.45;
      fused = normalizeScores(raw);
      ranked = rank(fused);
      selected = ranked[0]?.tier ?? judged;
      usedJudge = true;
    }
  }

  selected = tierAtLeast(boundedDowngrade(selected, baseline.tier), capabilityFloor(baseline));
  const finalRanked = rank(fused);
  const finalMargin = (finalRanked[0]?.score ?? 0) - (finalRanked[1]?.score ?? 0);
  const reasons: RoutingReason[] = [
    ...baseline.reasons,
    { code: 'local-scout', detail: 'A packaged local semantic model compared the request with Switchboard route policies.', weight: 0.28 },
  ];
  if (arbiter) reasons.push({ code: 'local-arbiter', detail: 'A second packaged local cross-encoder independently ranked the strongest candidate routes.', weight: 0.22 });
  if (usedJudge) reasons.push({ code: 'local-judge', detail: 'The optional local judge resolved a low-confidence routing decision.', weight: 0.45 });

  return {
    ...baseline,
    tier: selected,
    effort: ({ fast: 'low', balanced: 'medium', deep: 'high', max: 'max' } as const)[selected],
    confidence: Math.min(0.98, Math.max(baseline.confidence, 0.62 + finalMargin * 1.6)),
    shouldUseJudge: !usedJudge && (baseline.shouldUseJudge || finalMargin < 0.12),
    reasons: reasons.sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight)),
    scores: fused,
  };
}

export function resetLocalModelRuntimeForTests(): void {
  transformersPromise = null;
  scoutPromise = null;
  arbiterPromise = null;
  judgePromise = null;
}
