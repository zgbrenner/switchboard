import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getPreferenceStore } from '../learning.mjs';
import { listProfiles } from '../profiles.mjs';
import { POLICIES } from '../schema.mjs';
import {
  ADAPTER_CONTRACT, API_METADATA, CAPABILITY_DESCRIPTIONS, CURRENT_PROTOCOL_VERSION,
  POLICY_DESCRIPTIONS, SERVER_INFO, SERVER_METADATA, SUPPORTED_PROTOCOL_VERSIONS,
} from './metadata.mjs';
import { createToolDispatcher, toolDefinitions } from './tools.mjs';

const routerModuleUrl = process.env.SWITCHBOARD_ROUTER_MODULE
  ? pathToFileURL(resolve(process.cwd(), process.env.SWITCHBOARD_ROUTER_MODULE)).href
  : new URL('../../dist/js/router/route.js', import.meta.url).href;
const { routeRequest } = await import(routerModuleUrl);

function success(id, result) { return { jsonrpc: '2.0', id, result }; }
function failure(id, code, message, data) { return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } }; }
function paramsObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
function validId(value) { return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)); }
function toolResult(value) { return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value, isError: false }; }
function toolError(message) { return { content: [{ type: 'text', text: message }], isError: true }; }

function initializationParams(params) {
  if (!params) throw new Error('initialize params must be an object.');
  if (typeof params.protocolVersion !== 'string' || !params.protocolVersion) throw new Error('initialize.protocolVersion is required.');
  if (!params.capabilities || typeof params.capabilities !== 'object' || Array.isArray(params.capabilities)) throw new Error('initialize.capabilities must be an object.');
  if (!params.clientInfo || typeof params.clientInfo !== 'object' || Array.isArray(params.clientInfo)) throw new Error('initialize.clientInfo must be an object.');
  if (typeof params.clientInfo.name !== 'string' || !params.clientInfo.name || typeof params.clientInfo.version !== 'string' || !params.clientInfo.version) throw new Error('initialize.clientInfo requires name and version.');
  return params;
}

function completion(params) {
  const ref = params?.ref;
  const argument = params?.argument;
  if (!ref || ref.type !== 'ref/prompt' || ref.name !== 'route_before_answering') throw new Error('Completion reference is unsupported.');
  if (!argument || typeof argument.value !== 'string') throw new Error('Completion requires an argument value.');
  const prefix = argument.value.toLowerCase();
  const source = argument.name === 'policy' ? POLICIES : argument.name === 'profile' ? listProfiles().map((profile) => profile.name) : null;
  if (!source) throw new Error('Completion supports policy and profile prompt arguments.');
  const values = source.filter((value) => value.startsWith(prefix)).sort();
  return { completion: { values, total: values.length, hasMore: false } };
}

