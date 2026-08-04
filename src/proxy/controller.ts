import { coordinateRuntimeDecision } from '../judge/coordinator.js';
import { DeterministicRuntimeJudge } from '../judge/deterministic.js';
import { RuntimeSession } from '../runtime/session.js';
import type { RuntimeDecision, RuntimeObservationResult } from '../runtime/types.js';
import type { QualityTier } from '../shared/types.js';
import { extractProxyRequest, sanitizeForCleanRestart, stableProxySessionId } from './wire.js';
import type {
  ProxyConfig,
  ProxyControllerDependencies,
  ProxyPrepareInput,
  ProxyPreparedRequest,
  ProxySessionInspection,
  ProxyTierRoutes,
  ProxyUpstreamRoute,
  ProxyUsage,
  ProxyWire,
} from './types.js';

const TIERS: QualityTier[] = ['fast', 'balanced', 'deep', 'max'];

interface ProxySessionRecord {
  runtime: RuntimeSession;
  seen: Set<string>;
  lastDecision: RuntimeDecision;
  lastAccessedAt: number;
}

function continueDecision(): RuntimeDecision {
  return {
    action: 'continue',
    reasonCodes: ['no-new-runtime-evidence'],
    signals: [],
    preserveArtifacts: false,
    dropNarration: false,
  };
}

function selectUpstream(routes: ProxyTierRoutes, tier: QualityTier): ProxyUpstreamRoute {
  const start = TIERS.indexOf(tier);
  for (let index = start; index < TIERS.length; index++) {
    const candidateTier = TIERS[index];
    if (candidateTier !== undefined && routes[candidateTier] !== undefined) {
      return routes[candidateTier] as ProxyUpstreamRoute;
    }
  }
  throw new Error(`No configured upstream satisfies the ${tier} tier.`);
}

function rewriteBody(
  wire: ProxyWire,
  body: Record<string, unknown>,
  upstream: ProxyUpstreamRoute,
  decision: RuntimeDecision,
  effort: string,
): Record<string, unknown> {
  const cleaned =
    decision.action === 'restart_clean' || decision.action === 'switch_model'
      ? sanitizeForCleanRestart(wire, body)
      : { ...body };
  if (wire === 'responses') {
    const existing =
      cleaned.reasoning && typeof cleaned.reasoning === 'object' && !Array.isArray(cleaned.reasoning)
        ? (cleaned.reasoning as Record<string, unknown>)
        : {};
    return { ...cleaned, model: upstream.model, reasoning: { ...existing, effort } };
  }
  return { ...cleaned, model: upstream.model };
}

function routeHeaders(
  sessionId: string,
  snapshot: ReturnType<RuntimeSession['snapshot']>,
  decision: RuntimeDecision,
  judgeSource: string,
  upstream: ProxyUpstreamRoute,
): Record<string, string> {
  return {
    'x-switchboard-session': sessionId,
    'x-switchboard-tier': snapshot.currentTier,
    'x-switchboard-effort': snapshot.currentEffort,
    'x-switchboard-model': upstream.model,
    'x-switchboard-decision': decision.action,
    'x-switchboard-judge': judgeSource,
  };
}

function relativeCost(usage: ProxyUsage, upstream: ProxyUpstreamRoute): number {
  return (
    (usage.inputTokens * upstream.inputCostPerMillion + usage.outputTokens * upstream.outputCostPerMillion) /
    1_000_000
  );
}

