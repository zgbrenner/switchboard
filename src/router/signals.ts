import type { CapabilitySet, RoutingReason } from '../shared/types.js';

export interface SignalResult {
  score: number;
  reasons: RoutingReason[];
  capabilities: CapabilitySet;
  categories: string[];
  vagueFollowUp: boolean;
  conflictingSignals: boolean;
}

const PATTERNS = {
  fast: /\b(rewrite|rephrase|proofread|fix grammar|make (?:this )?(?:shorter|friendlier|professional)|summari[sz]e briefly|title ideas?|extract|format)\b/i,
  research:
    /\b(research|look (?:this|it) up|browse|search the web|current sources?|primary sources?|citations?|cite sources?|latest|most recent|today'?s?)\b/i,
  deep: /\b(deep(?:ly)?|exhaustive|comprehensive|audit|double[- ]check|verify|validate|prove|rigorous|subtle|edge cases?|root cause|threat model)\b/i,
  compare: /\b(compare|contrast|reconcile|differences?|trade[- ]offs?|alternatives?|competing approaches?)\b/i,
  plan: /\b(implementation plan|implementation|architecture|architect|design(?: an?| the)?|outline|roadmap|spec(?:ification)?|step[- ]by[- ]step)\b/i,
  code: /```|\b(code|debug|stack trace|exception|typescript|javascript|python|rust|react|api|sql|regex|function|class|repository|pull request|middleware|library|browser extension|software|security review|vulnerability|authentication|authorization|idempotency|concurrency)\b/i,
  highStakes:
    /\b(legal|contracts?|medical|diagnosis|financial|securities|security|vulnerability|authentication|authorization|privacy|compliance)\b/i,
  longOutput: /\b(detailed|thorough|long[- ]form|complete report|every|all possible)\b/i,
  vague:
    /^(?:okay[,.]?\s*)?(?:do|redo|try|make|use|continue|fix)\s+(?:it|that|this)(?:\s+again)?\b|\b(?:same|other interpretation|previous version|like before)\b/i,
  vision: /\b(image|photo|picture|screenshot|diagram|visual|chart)\b/i,
};

function add(reasons: RoutingReason[], code: string, detail: string, weight: number): number {
  reasons.push({ code, detail, weight });
  return weight;
}

export function extractSignals(text: string): SignalResult {
  const reasons: RoutingReason[] = [];
  const categories = new Set<string>();
  let score = 0;
  let positive = false;
  let negative = false;
  const capabilities: CapabilitySet = {
    web: false,
    files: false,
    vision: false,
    longContext: false,
    code: false,
  };

  const normalized = text.trim();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;

  if (PATTERNS.fast.test(normalized)) {
    score += add(reasons, 'simple-transformation', 'The request resembles a direct writing or extraction task.', -2.2);
    categories.add('transformation');
    negative = true;
  }
  if (PATTERNS.research.test(normalized)) {
    score += add(reasons, 'explicit-research', 'The request calls for current information, research, or sources.', 3.4);
    capabilities.web = true;
    categories.add('research');
    positive = true;
  }
  if (PATTERNS.deep.test(normalized)) {
    score += add(reasons, 'deep-reasoning', 'The request explicitly asks for rigorous verification or analysis.', 2.2);
    categories.add('reasoning');
    positive = true;
  }
  if (PATTERNS.compare.test(normalized)) {
    score += add(reasons, 'comparison', 'The task requires comparing or reconciling alternatives.', 1.25);
    categories.add('comparison');
    positive = true;
  }
  if (PATTERNS.plan.test(normalized)) {
    score += add(reasons, 'planning', 'The task requires architecture, specification, or implementation planning.', 1.5);
    categories.add('planning');
    positive = true;
  }
  if (PATTERNS.code.test(normalized)) {
    score += add(reasons, 'code', 'The prompt contains software-development signals.', 1.1);
    capabilities.code = true;
    categories.add('code');
    positive = true;
  }
  if (PATTERNS.highStakes.test(normalized)) {
    score += add(reasons, 'high-stakes-domain', 'The task appears to involve a domain where subtle errors can matter.', 1.35);
    categories.add('high-stakes');
    positive = true;
  }
  if (PATTERNS.longOutput.test(normalized)) {
    score += add(reasons, 'high-coverage', 'The requested output has broad coverage requirements.', 0.8);
    positive = true;
  }
  if (PATTERNS.vision.test(normalized)) {
    capabilities.vision = true;
    categories.add('vision');
  }

  const instructionMarkers = (normalized.match(/(?:^|[.;]\s+|\b(?:and then|also|finally|after that)\b)/gi) ?? []).length;
  if (instructionMarkers >= 4) {
    score += add(reasons, 'multi-step', 'The prompt contains several distinct instructions.', 1.1);
    positive = true;
  }
  if (wordCount <= 14 && !positive) {
    score += add(reasons, 'short-request', 'The request is short and has no strong complexity signals.', -0.6);
    negative = true;
  } else if (wordCount >= 180) {
    score += add(reasons, 'long-prompt', 'The prompt is long enough to increase interpretation burden.', 0.8);
    capabilities.longContext = true;
    positive = true;
  }

  return {
    score,
    reasons,
    capabilities,
    categories: [...categories],
    vagueFollowUp: PATTERNS.vague.test(normalized),
    conflictingSignals: positive && negative,
  };
}
