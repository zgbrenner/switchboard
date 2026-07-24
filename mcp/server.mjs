import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const routerModuleUrl = process.env.SWITCHBOARD_ROUTER_MODULE
  ? pathToFileURL(resolve(process.cwd(), process.env.SWITCHBOARD_ROUTER_MODULE)).href
  : new URL('../dist/js/router/route.js', import.meta.url).href;
const { routeRequest } = await import(routerModuleUrl);

import { compareDecisions, explainDecision, validateModelInventory } from './diagnostics.mjs';
import { enhanceDecision, applyProfileFloor, SWITCHBOARD_API_VERSION } from './enhance.mjs';
import { evaluateRouter } from './evaluation.mjs';
import { resolveModelInventory } from './models.mjs';
import { ROUTE_OUTPUT_SCHEMA_V05 } from './output-schema.mjs';
import { applyProfile, listProfiles } from './profiles.mjs';
import {
  COMPARISON_INPUT_SCHEMA,
  EVALUATION_INPUT_SCHEMA,
  INVENTORY_INPUT_SCHEMA,
  POLICIES,
  ROUTE_INPUT_SCHEMA,
  normalizeComparisonArguments,
  normalizeEvaluationArguments,
  normalizeInventoryArguments,
  normalizeRouteArguments,
} from './schema.mjs';

export const CURRENT_PROTOCOL_VERSION = '2025-11-25';
export const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-11-25', '2025-06-18', '2025-03-26']);
export const SERVER_INFO = {
  name: 'switchboard',
  title: 'Switchboard Router',
  version: '0.5.0',
  description: 'Local privacy-first request planning, model routing, diagnostics, and evaluation for AI hosts.',
  websiteUrl: 'https://github.com/zgbrenner/switchboard',
};

const POLICY_DESCRIPTIONS = {
  best: 'Prefer higher-quality routes when they can materially improve the result.',
  balanced: 'Balance quality, latency, and premium model usage.',
  fast: 'Prefer the fastest adequate route while preserving hard capability floors.',
  conserve: 'Conserve stronger or premium model usage unless it is required.',
};

const CAPABILITY_DESCRIPTIONS = {
  web: 'Requires current web research or externally verified information.',
  files: 'Requires a host or model that can access attached files.',
  vision: 'Requires visual understanding of an image, screenshot, chart, or visual document.',
  longContext: 'Requires substantial context capacity for a long prompt, conversation, or document.',
  code: 'Requires code-aware reasoning or software-development capability.',
};

const API_METADATA = {
  current: SWITCHBOARD_API_VERSION,
  supported: [SWITCHBOARD_API_VERSION],
  compatibility: {
    additiveFrom: '0.4.0',
    policy: 'Existing request fields and response fields are retained. New response fields are additive.',
  },
};

const SERVER_METADATA = {
  server: SERVER_INFO,
  api: API_METADATA,
  protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
  transports: ['stdio', 'streamable-http'],
  tools: ['route_request', 'explain_route', 'compare_routes', 'simulate_policy', 'validate_model_inventory', 'evaluate_router'],
  privacy: {
    localRouting: true,
    persistsPrompts: false,
    persistsContext: false,
    persistsFileExcerpts: false,
    persistsModelInventories: false,
    persistsEvaluationCases: false,
    telemetry: false,
    remoteInference: false,
  },
};