export function createSwitchboardMcpSession(options = {}) {
  const route = options.route ?? routeRequest;
  const lifecycle = options.lifecycle ?? 'stateful';
  const preferenceStore = options.preferenceStore ?? getPreferenceStore(options.preferencePath);
  const callTool = createToolDispatcher({ route, preferenceStore });
  let protocolVersion = CURRENT_PROTOCOL_VERSION;
  let phase = lifecycle === 'stateless' ? 'ready' : 'new';

  async function handle(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || !message.method) return failure(message?.id, -32600, 'Invalid Request');
    const isNotification = message.id === undefined;
    if (!isNotification && !validId(message.id)) return failure(null, -32600, 'Invalid Request', { message: 'id must be a string or finite number.' });
    if (message.params !== undefined && paramsObject(message.params) === null) return isNotification ? null : failure(message.id, -32602, 'Invalid params', { message: 'params must be an object.' });
    const id = message.id;
    const params = paramsObject(message.params) ?? {};

    if (lifecycle === 'stateful') {
      if (phase === 'new' && !['initialize', 'ping'].includes(message.method)) return isNotification ? null : failure(id, -32002, 'Server not initialized', { requiredMethod: 'initialize' });
      if (phase === 'initializing' && !['notifications/initialized', 'notifications/cancelled', 'ping'].includes(message.method)) return isNotification ? null : failure(id, -32002, 'Server is waiting for the initialized notification');
    }

    try {
      switch (message.method) {
        case 'initialize': {
          if (isNotification) return null;
          if (lifecycle === 'stateful' && phase !== 'new') return failure(id, -32600, 'Server is already initialized');
          const initialize = initializationParams(params);
          protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(initialize.protocolVersion) ? initialize.protocolVersion : CURRENT_PROTOCOL_VERSION;
          if (lifecycle === 'stateful') phase = 'initializing';
          return success(id, {
            protocolVersion,
            capabilities: { tools: {}, resources: {}, prompts: {}, completions: {} },
            serverInfo: SERVER_INFO,
            instructions: 'Call route_request before a task when model or reasoning selection is available. Switchboard recommendations and execution plans are advisory; the host remains responsible for choosing and invoking a model.',
          });
        }
        case 'notifications/initialized':
          if (lifecycle === 'stateful' && phase === 'initializing') phase = 'ready';
          return null;
        case 'notifications/cancelled': return null;
        case 'ping': return isNotification ? null : success(id, {});
        case 'tools/list': return isNotification ? null : success(id, { tools: toolDefinitions() });
        case 'tools/call': {
          if (isNotification) return null;
          try { return success(id, toolResult(await callTool(params.name, params.arguments ?? {}))); }
          catch (error) { return success(id, toolError(error instanceof Error ? error.message : 'Tool call failed.')); }
        }
        case 'resources/list':
          return isNotification ? null : success(id, { resources: [
            { uri: 'switchboard://policies', name: 'policies', title: 'Switchboard Routing Policies', mimeType: 'application/json' },
            { uri: 'switchboard://profiles', name: 'profiles', title: 'Switchboard Routing Profiles', mimeType: 'application/json' },
            { uri: 'switchboard://capabilities', name: 'capabilities', title: 'Switchboard Capability Requirements', mimeType: 'application/json' },
            { uri: 'switchboard://api', name: 'api', title: 'Switchboard API Compatibility', mimeType: 'application/json' },
            { uri: 'switchboard://adapter-contract', name: 'adapter-contract', title: 'Switchboard Host Model Adapter Contract', mimeType: 'application/json' },
            { uri: 'switchboard://preferences', name: 'preferences', title: 'Switchboard Aggregate Preference State', mimeType: 'application/json' },
            { uri: 'switchboard://server', name: 'server', title: 'Switchboard Server Metadata', mimeType: 'application/json' },
          ] });
        case 'resources/read': {
          if (isNotification) return null;
          const resources = {
            'switchboard://policies': POLICY_DESCRIPTIONS,
            'switchboard://profiles': listProfiles(),
            'switchboard://capabilities': CAPABILITY_DESCRIPTIONS,
            'switchboard://api': API_METADATA,
            'switchboard://adapter-contract': ADAPTER_CONTRACT,
            'switchboard://server': SERVER_METADATA,
          };
          if (params.uri === 'switchboard://preferences') resources[params.uri] = await preferenceStore.snapshot();
          if (!Object.hasOwn(resources, params.uri)) return failure(id, -32002, 'Resource not found', { uri: params.uri });
          return success(id, { contents: [{ uri: params.uri, mimeType: 'application/json', text: JSON.stringify(resources[params.uri], null, 2) }] });
        }
        case 'prompts/list':
          return isNotification ? null : success(id, { prompts: [{
            name: 'route_before_answering', title: 'Route Before Answering',
            description: 'Ask the host to route and optionally plan a task before answering it.',
            arguments: [
              { name: 'request', description: 'The request to route and then complete.', required: true },
              { name: 'policy', description: 'Optional policy: best, balanced, fast, or conserve.', required: false },
              { name: 'profile', description: 'Optional built-in routing profile.', required: false },
            ],
          }] });
        case 'prompts/get': {
          if (isNotification) return null;
          if (params.name !== 'route_before_answering') return failure(id, -32602, 'Invalid prompt name', { name: params.name });
          const args = paramsObject(params.arguments) ?? {};
          const request = typeof args.request === 'string' && args.request.trim() ? args.request.trim() : null;
          if (!request) return failure(id, -32602, 'The request argument is required.');
          const policy = typeof args.policy === 'string' && POLICIES.includes(args.policy) ? args.policy : 'balanced';
          const profile = typeof args.profile === 'string' ? args.profile : 'general';
          return success(id, {
            description: 'Route the request locally before completing it.',
            messages: [{ role: 'user', content: { type: 'text', text: `Call Switchboard route_request with policy "${policy}" and profile "${profile}" for the request below. Use the returned execution plan, tier, effort, capabilities, budget assessment, and model recommendation when supported. Then complete the original request.\n\n${request}` } }],
          });
        }
        case 'completion/complete': return isNotification ? null : success(id, completion(params));
        default: return isNotification ? null : failure(id, -32601, 'Method not found', { method: message.method });
      }
    } catch (error) {
      return isNotification ? null : failure(id, -32602, 'Invalid params', { message: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  return { handle, get protocolVersion() { return protocolVersion; }, get phase() { return phase; } };
}
