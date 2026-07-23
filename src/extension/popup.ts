import type { SwitchboardSettings } from './settings.js';

const enabled = document.querySelector('#enabled');
const automatic = document.querySelector('#auto-switch');
const policy = document.querySelector('#policy');
const state = document.querySelector('#state');

async function load(): Promise<void> {
  const settings = await chrome.runtime.sendMessage<SwitchboardSettings>({ type: 'get-settings' });
  if (enabled instanceof HTMLInputElement) enabled.checked = settings.enabled;
  if (automatic instanceof HTMLInputElement) automatic.checked = settings.autoSwitch;
  if (policy instanceof HTMLSelectElement) policy.value = settings.policy;
  if (state) state.textContent = settings.enabled ? 'Routing locally' : 'Paused';
}

async function patch(): Promise<void> {
  const update: Partial<SwitchboardSettings> = {};
  if (enabled instanceof HTMLInputElement) update.enabled = enabled.checked;
  if (automatic instanceof HTMLInputElement) update.autoSwitch = automatic.checked;
  if (policy instanceof HTMLSelectElement) update.policy = policy.value as SwitchboardSettings['policy'];
  await chrome.runtime.sendMessage({ type: 'update-settings', patch: update });
  await load();
}

enabled?.addEventListener('change', () => { void patch(); });
automatic?.addEventListener('change', () => { void patch(); });
policy?.addEventListener('change', () => { void patch(); });
document.querySelector('#open-options')?.addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
await load();
