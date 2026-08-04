import { stableDigest } from '../runtime/digest.js';
import type { RuntimeActionKind, RuntimeObservationStatus } from '../runtime/types.js';
import type { ExtractedObservation, ExtractedProxyRequest, ProxyWire } from './types.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (typeof block === 'string') return block;
      const record = asRecord(block);
      if (!record) return '';
      if (typeof record.text === 'string') return record.text;
      if (typeof record.content === 'string') return record.content;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function anthropicText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      const record = asRecord(block);
      return record?.type === 'text' && typeof record.text === 'string' ? record.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

export function inferActionKind(toolName: string): RuntimeActionKind {
  const name = toolName.toLowerCase();
  if (/test|verify|check|lint|typecheck|build/u.test(name)) return 'verify';
  if (/write|edit|patch|create|delete|move|rename/u.test(name)) return 'write';
  if (/read|fetch_file|open_file|cat/u.test(name)) return 'read';
  if (/search|find|grep|query|lookup|browse/u.test(name)) return 'search';
  if (/send|comment|reply|notify|message/u.test(name)) return 'communicate';
  if (/shell|exec|run|command|terminal/u.test(name)) return 'execute';
  return 'other';
}

function classifyOutput(output: unknown, explicitError = false): { status: RuntimeObservationStatus; errorClass?: string } {
  if (explicitError) return { status: 'failure', errorClass: errorClassFrom(output) };
  const record = asRecord(output);
  if (record) {
    if (record.is_error === true || record.error !== undefined || record.status === 'error' || record.ok === false) {
      return { status: 'failure', errorClass: errorClassFrom(record.error ?? output) };
    }
  }
  return { status: 'success' };
}

function errorClassFrom(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const match = text.match(/\b([A-Z][A-Za-z0-9]*(?:Error|Exception|Failure))\b/u);
  if (match?.[1]) return match[1];
  const status = text.match(/\b(?:HTTP\s*)?(4\d\d|5\d\d)\b/u);
  return status?.[1] ? `HTTP_${status[1]}` : 'ToolError';
}

function contextFromMessages(messages: Array<{ role: string; text: string }>): ExtractedProxyRequest['context'] {
  return messages
    .filter(
      (message): message is { role: 'user' | 'assistant'; text: string } =>
        (message.role === 'user' || message.role === 'assistant') && Boolean(message.text.trim()),
    )
    .slice(-8);
}

export function extractOpenAIResponses(body: Record<string, unknown>): ExtractedProxyRequest {
  const input = body.input;
  const items = Array.isArray(input) ? input : typeof input === 'string' ? [{ role: 'user', content: input }] : [];
  const calls = new Map<string, { name: string; arguments: unknown }>();
  const observations: ExtractedObservation[] = [];
  const messages: Array<{ role: string; text: string }> = [];
  for (const item of items) {
    const record = asRecord(item);
    if (!record) continue;
    if (typeof record.role === 'string') {
      const text = textFromContent(record.content);
      if (text) messages.push({ role: record.role, text });
    }
    if (record.type === 'function_call' && typeof record.call_id === 'string' && typeof record.name === 'string') {
      calls.set(record.call_id, { name: record.name, arguments: record.arguments });
    }
    if (record.type === 'function_call_output' && typeof record.call_id === 'string') {
      const call = calls.get(record.call_id);
      if (!call) continue;
      const classified = classifyOutput(record.output);
      observations.push({
        key: `responses:${record.call_id}`,
        input: {
          tool: call.name,
          kind: inferActionKind(call.name),
          status: classified.status,
          arguments: call.arguments,
          output: record.output,
          ...(classified.errorClass === undefined ? {} : { errorClass: classified.errorClass }),
        },
      });
    }
  }
  const prompt = [...messages].reverse().find((message) => message.role === 'user')?.text ?? '';
  const sessionHint =
    typeof body.prompt_cache_key === 'string' && body.prompt_cache_key.trim() ? body.prompt_cache_key.trim() : undefined;
  return {
    prompt,
    context: contextFromMessages(messages),
    observations,
    ...(sessionHint === undefined ? {} : { sessionHint }),
  };
}

