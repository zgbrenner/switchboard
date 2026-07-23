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
  return tier === 'fast' ? ['mini', 'instant', 'fast']
    : tier === 'balanced' ? ['auto', 'standard', 'gpt-5']
    : tier === 'deep' ? ['thinking', 'high', 'reasoning']
    : ['pro', 'max', 'deep research'];
}

export function scoreModelLabel(site: SupportedSite, tier: QualityTier, label: string): number {
  const normalized = label.toLowerCase();
  if (/settings|manage|learn more|upgrade|usage|send|attach/.test(normalized)) return -100;
  let score = 0;
  routeKeywords(site, tier).forEach((keyword, index) => {
    if (normalized.includes(keyword)) score += 12 - index * 2;
  });
  if (site === 'chatgpt' && /gpt|o\d|model/.test(normalized)) score += 1;
  if (site === 'claude' && /claude|sonnet|opus|haiku/.test(normalized)) score += 1;
  if (tier === 'fast' && /pro|opus|max|thinking/.test(normalized)) score -= 5;
  if (tier === 'max' && /mini|haiku|instant/.test(normalized)) score -= 8;
  return score;
}

export function rankModelLabels(site: SupportedSite, tier: QualityTier, labels: readonly string[]): RankedModelLabel[] {
  return labels
    .map((label, index) => ({ label, index, score: scoreModelLabel(site, tier, label) }))
    .filter((candidate) => candidate.label.length > 0 && candidate.label.length < 180 && candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
}
