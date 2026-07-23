import { ROUTE_PROTOTYPES, TIER_ORDER } from './policies.js';
import type { QualityTier } from '../shared/types.js';

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','but','by','for','from','how','i','in','is','it','of','on','or','that','the','this','to','with','you'
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_+#.-]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function vector(text: string): Map<string, number> {
  const result = new Map<string, number>();
  for (const token of tokens(text)) result.set(token, (result.get(token) ?? 0) + 1);
  return result;
}

function cosine(left: Map<string, number>, right: Map<string, number>): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;
  for (const [key, value] of left) dot += value * (right.get(key) ?? 0);
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function semanticRouteScores(text: string): Record<QualityTier, number> {
  const input = vector(text);
  const scores = {} as Record<QualityTier, number>;
  for (const tier of TIER_ORDER) scores[tier] = cosine(input, vector(ROUTE_PROTOTYPES[tier]));
  return scores;
}
