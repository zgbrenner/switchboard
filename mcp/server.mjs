import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const routerModuleUrl = process.env.SWITCHBOARD_ROUTER_MODULE
  ? pathToFileURL(resolve(process.cwd(), process.env.SWITCHBOARD_ROUTER_MODULE)).href
  : new URL('../dist/js/router/route.js', import.meta.url).href;
const { routeRequest } = await import(routerModuleUrl);
import { normalizeRouteArguments, ROUTE_INPUT_SCHEMA, ROUTE_OUTPUT_SCHEMA } from './schema.mjs';

export const CURRENT_PROTOCOL_VERSION = '2025-11-25';
export const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-11-25', '2025-06-18', '2025-03-26']);
export const SERVER_INFO = { name: 'switchboard', title: 'Switchboard Router', version: '0.3.0', description: 'Local privacy-first request routing for AI hosts.' };

const POLICIES = {
  best: 'Prefer higher-quality routes when they can materially improve the result.',
  balanced: 'Balance quality, latency, and premium model usage.',
  fast: 'Prefer the fastest adequate route while preserving hard capability floors.',
  conserve: 'Conserve stronger or premium model usage unless it is required.',
};

const CAPABILITIES = {
  web: 'Requires current web research or externally verified information.',
  files: 'Requires a host or model that can access attached files.',
  vision: 'Requires visual understanding of an image, screenshot, chart, or visual document.',
  longContext: 'Requires substantial context capacity for a long prompt, conversation, or document.',
  code: 'Requires code-aware reasoning or software-development capability.',
};

function success(id, result) { return { jsonrpc: '2.0', id, result }; }
function failure(id, code, message, data) { return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } }; }
function paramsObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

function toolError(id, message) {
  return success(id, { content: [{ type: 'text', text: message }], isError: true });
}

function routeToolDefinition() {
  return {
    name: 'route_request',
    title: 'Route AI Request',
    description: 'Classify a request locally and return the recommended abstract quality tier, effort, capabilities, confidence, and routing reasons. Call this before answering when the host can choose among models or reasoning levels.',
    inputSchema: ROUTE_INPUT_SCHEMA,
    outputSchema: ROUTE_OUTPUT_SCHEMA,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  };
}

export function createSwitchboardMcpSession(options = {}) {
  const route = options.route ?? routeRequest;
  let protocolVersion = CURRENT_PROTOCOL_VERSION;

  async function handle(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return failure(message?.id, -32600, 'Invalid Request');
    }
    const isNotification = message.id === undefined;
    const id = message.id;
    const params = paramsObject(message.params);

    try {
      switch (message.method) {
        case 'initialize': {
          if (isNotification) return null;
          const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : CURRENT_PROTOCOL_VERSION;
          protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : CURRENT_PROTOCOL_VERSION;
          return success(id, {
            protocolVersion,
            capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: SERVER_INFO,
            instructions: 'Use route_request before a task when model or reasoning selection is available. Treat its tier and capability requirements as advisory routing metadata; the MCP host remains responsible for selecting and invoking a model.',
          });
        }
        case 'notifications/initialized':
        case 'notifications/cancelled':
          return null;
        case 'ping':
          return isNotification ? null : success(id, {});
        case 'tools/list':
          return isNotification ? null : success(id, { tools: [routeToolDefinition()] });
        case 'tools/call': {
          if (isNotification) return null;
          if (params.name !== 'route_request') return failure(id, -32602, 'Unknown tool', { name: params.name });
          try {
            const normalized = normalizeRouteArguments(params.arguments);
            const decision = await route(normalized);
            const text = JSON.stringify(decision, null, 2);
            return success(id, { content: [{ type: 'text', text }], structuredContent: decision, isError: false });
          } catch (error) {
            return toolError(id, error instanceof Error ? error.message : 'Invalid route_request arguments.');
          }
        }
        case 'resources/list':
          return isNotification ? null : success(id, { resources: [
            { uri: 'switchboard://policies', name: 'policies', title: 'Switchboard Routing Policies', description: 'Available local routing policies.', mimeType: 'application/json' },
            { uri: 'switchboard://capabilities', name: 'capabilities', title: 'Switchboard Capability Requirements', description: 'Capability flags returned by the router.', mimeType: 'application/json' },
          ] });
        case 'resources/read': {
          if (isNotification) return null;
          const uri = params.uri;
          if (uri === 'switchboard://policies') return success(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(POLICIES, null, 2) }] });
          if (uri === 'switchboard://capabilities') return success(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(CAPABILITIES, null, 2) }] });
          return failure(id, -32002, 'Resource not found', { uri });
        }
        case 'prompts/list':
          return isNotification ? null : success(id, { prompts: [{
            name: 'route_before_answering',
            title: 'Route Before Answering',
            description: 'Ask the host to classify a task with Switchboard before answering it.',
            arguments: [
              { name: 'request', description: 'The request to route and then complete.', required: true },
              { name: 'policy', description: 'Optional policy: best, balanced, fast, or conserve.', required: false },
            ],
          }] });
        case 'prompts/get': {
          if (isNotification) return null;
          if (params.name !== 'route_before_answering') return failure(id, -32602, 'Invalid prompt name', { name: params.name });
          const args = paramsObject(params.arguments);
          const request = typeof args.request === 'string' && args.request.trim() ? args.request.trim() : null;
          if (!request) return failure(id, -32602, 'The request argument is required.');
          const policy = typeof args.policy === 'string' && ['best', 'balanced', 'fast', 'conserve'].includes(args.policy) ? args.policy : 'balanced';
          return success(id, {
            description: 'Route the request locally before completing it.',
            messages: [{ role: 'user', content: { type: 'text', text: `Call the Switchboard route_request tool with policy "${policy}" for the request below. Use the returned tier, effort, and capability requirements when the host supports model selection. Then complete the original request.\n\n${request}` } }],
          });
        }
        default:
          return isNotification ? null : failure(id, -32601, 'Method not found', { method: message.method });
      }
    } catch (error) {
      return isNotification ? null : failure(id, -32603, 'Internal error', { message: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  return { handle, get protocolVersion() { return protocolVersion; } };
}
