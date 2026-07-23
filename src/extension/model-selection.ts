import type { QualityTier } from '../shared/types.js';

export type SupportedSite = 'chatgpt' | 'claude';

export interface RankedModelLabel {
  label: string;
  score: number;
  index: number;
}

function routeKeywords(site: SupportedSite, tier: QualityTier): readonly string[] {
  if (site === 'claude') {
    return tier === 'fast' ? ['haiku', 'fast']
      : tier === 'balanced' ? ['sonnet', 'default']
      : tier === 'deep' ? ['opus', 'thinking', 'extended']
      : ['opus', 'max', 'extended'];
  }
  return tier === 'fast' ? ['instant', 'mini', 'fast']
    : tier === 'balanced' ? ['auto', 'standard', 'medium', 'default']
    : tier === 'deep' ? ['thinking', 'high', 'reasoning']
    : ['pro', 'max', 'deep research'];
}

function normalizedLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, ' ').trim();
}

function routeKeywordScore(site: SupportedSite, tier: QualityTier, label: string): number {
  const normalized = normalizedLabel(label);
  let score = 0;
  routeKeywords(site, tier).forEach((keyword, index) => {
    if (normalized.includes(keyword)) score += 12 - index * 2;
  });
  if (tier === 'fast' && /\b(pro|opus|max|thinking|reasoning|deep research)\b/.test(normalized)) score -= 8;
  if (tier === 'balanced' && /\b(instant|mini|haiku|fast|thinking|reasoning|high|pro|opus|max|deep research)\b/.test(normalized)) score -= 6;
  if (tier === 'deep' && /\b(instant|mini|haiku|fast)\b/.test(normalized)) score -= 8;
  if (tier === 'max' && /\b(mini|haiku|instant|fast)\b/.test(normalized)) score -= 10;
  return score;
}

export function scoreModelPickerLabel(label: string): number {
  const normalized = normalizedLabel(label);
  let score = /\b(model|gpt|claude|sonnet|opus|haiku|thinking|auto|pro)\b/.test(normalized) ? 10 : 0;
  if (/\b(profile|account|settings|sidebar|navigation|more|share)\b/.test(normalized)) score -= 20;
  return score;
}

export function scoreModelLabel(site: SupportedSite, tier: QualityTier, label: string): number {
  const normalized = normalizedLabel(label);
  if (/settings|manage|learn more|upgrade|usage|send|attach/.test(normalized)) return -100;
  let score = routeKeywordScore(site, tier, normalized);
  if (site === 'chatgpt' && /gpt|o\d|model/.test(normalized)) score += 1;
  if (site === 'claude' && /claude|sonnet|opus|haiku/.test(normalized)) score += 1;
  return score;
}

export function rankModelLabels(site: SupportedSite, tier: QualityTier, labels: readonly string[]): RankedModelLabel[] {
  return labels
    .map((label, index) => ({ label, index, score: scoreModelLabel(site, tier, label) }))
    .filter((candidate) => candidate.label.length > 0 && candidate.label.length < 180 && candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
}

export function isModelSelectionConfirmed(
  site: SupportedSite,
  tier: QualityTier,
  beforeLabel: string,
  afterLabel: string,
): boolean {
  const after = normalizedLabel(afterLabel);
  if (!after || routeKeywordScore(site, tier, after) <= 0) return false;
  const before = normalizedLabel(beforeLabel);
  if (before !== after) return true;
  return routeKeywordScore(site, tier, before) > 0;
}
