import { inspectFile } from '../files/inspect.js';
import { routeRequest } from '../router/route.js';
import type { FileInsight, QualityTier, RoutingDecision } from '../shared/types.js';
import type { SwitchboardSettings } from './settings.js';
import { SwitchboardPanel } from './panel.js';
import { getSiteAdapter } from './site-adapters.js';

const resolvedAdapter = getSiteAdapter();
if (!resolvedAdapter) throw new Error('Switchboard loaded on an unsupported site.');
const adapter = resolvedAdapter;

let settings = await chrome.runtime.sendMessage<SwitchboardSettings>({ type: 'get-settings' });
let handling = false;
let bypassOnce = false;
let paused = false;
let lastDecision: RoutingDecision | null = null;
const capturedFiles = new Map<string, File>();

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function captureFiles(files: FileList | readonly File[]): void {
  for (const file of Array.from(files)) capturedFiles.set(fileKey(file), file);
}

document.addEventListener('change', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.type === 'file' && target.files) captureFiles(target.files);
}, true);

document.addEventListener('drop', (event) => {
  if (event.dataTransfer?.files.length) captureFiles(event.dataTransfer.files);
}, true);

const panel = new SwitchboardPanel({
  onTierSelected: (tier) => { void manuallySelect(tier); },
  onPause: () => {
    paused = true;
    panel.hide();
  },
});

async function inspectCapturedFiles(): Promise<FileInsight[]> {
  if (!settings.inspectFiles) return [];
  const results = await Promise.all([...capturedFiles.values()].map(async (file) => {
    try {
      return await inspectFile(file);
    } catch (error) {
      return {
        name: file.name,
        size: file.size,
        detectedType: 'unknown' as const,
        mediaType: file.type || 'application/octet-stream',
        textLength: 0,
        excerpt: '',
        warnings: [error instanceof Error ? error.message : String(error)],
        capabilities: { files: true, vision: file.type.startsWith('image/'), longContext: false },
      };
    }
  }));
  return results;
}

async function manuallySelect(tier: QualityTier): Promise<void> {
  panel.setStatus('Switching model', `Selecting the best visible ${tier} option…`);
  const result = await adapter.switchToTier(tier);
  if (!result.switched) {
    panel.showError(result.reason ?? 'The site adapter could not switch models.');
    return;
  }
  if (lastDecision) {
    await chrome.runtime.sendMessage({
      type: 'record-override',
      event: { recommended: lastDecision.tier, selected: tier, categories: lastDecision.taskCategories },
    });
    settings = await chrome.runtime.sendMessage<SwitchboardSettings>({ type: 'get-settings' });
  }
  panel.setStatus('Model selected', result.model ?? `Selected ${tier}.`);
}

function submitWithFreshControl(fallback: HTMLButtonElement): boolean {
  const current = adapter.findSendButton();
  const button = current ?? (fallback.isConnected ? fallback : null);
  if (!button || button.disabled) return false;
  bypassOnce = true;
  button.click();
  queueMicrotask(() => { bypassOnce = false; });
  return true;
}

async function handleSend(button: HTMLButtonElement): Promise<void> {
  if (handling || paused || !settings.enabled) return;
  const prompt = adapter.readPrompt();
  if (!prompt) return;
  handling = true;
  panel.setStatus('Routing locally', 'Inspecting the prompt and attachments on this device…');

  try {
    const files = await inspectCapturedFiles();
    const context = settings.useRecentContext ? adapter.collectRecentContext(4) : [];
    const decision = routeRequest({
      prompt,
      context,
      files,
      preferences: { policy: settings.policy, categoryBoosts: settings.categoryBoosts },
    });
    lastDecision = decision;
    const existingConversation = adapter.conversationHasHistory();
    const recommendationOnly = settings.conservativeExistingConversation && existingConversation;
    let note = decision.shouldUseJudge
      ? 'The deterministic and semantic signals were close, so Switchboard is being conservative.'
      : 'Selected from local deterministic and semantic signals.';

    if (settings.autoSwitch && !recommendationOnly) {
      const switched = await adapter.switchToTier(decision.tier);
      note = switched.switched
        ? `Switched to ${switched.model ?? decision.tier} before sending.`
        : `Recommended ${decision.tier}; automatic switching failed safely.`;
    } else if (recommendationOnly) {
      note = `Recommended ${decision.tier}; existing-conversation protection left the current model unchanged.`;
    }
    panel.showDecision(decision, note, settings.showReasons);
    if (submitWithFreshControl(button)) {
      capturedFiles.clear();
    } else {
      panel.showError('Routing completed, but the send control changed. Press Send again to continue safely.');
    }
  } catch (error) {
    panel.showError(error instanceof Error ? error.message : String(error));
    if (submitWithFreshControl(button)) capturedFiles.clear();
  } finally {
    handling = false;
  }
}

document.addEventListener('click', (event) => {
  if (bypassOnce) {
    bypassOnce = false;
    return;
  }
  const target = event.target;
  if (!(target instanceof Element) || !adapter.isSendTarget(target)) return;
  const button = target.closest('button') ?? adapter.findSendButton();
  if (!(button instanceof HTMLButtonElement)) return;
  if (paused || !settings.enabled) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void handleSend(button);
}, true);

document.addEventListener('keydown', (event) => {
  if (bypassOnce || paused || !settings.enabled || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  const composer = adapter.findComposer();
  if (!composer || !(event.target instanceof Node) || !composer.contains(event.target)) return;
  const button = adapter.findSendButton();
  if (!button || button.disabled) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void handleSend(button);
}, true);
