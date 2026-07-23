void import(chrome.runtime.getURL('js/extension/content.js')).catch((error) => {
  console.error('[Switchboard] Failed to load content module:', error);
});