export function createProxyController(config: ProxyConfig, dependencies: ProxyControllerDependencies) {
  const judge = dependencies.judge ?? new DeterministicRuntimeJudge();
  const now = dependencies.now ?? Date.now;
  const sessions = new Map<string, ProxySessionRecord>();

  function cleanup(): void {
    const cutoff = now() - config.session.ttlMs;
    for (const [id, record] of sessions) {
      if (record.lastAccessedAt <= cutoff) sessions.delete(id);
    }
    while (sessions.size > config.session.maxSessions) {
      let oldest: { id: string; at: number } | undefined;
      for (const [id, record] of sessions) {
        if (!oldest || record.lastAccessedAt < oldest.at) oldest = { id, at: record.lastAccessedAt };
      }
      if (!oldest) break;
      sessions.delete(oldest.id);
    }
  }

  async function getOrCreate(
    input: ProxyPrepareInput,
    sessionId: string,
    prompt: string,
    context: Array<{ role: 'user' | 'assistant'; text: string }>,
  ): Promise<ProxySessionRecord> {
    cleanup();
    const existing = sessions.get(sessionId);
    if (existing) {
      existing.lastAccessedAt = now();
      return existing;
    }
    if (sessions.size >= config.session.maxSessions) {
      let oldest: { id: string; at: number } | undefined;
      for (const [id, record] of sessions) {
        if (!oldest || record.lastAccessedAt < oldest.at) oldest = { id, at: record.lastAccessedAt };
      }
      if (oldest) sessions.delete(oldest.id);
    }
    const preflight = await dependencies.route({
      prompt,
      context,
      files: [],
      preferences: { policy: 'balanced' },
    });
    const routeMap = config.routes[input.wire];
    if (!routeMap) throw new Error(`No ${input.wire} routes are configured.`);
    const ladder = TIERS.filter(
      (tier) => TIERS.indexOf(tier) >= TIERS.indexOf(preflight.tier) && routeMap[tier] !== undefined,
    );
    if (!ladder.includes(preflight.tier)) ladder.unshift(preflight.tier);
    const runtime = new RuntimeSession(
      {
        id: sessionId,
        initialTier: preflight.tier,
        initialEffort: preflight.effort,
        modelLadder: ladder,
        policy: config.runtimePolicy,
      },
      { now },
    );
    const record = {
      runtime,
      seen: new Set<string>(),
      lastDecision: continueDecision(),
      lastAccessedAt: now(),
    };
    sessions.set(sessionId, record);
    return record;
  }

  async function prepare(input: ProxyPrepareInput): Promise<ProxyPreparedRequest> {
    if (input.body.model !== config.alias) throw new TypeError(`Proxy model must be the configured alias ${config.alias}.`);
    const extracted = extractProxyRequest(input.wire, input.body);
    const explicit = input.headers['x-switchboard-session'];
    const sessionId = stableProxySessionId({
      ...(explicit === undefined ? {} : { explicit }),
      ...(extracted.sessionHint === undefined ? {} : { hint: extracted.sessionHint }),
      wire: input.wire,
      prompt: extracted.prompt,
      ...(input.clientFingerprint === undefined ? {} : { clientFingerprint: input.clientFingerprint }),
    });
    const record = await getOrCreate(input, sessionId, extracted.prompt, extracted.context);
    let latest: RuntimeObservationResult | undefined;
    let judgeSource: ProxyPreparedRequest['judgeSource'] = 'deterministic';
    for (const observation of extracted.observations) {
      if (record.seen.has(observation.key)) continue;
      record.seen.add(observation.key);
      latest = record.runtime.observe(observation.input);
      record.lastDecision = latest.decision;
    }
    if (latest && latest.signals.length > 0 && latest.decision.action === 'continue') {
      const coordinated = await coordinateRuntimeDecision(judge, {
        snapshot: latest.snapshot,
        signals: latest.signals,
        deterministicDecision: latest.decision,
      });
      judgeSource = coordinated.source;
      if (coordinated.decision.action !== latest.decision.action) {
        const snapshot = record.runtime.reconcileDecision(coordinated.decision);
        latest = { ...latest, decision: coordinated.decision, snapshot };
      }
      record.lastDecision = coordinated.decision;
    }
    const decision = latest?.decision ?? record.lastDecision;
    const snapshot = record.runtime.snapshot();
    const routeMap = config.routes[input.wire];
    if (!routeMap) throw new Error(`No ${input.wire} routes are configured.`);
    const upstream = selectUpstream(routeMap, snapshot.currentTier);
    const body = rewriteBody(input.wire, input.body, upstream, decision, snapshot.currentEffort);
    record.lastAccessedAt = now();
    return {
      wire: input.wire,
      sessionId,
      body,
      upstream,
      endpoint: `${upstream.baseUrl}/${input.wire}`,
      headers: routeHeaders(sessionId, snapshot, decision, judgeSource, upstream),
      decision,
      judgeSource,
      snapshot,
    };
  }

  function recordUsage(
    sessionId: string,
    upstream: ProxyUpstreamRoute,
    usage: ProxyUsage,
    success: boolean,
    errorClass?: string,
  ): void {
    const record = sessions.get(sessionId);
    if (!record) return;
    const result = record.runtime.observe({
      tool: 'model_response',
      kind: 'communicate',
      status: success ? 'success' : 'failure',
      arguments: { model: upstream.model },
      output: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      relativeCost: relativeCost(usage, upstream),
      ...(errorClass === undefined ? {} : { errorClass }),
    });
    record.lastDecision = result.decision;
    record.lastAccessedAt = now();
  }

  function listSessions(): ProxySessionInspection[] {
    cleanup();
    return [...sessions.entries()].map(([id, record]) => ({
      id,
      snapshot: record.runtime.snapshot(),
      seenObservations: record.seen.size,
      lastDecision: record.lastDecision,
    }));
  }

  function inspectSession(id: string): ProxySessionInspection | undefined {
    cleanup();
    const record = sessions.get(id);
    if (!record) return undefined;
    record.lastAccessedAt = now();
    return {
      id,
      snapshot: record.runtime.snapshot(),
      seenObservations: record.seen.size,
      lastDecision: record.lastDecision,
    };
  }

  return { prepare, recordUsage, listSessions, inspectSession };
}
