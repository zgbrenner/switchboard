const TIERS = ['fast', 'balanced', 'deep', 'max'];
const CAPABILITIES = ['web', 'files', 'vision', 'longContext', 'code'];

function tierIndex(value) {
  const index = TIERS.indexOf(value);
  return index < 0 ? 0 : index;
}

export function explainDecision(decision) {
  const required = CAPABILITIES.filter((key) => decision.capabilities?.[key]);
  const reasons = (decision.reasons ?? []).map((reason) => reason.detail || reason.code).filter(Boolean);
  const recommended = decision.modelResolution?.recommended;
  const summary = [
    `Route: ${decision.tier} with ${decision.effort} effort.`,
    required.length ? `Required capabilities: ${required.join(', ')}.` : 'No special host capabilities are required.',
    recommended ? `Recommended model: ${recommended.title ?? recommended.id}.` : 'No concrete model recommendation was produced.',
    `Confidence: ${Math.round((decision.confidence ?? 0) * 100)}%.`,
    decision.budgetAssessment?.fits === false
      ? `Budget conflicts: ${decision.budgetAssessment.violations.join(', ')}.`
      : 'The recommendation fits the supplied budget.',
  ];
  return {
    summary: summary.join(' '),
    route: { tier: decision.tier, effort: decision.effort },
    requiredCapabilities: required,
    reasons,
    confidenceEvidence: decision.confidenceEvidence,
    modelResolution: decision.modelResolution,
    executionPlan: decision.executionPlan,
    budgetAssessment: decision.budgetAssessment,
  };
}

export function compareDecisions(results) {
  const rows = results.map((entry) => ({
    label: entry.label,
    profile: entry.decision.effectiveProfile,
    policy: entry.decision.effectivePolicy,
    tier: entry.decision.tier,
    effort: entry.decision.effort,
    confidence: entry.decision.confidence,
    modelId: entry.decision.modelResolution?.recommended?.id ?? null,
    fitsBudget: entry.decision.budgetAssessment?.fits ?? true,
    stageCount: entry.decision.executionPlan?.stages?.length ?? 1,
  }));
  const tiers = rows.map((row) => tierIndex(row.tier));
  return {
    results: rows,
    differences: {
      tierSpread: Math.max(...tiers) - Math.min(...tiers),
      distinctTiers: [...new Set(rows.map((row) => row.tier))],
      distinctModels: [...new Set(rows.map((row) => row.modelId).filter(Boolean))],
      budgetConflicts: rows.filter((row) => !row.fitsBudget).map((row) => row.label),
    },
  };
}

export function validateModelInventory(models) {
  const capabilityCoverage = Object.fromEntries(CAPABILITIES.map((key) => [key, 0]));
  const tiers = Object.fromEntries(TIERS.map((tier) => [tier, 0]));
  const unavailable = [];
  const unknownCapabilityModels = [];

  for (const model of models) {
    tiers[model.tier] += 1;
    if (!model.available) unavailable.push(model.id);
    const unknown = [];
    for (const key of CAPABILITIES) {
      if (model.capabilities[key] === true) capabilityCoverage[key] += 1;
      if (model.capabilities[key] === undefined) unknown.push(key);
    }
    if (unknown.length) unknownCapabilityModels.push({ id: model.id, capabilities: unknown });
  }

  const warnings = [];
  if (!models.length) warnings.push('The inventory is empty.');
  if (!models.some((model) => model.available)) warnings.push('No model is marked available.');
  for (const key of CAPABILITIES) if (capabilityCoverage[key] === 0) warnings.push(`No model confirms support for ${key}.`);
  if (unknownCapabilityModels.length)
    warnings.push('Some models omit capability declarations; omissions are treated as unknown rather than supported.');

  return {
    valid: true,
    modelCount: models.length,
    availableCount: models.filter((model) => model.available).length,
    tiers,
    capabilityCoverage,
    unavailable,
    unknownCapabilityModels,
    warnings,
  };
}
