import { compareDecisions, explainDecision, validateModelInventory } from '../diagnostics.mjs';
import { applyProfileFloor, enhanceDecision } from '../enhance.mjs';
import { evaluateRouter } from '../evaluation.mjs';
import { normalizeOverrideArguments, OVERRIDE_INPUT_SCHEMA } from '../learning.mjs';
import { resolveModelInventory } from '../models.mjs';
import { normalizePrepareArguments, PREPARE_INPUT_SCHEMA, PREPARE_OUTPUT_SCHEMA, prepareRequest } from '../pipeline/index.mjs';
import { ROUTE_OUTPUT_SCHEMA_V05 } from '../output-schema.mjs';
import { applyProfile } from '../profiles.mjs';
import {
  COMPARISON_INPUT_SCHEMA,
  EVALUATION_INPUT_SCHEMA,
  INVENTORY_INPUT_SCHEMA,
  normalizeComparisonArguments,
  normalizeEvaluationArguments,
  normalizeInventoryArguments,
  normalizeRouteArguments,
  ROUTE_INPUT_SCHEMA,
} from '../schema.mjs';
import {
  COMPARISON_OUTPUT_SCHEMA,
  EVALUATION_OUTPUT_SCHEMA,
  EXPLAIN_OUTPUT_SCHEMA,
  INVENTORY_OUTPUT_SCHEMA,
  PREFERENCE_STATE_OUTPUT_SCHEMA,
} from '../tool-output-schemas.mjs';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const READ_LOCAL_PIPELINE = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const WRITE_AGGREGATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const RESET_AGGREGATE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
const EMPTY_INPUT_SCHEMA = { type: 'object', additionalProperties: false, properties: {} };

/** Names the dispatcher accepts. Used to reject an unknown tool as a protocol error, per the spec. */
export function isKnownTool(name) {
  return toolDefinitions().some((definition) => definition.name === name);
}

export function toolDefinitions() {
  return [
    {
      name: 'route_request',
      title: 'Route AI Request',
      description:
        'Classify a request locally and return tier, effort, capabilities, confidence evidence, an execution plan, a budget assessment, aggregate-learning metadata, and an optional concrete model recommendation.',
      inputSchema: ROUTE_INPUT_SCHEMA,
      outputSchema: ROUTE_OUTPUT_SCHEMA_V05,
      annotations: READ_ONLY,
    },
    {
      name: 'prepare_request',
      title: 'Prepare AI Request',
      description:
        'Run an independently configurable local preflight pipeline: route the original request, convert local files to Markdown, compress eligible text, and append reply-brevity steering.',
      inputSchema: PREPARE_INPUT_SCHEMA,
      outputSchema: PREPARE_OUTPUT_SCHEMA,
      annotations: READ_LOCAL_PIPELINE,
    },
    {
      name: 'explain_route',
      title: 'Explain Route',
      description: 'Route a request and return a concise explanation plus structured evidence.',
      inputSchema: ROUTE_INPUT_SCHEMA,
      outputSchema: EXPLAIN_OUTPUT_SCHEMA,
      annotations: READ_ONLY,
    },
    {
      name: 'compare_routes',
      title: 'Compare Routes',
      description: 'Compare two to eight policy or profile variants for the same request.',
      inputSchema: COMPARISON_INPUT_SCHEMA,
      outputSchema: COMPARISON_OUTPUT_SCHEMA,
      annotations: READ_ONLY,
    },
    {
      name: 'simulate_policy',
      title: 'Simulate Policies',
      description: 'Simulate selected policy or profile variants without changing state.',
      inputSchema: COMPARISON_INPUT_SCHEMA,
      outputSchema: COMPARISON_OUTPUT_SCHEMA,
      annotations: READ_ONLY,
    },
    {
      name: 'validate_model_inventory',
      title: 'Validate Model Inventory',
      description: 'Validate and summarize a provider-independent model inventory without routing a prompt.',
      inputSchema: INVENTORY_INPUT_SCHEMA,
      outputSchema: INVENTORY_OUTPUT_SCHEMA,
      annotations: READ_ONLY,
    },
    {
      name: 'evaluate_router',
      title: 'Evaluate Router',
      description:
        'Evaluate up to 100 labeled routing cases and return safety and quality metrics. Baseline metrics exclude learned preferences by default.',
      inputSchema: EVALUATION_INPUT_SCHEMA,
      outputSchema: EVALUATION_OUTPUT_SCHEMA,
      annotations: READ_ONLY,
    },
    {
      name: 'record_override',
      title: 'Record Aggregate Override',
      description: 'Record category-level upgrade or downgrade feedback. Does not accept or store prompt text.',
      inputSchema: OVERRIDE_INPUT_SCHEMA,
      outputSchema: PREFERENCE_STATE_OUTPUT_SCHEMA,
      annotations: WRITE_AGGREGATE,
    },
    {
      name: 'get_preference_state',
      title: 'Get Aggregate Preference State',
      description: 'Read category-level aggregate preference weights and counters.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      outputSchema: PREFERENCE_STATE_OUTPUT_SCHEMA,
      annotations: READ_ONLY,
    },
    {
      name: 'reset_preference_state',
      title: 'Reset Aggregate Preference State',
      description: 'Delete all aggregate preference weights and counters.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      outputSchema: PREFERENCE_STATE_OUTPUT_SCHEMA,
      annotations: RESET_AGGREGATE,
    },
  ];
}