export function extractAnthropicMessages(body: Record<string, unknown>): ExtractedProxyRequest {
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const calls = new Map<string, { name: string; input: unknown }>();
  const observations: ExtractedObservation[] = [];
  const messages: Array<{ role: string; text: string }> = [];
  for (const message of rawMessages) {
    const record = asRecord(message);
    if (!record || typeof record.role !== 'string') continue;
    const text = anthropicText(record.content);
    if (text) messages.push({ role: record.role, text });
    const blocks = Array.isArray(record.content) ? record.content : [];
    for (const block of blocks) {
      const item = asRecord(block);
      if (!item) continue;
      if (item.type === 'tool_use' && typeof item.id === 'string' && typeof item.name === 'string') {
        calls.set(item.id, { name: item.name, input: item.input });
      }
      if (item.type === 'tool_result' && typeof item.tool_use_id === 'string') {
        const call = calls.get(item.tool_use_id);
        if (!call) continue;
        const classified = classifyOutput(item.content, item.is_error === true);
        observations.push({
          key: `messages:${item.tool_use_id}`,
          input: {
            tool: call.name,
            kind: inferActionKind(call.name),
            status: classified.status,
            arguments: call.input,
            output: item.content,
            ...(classified.errorClass === undefined ? {} : { errorClass: classified.errorClass }),
          },
        });
      }
    }
  }
  const prompt = [...messages].reverse().find((message) => message.role === 'user')?.text ?? '';
  const metadata = asRecord(body.metadata);
  const hint = metadata?.session_id ?? metadata?.conversation_id;
  const sessionHint = typeof hint === 'string' && hint.trim() ? hint.trim() : undefined;
  return {
    prompt,
    context: contextFromMessages(messages),
    observations,
    ...(sessionHint === undefined ? {} : { sessionHint }),
  };
}

export function extractProxyRequest(wire: ProxyWire, body: Record<string, unknown>): ExtractedProxyRequest {
  return wire === 'responses' ? extractOpenAIResponses(body) : extractAnthropicMessages(body);
}

export function stableProxySessionId(input: {
  explicit?: string;
  hint?: string;
  wire: ProxyWire;
  prompt: string;
  clientFingerprint?: string;
}): string {
  const explicit = input.explicit?.trim() || input.hint?.trim();
  if (explicit) return explicit.slice(0, 160);
  return `sw_${stableDigest({ wire: input.wire, prompt: input.prompt, client: input.clientFingerprint ?? '' }).slice(0, 32)}`;
}

function sanitizeResponses(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.input)) return { ...body };
  const input = body.input.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    if (record.type === 'reasoning') return [];
    if (record.role === 'assistant') {
      if (!Array.isArray(record.content)) return [];
      const kept = record.content.filter((block) => {
        const typed = asRecord(block)?.type;
        return typed === 'function_call' || typed === 'tool_use';
      });
      return kept.length ? [{ ...record, content: kept }] : [];
    }
    return [item];
  });
  return { ...body, input };
}

function sanitizeMessages(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.messages)) return { ...body };
  const messages = body.messages.flatMap((message) => {
    const record = asRecord(message);
    if (!record || record.role !== 'assistant') return [message];
    if (!Array.isArray(record.content)) return [];
    const content = record.content.filter((block) => asRecord(block)?.type === 'tool_use');
    return content.length ? [{ ...record, content }] : [];
  });
  return { ...body, messages };
}

export function sanitizeForCleanRestart(wire: ProxyWire, body: Record<string, unknown>): Record<string, unknown> {
  return wire === 'responses' ? sanitizeResponses(body) : sanitizeMessages(body);
}
