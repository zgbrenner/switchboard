import type { RoutingPolicy } from '../shared/types.js';

export interface SwitchboardSettings {
  enabled: boolean;
  autoSwitch: boolean;
  inspectFiles: boolean;
  useRecentContext: boolean;
  conservativeExistingConversation: boolean;
  showReasons: boolean;
  policy: RoutingPolicy;
  categoryBoosts: Record<string, number>;
}

export const DEFAULT_SETTINGS: SwitchboardSettings = {
  enabled: true,
  autoSwitch: true,
  inspectFiles: true,
  useRecentContext: true,
  conservativeExistingConversation: true,
  showReasons: true,
  policy: 'balanced',
  categoryBoosts: {},
};

export function normalizeSettings(value: unknown): SwitchboardSettings {
  const source = typeof value === 'object' && value !== null ? value as Partial<SwitchboardSettings> : {};
  const policy = ['best', 'balanced', 'fast', 'conserve'].includes(source.policy ?? '')
    ? source.policy as RoutingPolicy
    : DEFAULT_SETTINGS.policy;
  return {
    enabled: source.enabled ?? DEFAULT_SETTINGS.enabled,
    autoSwitch: source.autoSwitch ?? DEFAULT_SETTINGS.autoSwitch,
    inspectFiles: source.inspectFiles ?? DEFAULT_SETTINGS.inspectFiles,
    useRecentContext: source.useRecentContext ?? DEFAULT_SETTINGS.useRecentContext,
    conservativeExistingConversation: source.conservativeExistingConversation ?? DEFAULT_SETTINGS.conservativeExistingConversation,
    showReasons: source.showReasons ?? DEFAULT_SETTINGS.showReasons,
    policy,
    categoryBoosts: typeof source.categoryBoosts === 'object' && source.categoryBoosts !== null
      ? { ...source.categoryBoosts }
      : {},
  };
}
