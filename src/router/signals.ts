import type { CapabilitySet, RoutingReason } from '../shared/types.js';

export interface SignalResult {
  score: number;
  reasons: RoutingReason[];
  capabilities: CapabilitySet;
  categories: string[];
  vagueFollowUp: boolean;
  conflictingSignals: boolean;
  /** True when the prompt is predominantly written in a script the keyword signals cannot read. */
  unreadableScript: boolean;
  /** Number of distinct evidence signals that fired. Zero means the decision rests on nothing. */
  evidenceCount: number;
}

const PATTERNS = {
  /**
   * Direct writing/extraction tasks. The `make ... <adjective>` branch tolerates up to two
   * intervening words ("make this sentence friendlier") because requiring the adjective to sit
   * immediately after "this" silently missed most real phrasings.
   */
  fast: /\b(rewrite|rephrase|reword|proofread|fix (?:the )?(?:grammar|typos?|spelling)|make (?:this |the |it |that )?(?:\w+ ){0,2}(?:short(?:er)?|brief(?:er)?|friendl(?:y|ier)|professional|clear(?:er)?|simpler|concise|polite[r]?|casual)|summari[sz]e(?: (?:this|it|briefly))?|tl;?dr|title ideas?|extract|reformat|format)\b/i,
  /**
   * Explicit requests to go and consult sources. Deliberately excludes bare recency words such as
   * "latest" or "today", which are handled by `recency` at a far lower weight: "what is the weather
   * today" needs web access but is not a research task.
   */
  research:
    /\b(research|look (?:this|it) up|browse|search the web|(?:primary|official|authoritative|original) sources?|citations?|cite sources?|literature review|verify [^.]{0,48}\bagainst\b)/i,
  /** Recency cues imply web access but carry little evidence about reasoning difficulty. */
  recency: /\b(current sources?|latest|most recent|today'?s?|this (?:week|month|year)|up[- ]to[- ]date|breaking)\b/i,
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

/**
 * Scripts whose word boundaries and vocabulary the English keyword patterns above cannot analyse.
 * Detecting them is what stops a hard non-English request from silently scoring zero and falling
 * through to the cheapest tier.
 */
const NON_LATIN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Greek}]/u;
const LATIN_LETTER = /[A-Za-z]/;

function add(reasons: RoutingReason[], code: string, detail: string, weight: number): number {
  reasons.push({ code, detail, weight });
  return weight;
}

/**
 * Returns true when the text is mostly written in a script the keyword patterns cannot read.
 * Compares non-Latin to Latin letter counts rather than testing for any single character, so that
 * an English prompt quoting one CJK identifier is still analysed as English.
 */
function isUnreadableScript(text: string): boolean {
  if (!NON_LATIN.test(text)) return false;
  let nonLatin = 0;
  let latin = 0;
  for (const character of text) {
    if (NON_LATIN.test(character)) nonLatin++;
    else if (LATIN_LETTER.test(character)) latin++;
  }
  return nonLatin > latin;
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
  const unreadableScript = isUnreadableScript(normalized);
  // Latin word counting is meaningless for scripts that do not delimit words with spaces.
  const wordCount = unreadableScript ? Math.ceil([...normalized].length / 2) : normalized.split(/\s+/).filter(Boolean).length;

  // Counted before the simple-transformation check, because "summarize X, list Y, turn them into Z,
  // and create W" is a multi-part task that merely opens with a transformation verb. Enumerated
  // clauses separated by commas count too -- only counting sentence breaks missed most real lists.
  const instructionMarkers =
    (normalized.match(/(?:^|[.;]\s+|\b(?:and then|also|finally|after that)\b)/gi) ?? []).length +
    (
      normalized.match(
        /[,;]\s+(?:and\s+)?(?:list|turn|create|make|write|explain|add|include|compare|summari[sz]e|draft|produce|generate|identify|extract|rank|score|translate)\b/gi,
      ) ?? []
    ).length;
  const multiStep = instructionMarkers >= 4;

  if (PATTERNS.fast.test(normalized)) {
    // A transformation verb inside a multi-part request is not evidence of a simple task, so it
    // carries much less weight there than it does when it is the whole request.
    const weight = multiStep ? -0.6 : -2.2;
    score += add(reasons, 'simple-transformation', 'The request resembles a direct writing or extraction task.', weight);
    categories.add('transformation');
    negative = true;
  }
  if (PATTERNS.research.test(normalized)) {
    score += add(reasons, 'explicit-research', 'The request calls for research or source citation.', 3.4);
    capabilities.web = true;
    categories.add('research');
    positive = true;
  }
  if (PATTERNS.recency.test(normalized)) {
    score += add(reasons, 'recency', 'The request refers to current information and needs web access.', 0.5);
    capabilities.web = true;
    categories.add('recency');
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

  if (multiStep) {
    score += add(reasons, 'multi-step', 'The prompt contains several distinct instructions.', 1.1);
    positive = true;
  }

  if (unreadableScript) {
    // The keyword signals read English only. Rather than let their silence be read as "this is easy",
    // record the uncertainty explicitly and let route.ts apply a safe floor instead of the cheapest tier.
    score += add(
      reasons,
      'unreadable-script',
      'The prompt is not written in a script the local keyword signals can analyse, so difficulty could not be assessed.',
      0.9,
    );
    categories.add('unknown-language');
  } else if (wordCount <= 14 && !positive) {
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
    unreadableScript,
    // 'short-request' is the absence of evidence, not evidence, so it does not count.
    evidenceCount: reasons.filter((reason) => reason.code !== 'short-request').length,
  };
}