function success(id, result) { return { jsonrpc: '2.0', id, result }; }
function failure(id, code, message, data) { return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } }; }
function paramsObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
function validId(value) { return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)); }
function toolResult(value) { return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value, isError: false }; }
function toolError(message) { return { content: [{ type: 'text', text: message }], isError: true }; }

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function toolDefinitions() {
  return [
    {
      name: 'route_request',
      title: 'Route AI Request',
      description: 'Classify a request locally and return tier, effort, capabilities, confidence evidence, an execution plan, a budget assessment, and an optional concrete model recommendation.',
      inputSchema: ROUTE_INPUT_SCHEMA,
      outputSchema: ROUTE_OUTPUT_SCHEMA_V05,
      annotations: READ_ONLY,
    },
    {
      name: 'explain_route',
      title: 'Explain Route',
      description: 'Route a request and return a concise explanation plus structured evidence for the decision.',
      inputSchema: ROUTE_INPUT_SCHEMA,
      annotations: READ_ONLY,
    },
    {
      name: 'compare_routes',
      title: 'Compare Routes',
      description: 'Compare two to eight policy or profile variants for the same request.',
      inputSchema: COMPARISON_INPUT_SCHEMA,
      annotations: READ_ONLY,
    },
    {
      name: 'simulate_policy',
      title: 'Simulate Policies',
      description: 'Simulate selected policy or profile variants for the same request without changing any state.',
      inputSchema: COMPARISON_INPUT_SCHEMA,
      annotations: READ_ONLY,
    },
    {
      name: 'validate_model_inventory',
      title: 'Validate Model Inventory',
      description: 'Validate and summarize a provider-independent model inventory without routing a prompt.',
      inputSchema: INVENTORY_INPUT_SCHEMA,
      annotations: READ_ONLY,
    },
    {
      name: 'evaluate_router',
      title: 'Evaluate Router',
      description: 'Evaluate up to 100 labeled routing cases and return under-routing, over-routing, capability recall, exact-tier accuracy, and a confusion matrix.',
      inputSchema: EVALUATION_INPUT_SCHEMA,
      annotations: READ_ONLY,
    },
  ];
}

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
  let protocolVersion = CURRENT_PROTOCOL_VERSION;
  let phase = lifecycle === 'stateless' ? 'ready' : 'new';

  async function routeNormalized(normalized) {
    const applied = applyProfile(normalized.request, normalized.profile);
    const rawDecision = await route(applied.request);
    const flooredDecision = applyProfileFloor(rawDecision, applied.profile);
    const modelResolution = resolveModelInventory(flooredDecision, normalized.availableModels, {
      policy: applied.request.preferences.policy,
      currentModelId: normalized.currentModelId,
      hasContext: applied.request.context.length > 0,
    });
    return enhanceDecision(rawDecision, {
      profile: applied.profile,
      policy: applied.request.preferences.policy,
      budget: normalized.budget,
      planMode: normalized.planMode,
      modelResolution,
    });
  }

  async function callTool(name, args) {
    if (name === 'route_request') return await routeNormalized(normalizeRouteArguments(args));
    if (name === 'explain_route') return explainDecision(await routeNormalized(normalizeRouteArguments(args)));
    if (name === 'validate_model_inventory') return validateModelInventory(normalizeInventoryArguments(args).availableModels);
    if (name === 'compare_routes' || name === 'simulate_policy') {
      const variants = normalizeComparisonArguments(args);
      const results = [];
      for (const variant of variants) results.push({ label: variant.label, decision: await routeNormalized(normalizeRouteArguments(variant.arguments)) });
      return compareDecisions(results);
    }
    if (name === 'evaluate_router') {
      const cases = normalizeEvaluationArguments(args);
      return await evaluateRouter(cases, async (testCase) => await routeNormalized(testCase));
    }
    throw new Error(`Unknown tool: ${name}`);
  }

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
            instructions: 'Call route_request before a task when model or reasoning selection is available. Switchboard recommendations are advisory; the MCP host remains responsible for choosing and invoking a model.',
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
          try { return success(id, toolResult(await callTool(params.name, params.arguments))); }
          catch (error) { return success(id, toolError(error instanceof Error ? error.message : 'Tool call failed.')); }
        }
        case 'resources/list':
          return isNotification ? null : success(id, { resources: [
            { uri: 'switchboard://policies', name: 'policies', title: 'Switchboard Routing Policies', mimeType: 'application/json' },
            { uri: 'switchboard://profiles', name: 'profiles', title: 'Switchboard Routing Profiles', mimeType: 'application/json' },
            { uri: 'switchboard://capabilities', name: 'capabilities', title: 'Switchboard Capability Requirements', mimeType: 'application/json' },
            { uri: 'switchboard://api', name: 'api', title: 'Switchboard API Compatibility', mimeType: 'application/json' },
            { uri: 'switchboard://server', name: 'server', title: 'Switchboard Server Metadata', mimeType: 'application/json' },
          ] });
        case 'resources/read': {
          if (isNotification) return null;
          const resources = {
            'switchboard://policies': POLICY_DESCRIPTIONS,
            'switchboard://profiles': listProfiles(),
            'switchboard://capabilities': CAPABILITY_DESCRIPTIONS,
            'switchboard://api': API_METADATA,
            'switchboard://server': SERVER_METADATA,
          };
          if (!Object.hasOwn(resources, params.uri)) return failure(id, -32002, 'Resource not found', { uri: params.uri });
          return success(id, { contents: [{ uri: params.uri, mimeType: 'application/json', text: JSON.stringify(resources[params.uri], null, 2) }] });
        }
        case 'prompts/list':
          return isNotification ? null : success(id, { prompts: [{
            name: 'route_before_answering',
            title: 'Route Before Answering',
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
          return success(id, { description: 'Route the request locally before completing it.', messages: [{ role: 'user', content: { type: 'text', text: `Call Switchboard route_request with policy "${policy}" and profile "${profile}" for the request below. Use the returned execution plan, tier, effort, capabilities, budget assessment, and model recommendation when supported. Then complete the original request.\n\n${request}` } }] });
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
