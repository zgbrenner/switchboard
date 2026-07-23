import type { ConversationTurn, QualityTier } from '../shared/types.js';
import { rankModelLabels, type SupportedSite } from './model-selection.js';

export type { SupportedSite } from './model-selection.js';

export interface SiteAdapter {
  site: SupportedSite;
  findComposer(): HTMLElement | null;
  readPrompt(): string;
  findSendButton(): HTMLButtonElement | null;
  isSendTarget(target: Element): boolean;
  collectRecentContext(limit: number): ConversationTurn[];
  conversationHasHistory(): boolean;
  switchToTier(tier: QualityTier): Promise<{ switched: boolean; model?: string; reason?: string }>;
}

function visible(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getBoundingClientRect().width > 0;
}

function textOf(element: Element): string {
  return (element.getAttribute('aria-label') ?? element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function findFirst(selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    const match = [...document.querySelectorAll(selector)].find(visible);
    if (match) return match;
  }
  return null;
}

function promptFrom(element: HTMLElement | null): string {
  if (!element) return '';
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value.trim();
  return (element.innerText || element.textContent || '').trim();
}

function findSendButton(selectors: readonly string[]): HTMLButtonElement | null {
  const direct = findFirst(selectors);
  if (direct instanceof HTMLButtonElement) return direct;
  return [...document.querySelectorAll('button')]
    .filter(visible)
    .find((button) => /^(send|submit)( message)?$/i.test(textOf(button))) as HTMLButtonElement | undefined ?? null;
}

function candidatePicker(selectors: readonly string[]): HTMLElement | null {
  const selected = findFirst(selectors);
  if (selected) return selected;
  return [...document.querySelectorAll('header button, nav button')]
    .filter(visible)
    .find((button) => /model|gpt|claude|sonnet|opus|haiku|thinking|pro/i.test(textOf(button))) as HTMLElement | undefined ?? null;
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function selectVisibleModel(site: SupportedSite, picker: HTMLElement | null, tier: QualityTier): Promise<{ switched: boolean; model?: string; reason?: string }> {
  if (!picker) return { switched: false, reason: 'The model picker was not found.' };
  picker.click();
  await wait(180);
  const options = [...document.querySelectorAll('[role="menuitem"], [role="option"], [data-radix-collection-item], [data-headlessui-menu-item], [data-testid*="model"], div[tabindex="0"], button')]
    .filter(visible)
    .map((element) => ({ element: element as HTMLElement, label: textOf(element) }));
  const ranked = rankModelLabels(site, tier, options.map((option) => option.label));
  const bestRank = ranked[0];
  const best = bestRank ? options[bestRank.index] : undefined;
  if (!best) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { switched: false, reason: 'No compatible visible model option matched the route.' };
  }
  best.element.click();
  await wait(120);
  return { switched: true, model: best.label };
}

function collectTurns(userSelectors: readonly string[], assistantSelectors: readonly string[], limit: number): ConversationTurn[] {
  const nodes: { role: 'user' | 'assistant'; element: Element }[] = [];
  for (const selector of userSelectors) document.querySelectorAll(selector).forEach((element) => nodes.push({ role: 'user', element }));
  for (const selector of assistantSelectors) document.querySelectorAll(selector).forEach((element) => nodes.push({ role: 'assistant', element }));
  nodes.sort((left, right) => {
    const position = left.element.compareDocumentPosition(right.element);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
  return nodes.slice(-limit).map(({ role, element }) => ({ role, text: textOf(element).slice(0, 12_000) })).filter((turn) => turn.text.length > 0);
}

function chatGptAdapter(): SiteAdapter {
  const composerSelectors = ['#prompt-textarea', '[data-testid="prompt-textarea"]', 'textarea[placeholder*="Message"]', '[contenteditable="true"][data-virtualkeyboard]'];
  const sendSelectors = ['button[data-testid="send-button"]', 'button[aria-label^="Send"]', 'button[aria-label="Send prompt"]'];
  return {
    site: 'chatgpt',
    findComposer: () => findFirst(composerSelectors),
    readPrompt: () => promptFrom(findFirst(composerSelectors)),
    findSendButton: () => findSendButton(sendSelectors),
    isSendTarget: (target) => Boolean(target.closest(sendSelectors.join(','))) || /^(send|submit)/i.test(textOf(target)),
    collectRecentContext: (limit) => collectTurns(['[data-message-author-role="user"]'], ['[data-message-author-role="assistant"]'], limit),
    conversationHasHistory: () => document.querySelectorAll('[data-message-author-role]').length > 1,
    switchToTier: (tier) => selectVisibleModel('chatgpt', candidatePicker(['button[data-testid*="model"]', 'header button[aria-haspopup="menu"]', 'button[aria-label*="model" i]']), tier),
  };
}

function claudeAdapter(): SiteAdapter {
  const composerSelectors = ['[contenteditable="true"].ProseMirror', '[contenteditable="true"][data-placeholder]', 'fieldset [contenteditable="true"]'];
  const sendSelectors = ['button[aria-label^="Send"]', 'button[data-testid*="send"]'];
  return {
    site: 'claude',
    findComposer: () => findFirst(composerSelectors),
    readPrompt: () => promptFrom(findFirst(composerSelectors)),
    findSendButton: () => findSendButton(sendSelectors),
    isSendTarget: (target) => Boolean(target.closest(sendSelectors.join(','))) || /^(send|submit)/i.test(textOf(target)),
    collectRecentContext: (limit) => collectTurns(['[data-testid="user-message"]', '.font-user-message'], ['[data-testid="assistant-message"]', '.font-claude-response'], limit),
    conversationHasHistory: () => document.querySelectorAll('[data-testid$="message"], .font-user-message, .font-claude-response').length > 1,
    switchToTier: (tier) => selectVisibleModel('claude', candidatePicker(['button[aria-label*="model" i]', 'button[data-testid*="model"]', 'header button[aria-haspopup="menu"]']), tier),
  };
}

export function getSiteAdapter(): SiteAdapter | null {
  if (location.hostname === 'chatgpt.com' || location.hostname.endsWith('.chatgpt.com')) return chatGptAdapter();
  if (location.hostname === 'claude.ai' || location.hostname.endsWith('.claude.ai')) return claudeAdapter();
  return null;
}
