import type { ProxyRequestRequirements, ProxyUpstreamPool, ProxyUpstreamRoute, ProxyWire } from './types.js';

interface Measurement {
  characters: number;
  images: number;
}

export interface ProxyRequirementOptions {
  requireZeroDataRetention?: boolean;
}

export interface ProxyCompatibilityOptions {
  strictCapabilities?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function combine(left: Measurement, right: Measurement): Measurement {
  return { characters: left.characters + right.characters, images: left.images + right.images };
}

function measure(value: unknown): Measurement {
  if (typeof value === 'string') return { characters: value.length, images: 0 };
  if (Array.isArray(value)) return value.reduce<Measurement>((total, item) => combine(total, measure(item)), { characters: 0, images: 0 });
  const record = asRecord(value);
  if (!record) return { characters: 0, images: 0 };
  const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
  if (['image', 'input_image', 'image_url'].includes(type)) return { characters: 0, images: 1 };
  let result: Measurement = { characters: 0, images: 0 };
  for (const [key, item] of Object.entries(record)) {
    if (['data', 'image_url'].includes(key) && typeof item === 'string') {
      result = combine(result, { characters: 0, images: 1 });
      continue;
    }
    result = combine(result, measure(item));
  }
  return result;
}

function positiveTokenLimit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function hasTools(body: Record<string, unknown>): boolean {
  return Array.isArray(body.tools) && body.tools.length > 0;
}

function hasVision(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => hasVision(item));
  const record = asRecord(value);
  if (!record) return false;
  const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
  if (['image', 'input_image', 'image_url'].includes(type)) return true;
  if (typeof record.image_url === 'string' || asRecord(record.source)?.type === 'base64') return true;
  return Object.values(record).some((item) => hasVision(item));
}

function responsesJson(body: Record<string, unknown>): boolean {
  const responseFormat = asRecord(body.response_format);
  const textFormat = asRecord(asRecord(body.text)?.format);
  const type = responseFormat?.type ?? textFormat?.type;
  return type === 'json_schema' || type === 'json_object';
}

function messagesJson(body: Record<string, unknown>): boolean {
  const outputConfig = asRecord(body.output_config);
  const format = asRecord(outputConfig?.format) ?? asRecord(body.output_format);
  const type = format?.type;
  return type === 'json_schema' || type === 'json_object';
}

function responsesReasoning(body: Record<string, unknown>): boolean {
  return asRecord(body.reasoning) !== undefined || typeof body.reasoning_effort === 'string';
}

function messagesReasoning(body: Record<string, unknown>): boolean {
  const thinking = asRecord(body.thinking);
  return thinking?.type === 'enabled' || positiveTokenLimit(thinking?.budget_tokens) > 0;
}

export function extractProxyRequirements(
  wire: ProxyWire,
  body: Record<string, unknown>,
  options: ProxyRequirementOptions = {},
): ProxyRequestRequirements {
  const content = wire === 'responses' ? body.input : body.messages;
  const measured = combine(measure(content), combine(measure(body.instructions), measure(body.tools)));
  const maxOutputTokens = positiveTokenLimit(wire === 'responses' ? body.max_output_tokens : body.max_tokens);
  return {
    tools: hasTools(body),
    vision: hasVision(content),
    json: wire === 'responses' ? responsesJson(body) : messagesJson(body),
    reasoning: wire === 'responses' ? responsesReasoning(body) : messagesReasoning(body),
    estimatedInputTokens: Math.max(1, Math.ceil(measured.characters / 4) + measured.images * 1_000),
    maxOutputTokens,
    zeroDataRetention: options.requireZeroDataRetention ?? false,
  };
}

function booleanCompatible(required: boolean, actual: boolean | undefined, strict: boolean): boolean {
  if (!required) return true;
  if (actual === false) return false;
  return !strict || actual === true;
}

function compatible(upstream: ProxyUpstreamRoute, requirements: ProxyRequestRequirements, strict: boolean): boolean {
  const capabilities = upstream.capabilities;
  const reasoning = capabilities.reasoning ?? (upstream.reasoningEffort ? true : undefined);
  if (!booleanCompatible(requirements.tools, capabilities.tools, strict)) return false;
  if (!booleanCompatible(requirements.vision, capabilities.vision, strict)) return false;
  if (!booleanCompatible(requirements.json, capabilities.json, strict)) return false;
  if (!booleanCompatible(requirements.reasoning, reasoning, strict)) return false;
  if (capabilities.maxContextTokens !== undefined && requirements.estimatedInputTokens > capabilities.maxContextTokens) return false;
  if (
    requirements.maxOutputTokens > 0 &&
    capabilities.maxOutputTokens !== undefined &&
    requirements.maxOutputTokens > capabilities.maxOutputTokens
  ) {
    return false;
  }
  if (requirements.zeroDataRetention && capabilities.dataRetention !== 'zero') return false;
  return true;
}

export function filterCompatibleUpstreams(
  upstreams: ProxyUpstreamPool,
  requirements: ProxyRequestRequirements,
  options: ProxyCompatibilityOptions = {},
): ProxyUpstreamPool {
  const strict = options.strictCapabilities ?? false;
  return upstreams.filter((upstream) => compatible(upstream, requirements, strict));
}
