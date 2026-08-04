import type { ProxyUsage, ProxyWire } from './types.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function usageFromJson(wire: ProxyWire, value: unknown): ProxyUsage {
  const root = asRecord(value);
  const usage = asRecord(root?.usage) ?? asRecord(asRecord(root?.response)?.usage) ?? asRecord(asRecord(root?.message)?.usage);
  if (!usage) return { inputTokens: 0, outputTokens: 0 };
  if (wire === 'responses') {
    return {
      inputTokens: number(usage.input_tokens ?? usage.prompt_tokens),
      outputTokens: number(usage.output_tokens ?? usage.completion_tokens),
    };
  }
  return { inputTokens: number(usage.input_tokens), outputTokens: number(usage.output_tokens) };
}

export function usageFromSse(wire: ProxyWire, text: string): ProxyUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const line of text.split(/\r?\n/u)) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      const event: unknown = JSON.parse(raw);
      const usage = usageFromJson(wire, event);
      inputTokens = Math.max(inputTokens, usage.inputTokens);
      outputTokens = Math.max(outputTokens, usage.outputTokens);
      const record = asRecord(event);
      const deltaUsage = asRecord(asRecord(record?.delta)?.usage) ?? asRecord(record?.usage);
      if (deltaUsage) {
        inputTokens = Math.max(inputTokens, number(deltaUsage.input_tokens));
        outputTokens = Math.max(outputTokens, number(deltaUsage.output_tokens));
      }
    } catch {
      // Invalid or vendor-specific SSE events are ignored; forwarding remains lossless.
    }
  }
  return { inputTokens, outputTokens };
}
