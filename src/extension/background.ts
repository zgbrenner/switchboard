import type { SwitchboardMessage, SwitchboardStatus } from './messages.js';
import { clearSwitchboardData, loadSettings, recordOverride, saveSettings, updateSettings } from './storage.js';

chrome.runtime.onMessage.addListener((message: SwitchboardMessage, _sender, sendResponse) => {
  void (async () => {
    switch (message.type) {
      case 'get-settings':
        sendResponse(await loadSettings());
        break;
      case 'save-settings':
        sendResponse(await saveSettings(message.settings));
        break;
      case 'update-settings':
        sendResponse(await updateSettings(message.patch));
        break;
      case 'record-override':
        sendResponse(await recordOverride(message.event));
        break;
      case 'clear-data':
        sendResponse(await clearSwitchboardData());
        break;
      case 'get-status': {
        const status: SwitchboardStatus = { version: '0.1.0', localOnly: true, modelPacks: 'not-installed' };
        sendResponse(status);
        break;
      }
      default:
        sendResponse({ error: 'Unsupported Switchboard message.' });
    }
  })().catch((error: unknown) => {
    sendResponse({ error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});
