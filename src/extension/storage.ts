import { applyOverrideLearning, type OverrideLearningEvent } from '../router/personalization.js';
import { DEFAULT_SETTINGS, normalizeSettings, type SwitchboardSettings } from './settings.js';

const SETTINGS_KEY = 'switchboard.settings';

export async function loadSettings(): Promise<SwitchboardSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(settings: SwitchboardSettings): Promise<SwitchboardSettings> {
  const normalized = normalizeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  return normalized;
}

export async function updateSettings(patch: Partial<SwitchboardSettings>): Promise<SwitchboardSettings> {
  const current = await loadSettings();
  return saveSettings({ ...current, ...patch });
}

export async function recordOverride(event: OverrideLearningEvent): Promise<SwitchboardSettings> {
  const current = await loadSettings();
  return saveSettings({
    ...current,
    categoryBoosts: applyOverrideLearning(current.categoryBoosts, event),
  });
}

export async function clearSwitchboardData(): Promise<SwitchboardSettings> {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS };
}
