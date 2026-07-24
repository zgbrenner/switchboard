import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const routerModuleUrl = process.env.SWITCHBOARD_ROUTER_MODULE
  ? pathToFileURL(resolve(process.cwd(), process.env.SWITCHBOARD_ROUTER_MODULE)).href
  : new URL('../dist/js/router/route.js', import.meta.url).href;
const { routeRequest } = await import(routerModuleUrl);
import { resolveModelInventory } from './models.mjs';
import { normalizeRouteArguments, ROUTE_INPUT_SCHEMA, ROUTE_OUTPUT_SCHEMA } from './schema.mjs';

export const CURRENT_PROTOCOL_VERSION = '2025-11-25';
export const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-11-25', '2025-06-18', '2025-03-26']);
export const SERVER_INFO = {
  name: 'switchboard',
  title: 'Switchboard Router',
  version: '0.4.0',
  description: 'Local privacy-first request and model routing for AI hosts.',
  websiteUrl: 'https://github.com/zgbrenner/switchboard',
};

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

const SERVER_METADATA = {
  server: SERVER_INFO,
  protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
  transports: ['stdio', 'streamable-http'],
  privacy: {
    localRouting: true,
    persistsPrompts: false,
    persistsContext: false,
    persistsFileExcerpts: false,
    persistsModelInventories: false,
    telemetry: false,
    remoteInference: false,
  },
};

function success(id, result) { return { jsonrpc: '2.0', id, result }; }
function failure(id, code, message, data) { return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } }; }
function paramsObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
function validId(value) { return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)); }

function toolError(id, message) {
  return success(id, { content: [{ type: 'text', text: message }], isError: true });
}

function routeToolDefinition() {
  return {
    name: 'route_request',
    title: 'Route AI Request',
    description: 'Classify a request locally and return the recommended abstract quality tier, effort, capabilities, confidence, reasons, and an optional concrete recommendation from a host-supplied model inventory.',
    inputSchema: ROUTE_INPUT_SCHEMA,
    outputSchema: ROUTE_OUTPUT_SCHEMA,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  };
}

function initializationParams(params) {
  if (!params) throw new Error('initialize params must be an object.');
  if (typeof params.protocolVersion !== 'string' || !params.protocolVersion) throw new Error('initialize.protocolVersion is required.');
  if (!params.capabilities || typeof params.capabilities !== 'object' || Array.isArray(params.capabilities)) throw new Error('initialize.capabilities must be an object.');
  if (!params.clientInfo || typeof params.clientInfo !== 'object' || Array.isArray(params.clientInfo)) throw new Error('initialize.clientInfo must be an object.');
  if (typeof params.clientInfo.name !== 'string' || !params.clientInfo.name || typeof params.clientInfo.version !== 'string' || !params.clientInfo.version) {
    throw new Error('initialize.clientInfo requires name and version.');
  }
  return params;
}

function policyCompletion(params) {
  const ref = params?.ref;
  const argument = params?.argument;
  if (!ref || ref.type !== 'ref/prompt' || ref.name !== 'route_before_answering') throw new Error('Completion reference is unsupported.');
  if (!argument || argument.name !== 'policy' || typeof argument.value !== 'string') throw new Error('Completion supports the policy prompt argument.');
  const prefix = argument.value.toLowerCase();
  const values = Object.keys(POLICIES).filter((value) => value.startsWith(prefix)).sort();
  return { completion: { values, total: values.length, hasMore: false } };
}