export function createToolDispatcher({ route, preferenceStore, pipelineDependencies = {} }) {
  async function routeNormalized(normalized, { applyPreferences = true } = {}) {
    const applied = applyProfile(normalized.request, normalized.profile);
    const rawDecision = await route(applied.request);
    const learned = applyPreferences
      ? await preferenceStore.apply(rawDecision)
      : { decision: rawDecision, learning: { applied: false, bias: 0, reason: 'evaluation-baseline' } };
    const flooredDecision = applyProfileFloor(learned.decision, applied.profile);
    const modelResolution = resolveModelInventory(flooredDecision, normalized.availableModels, {
      policy: applied.request.preferences.policy,
      currentModelId: normalized.currentModelId,
      hasContext: applied.request.context.length > 0,
    });
    return enhanceDecision(learned.decision, {
      profile: applied.profile,
      policy: applied.request.preferences.policy,
      budget: normalized.budget,
      planMode: normalized.planMode,
      modelResolution,
      learningAdjustment: learned.learning,
    });
  }

  return async function callTool(name, args) {
    if (name === 'route_request') return await routeNormalized(normalizeRouteArguments(args));
    if (name === 'prepare_request') {
      return await prepareRequest(normalizePrepareArguments(args), { ...pipelineDependencies, route: routeNormalized });
    }
    if (name === 'explain_route') return explainDecision(await routeNormalized(normalizeRouteArguments(args)));
    if (name === 'validate_model_inventory') return validateModelInventory(normalizeInventoryArguments(args).availableModels);
    if (name === 'compare_routes' || name === 'simulate_policy') {
      const variants = normalizeComparisonArguments(args);
      const results = [];
      for (const variant of variants)
        results.push({ label: variant.label, decision: await routeNormalized(normalizeRouteArguments(variant.arguments)) });
      return compareDecisions(results);
    }
    if (name === 'evaluate_router') {
      const evaluation = normalizeEvaluationArguments(args);
      return await evaluateRouter(evaluation.cases, async (testCase) => {
        const baseline = await routeNormalized(testCase, { applyPreferences: false });
        if (!evaluation.includePreferences) return baseline;
        const observed = await routeNormalized(testCase, { applyPreferences: true });
        return { decision: baseline, observedTier: observed.tier };
      });
    }
    if (name === 'record_override') return await preferenceStore.record(normalizeOverrideArguments(args));
    if (name === 'get_preference_state') return await preferenceStore.snapshot();
    if (name === 'reset_preference_state') return await preferenceStore.reset();
    throw new Error(`Unknown tool: ${name}`);
  };
}
