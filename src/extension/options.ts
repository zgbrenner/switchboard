import type { SwitchboardSettings } from './settings.js';

const resolvedForm = document.querySelector('form');
if (!(resolvedForm instanceof HTMLFormElement)) throw new Error('Switchboard options form was not found.');
const form = resolvedForm;
const status = document.querySelector('#save-status');

function checkbox(name: string): HTMLInputElement {
  const input = form.elements.namedItem(name);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing ${name} setting.`);
  return input;
}

async function load(): Promise<void> {
  const settings = await chrome.runtime.sendMessage<SwitchboardSettings>({ type: 'get-settings' });
  checkbox('enabled').checked = settings.enabled;
  checkbox('autoSwitch').checked = settings.autoSwitch;
  checkbox('inspectFiles').checked = settings.inspectFiles;
  checkbox('useRecentContext').checked = settings.useRecentContext;
  checkbox('conservativeExistingConversation').checked = settings.conservativeExistingConversation;
  checkbox('showReasons').checked = settings.showReasons;
  const policy = form.elements.namedItem('policy');
  if (policy instanceof HTMLSelectElement) policy.value = settings.policy;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    const current = await chrome.runtime.sendMessage<SwitchboardSettings>({ type: 'get-settings' });
    const policy = form.elements.namedItem('policy');
    const settings: SwitchboardSettings = {
      ...current,
      enabled: checkbox('enabled').checked,
      autoSwitch: checkbox('autoSwitch').checked,
      inspectFiles: checkbox('inspectFiles').checked,
      useRecentContext: checkbox('useRecentContext').checked,
      conservativeExistingConversation: checkbox('conservativeExistingConversation').checked,
      showReasons: checkbox('showReasons').checked,
      policy: policy instanceof HTMLSelectElement ? policy.value as SwitchboardSettings['policy'] : current.policy,
    };
    await chrome.runtime.sendMessage({ type: 'save-settings', settings });
    if (status) status.textContent = 'Saved locally.';
  })();
});

document.querySelector('#clear-data')?.addEventListener('click', () => {
  void (async () => {
    await chrome.runtime.sendMessage({ type: 'clear-data' });
    await load();
    if (status) status.textContent = 'All Switchboard data was deleted.';
  })();
});

await load();
