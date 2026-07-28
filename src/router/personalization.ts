import type { QualityTier } from '../shared/types.js';
import { TIER_ORDER } from './policies.js';

export interface OverrideLearningEvent {
  recommended: QualityTier;
  selected: QualityTier;
  categories: string[];
}

export function applyOverrideLearning(current: Readonly<Record<string, number>>, event: OverrideLearningEvent): Record<string, number> {
  const next = { ...current };
  const delta = TIER_ORDER.indexOf(event.selected) - TIER_ORDER.indexOf(event.recommended);
  if (delta === 0) return next;
  const step = Math.sign(delta) * Math.min(Math.abs(delta) * 0.12, 0.25);
  for (const category of new Set(event.categories.filter(Boolean))) {
    const value = (next[category] ?? 0) + step;
    next[category] = Math.round(Math.max(-1.5, Math.min(1.5, value)) * 100) / 100;
  }
  return next;
}