export function createSwitchboardMcpSession(options = {}) {
  const route = options.route ?? routeRequest;
  const lifecycle = options.lifecycle ?? 'stateful';
  let protocolVersion = CURRENT_PROTOCOL_VERSION;
  let phase = lifecycle === 'stateless' ? 'ready' : 'new';

  async function handle(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || !message.method) {
      return failure(message?.id, -32600, 'Invalid Request');
    }
    const isNotification = message.id === undefined;
    if (!isNotification && !validId(message.id)) return failure(null, -32600, 'Invalid Request', { message: 'id must be a string or finite number.' });
    if (message.params !== undefined && paramsObject(message.params) === null) return isNotification ? null : failure(message.id, -32602, 'Invalid params', { message: 'params must be an object.' });
    const id = message.id;
    const params = paramsObject(message.params) ?? {};

    if (lifecycle === 'stateful') {
      if (phase === 'new' && !['initialize', 'ping'].includes(message.method)) {
        return isNotification ? null : failure(id, -32002, 'Server not initialized', { requiredMethod: 'initialize' });
      }
      if (phase === 'initializing' && !['notifications/initialized', 'notifications/cancelled', 'ping'].includes(message.method)) {
        return isNotification ? null : failure(id, -32002, 'Server is waiting for the initialized notification');
      }
    }

    try {
      switch (message.method) {
        case 'initialize': {
          if (isNotification) return null;
          if (lifecycle === 'stateful' && phase !== 'new') return failure(id, -32600, 'Server is already initialized');
          const initialize = initializationParams(params);
          const requested = initialize.protocolVersion;
          protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : CURRENT_PROTOCOL_VERSION;
          if (lifecycle === 'stateful') phase = 'initializing';
          return success(id, {
            protocolVersion,
            capabilities: { tools: {}, resources: {}, prompts: {}, completions: {} },
            serverInfo: SERVER_INFO,
            instructions: 'Use route_request before a task when model or reasoning selection is available. Treat its routing and model recommendations as advisory metadata; the MCP host remains responsible for selecting and invoking a model.',
          });
        }
        case 'notifications/initialized':
          if (lifecycle === 'stateful' && phase === 'initializing') phase = 'ready';
          return null;
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
            const decision = await route(normalized.request);
            const modelResolution = resolveModelInventory(decision, normalized.availableModels, {
              policy: normalized.request.preferences.policy,
              currentModelId: normalized.currentModelId,
              hasContext: normalized.request.context.length > 0,
            });
            const result = { ...decision, modelResolution };
            return success(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false });
          } catch (error) {
            return toolError(id, error instanceof Error ? error.message : 'Invalid route_request arguments.');
          }
        }
        case 'resources/list':
          return isNotification ? null : success(id, { resources: [
            { uri: 'switchboard://policies', name: 'policies', title: 'Switchboard Routing Policies', description: 'Available local routing policies.', mimeType: 'application/json' },
            { uri: 'switchboard://capabilities', name: 'capabilities', title: 'Switchboard Capability Requirements', description: 'Capability flags returned by the router.', mimeType: 'application/json' },
            { uri: 'switchboard://server', name: 'server', title: 'Switchboard Server Metadata', description: 'Supported protocols, transports, version, and privacy guarantees.', mimeType: 'application/json' },
          ] });
        case 'resources/read': {
          if (isNotification) return null;
          const uri = params.uri;
          if (uri === 'switchboard://policies') return success(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(POLICIES, null, 2) }] });
          if (uri === 'switchboard://capabilities') return success(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(CAPABILITIES, null, 2) }] });
          if (uri === 'switchboard://server') return success(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(SERVER_METADATA, null, 2) }] });
          return failure(id, -32002, 'Resource not found', { uri });
        }
        case 'prompts/list':
          return isNotification ? null : success(id, { prompts: [{
            name: 'route_before_answering', title: 'Route Before Answering', description: 'Ask the host to classify a task with Switchboard before answering it.',
            arguments: [
              { name: 'request', description: 'The request to route and then complete.', required: true },
              { name: 'policy', description: 'Optional policy: best, balanced, fast, or conserve.', required: false },
            ],
          }] });
        case 'prompts/get': {
          if (isNotification) return null;
          if (params.name !== 'route_before_answering') return failure(id, -32602, 'Invalid prompt name', { name: params.name });
          const args = paramsObject(params.arguments) ?? {};
          const request = typeof args.request === 'string' && args.request.trim() ? args.request.trim() : null;
          if (!request) return failure(id, -32602, 'The request argument is required.');
          const policy = typeof args.policy === 'string' && Object.hasOwn(POLICIES, args.policy) ? args.policy : 'balanced';
          return success(id, {
            description: 'Route the request locally before completing it.',
            messages: [{ role: 'user', content: { type: 'text', text: `Call the Switchboard route_request tool with policy "${policy}" for the request below. Use the returned tier, effort, capability requirements, and model recommendation when the host supports them. Then complete the original request.\n\n${request}` } }],
          });
        }
        case 'completion/complete':
          return isNotification ? null : success(id, policyCompletion(params));
        default:
          return isNotification ? null : failure(id, -32601, 'Method not found', { method: message.method });
      }
    } catch (error) {
      return isNotification ? null : failure(id, -32602, 'Invalid params', { message: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  return {
    handle,
    get protocolVersion() { return protocolVersion; },
    get phase() { return phase; },
  };
}
