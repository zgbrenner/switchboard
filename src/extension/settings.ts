import type { RoutingPolicy } from '../shared/types.js';

export interface SwitchboardSettings {
  enabled: boolean;
  autoSwitch: boolean;
  inspectFiles: boolean;
  useRecentContext: boolean;
  conservativeExistingConversation: boolean;
  showReasons: boolean;
  semanticModels: boolean;
  judgeEnabled: boolean;
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
  semanticModels: true,
  judgeEnabled: false,
  policy: 'balanced',
  categoryBoosts: {},
};

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeSettings(value: unknown): SwitchboardSettings {
  const source = typeof value === 'object' && value !== null ? value as Partial<SwitchboardSettings> : {};
  const policy = ['best', 'balanced', 'fast', 'conserve'].includes(source.policy ?? '')
    ? source.policy as RoutingPolicy
    : DEFAULT_SETTINGS.policy;
  return {
    enabled: booleanSetting(source.enabled, DEFAULT_SETTINGS.enabled),
    autoSwitch: booleanSetting(source.autoSwitch, DEFAULT_SETTINGS.autoSwitch),
    inspectFiles: booleanSetting(source.inspectFiles, DEFAULT_SETTINGS.inspectFiles),
    useRecentContext: booleanSetting(source.useRecentContext, DEFAULT_SETTINGS.useRecentContext),
    conservativeExistingConversation: booleanSetting(source.conservativeExistingConversation, DEFAULT_SETTINGS.conservativeExistingConversation),
    showReasons: booleanSetting(source.showReasons, DEFAULT_SETTINGS.showReasons),
    semanticModels: booleanSetting(source.semanticModels, DEFAULT_SETTINGS.semanticModels),
    judgeEnabled: booleanSetting(source.judgeEnabled, DEFAULT_SETTINGS.judgeEnabled),
    policy,
    categoryBoosts: typeof source.categoryBoosts === 'object' && source.categoryBoosts !== null
      ? Object.fromEntries(Object.entries(source.categoryBoosts).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
      : {},
  };
}
