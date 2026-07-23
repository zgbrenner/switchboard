import type { QualityTier, RoutingDecision } from '../shared/types.js';

export interface PanelActions {
  onTierSelected(tier: QualityTier): void;
  onPause(): void;
}

const TIER_LABELS: Record<QualityTier, string> = {
  fast: 'Fast', balanced: 'Balanced', deep: 'Deep', max: 'Max',
};

export class SwitchboardPanel {
  readonly root: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly reasons: HTMLDivElement;
  private readonly actions: PanelActions;

  constructor(actions: PanelActions) {
    this.actions = actions;
    this.root = document.createElement('div');
    this.root.id = 'switchboard-root';
    this.root.innerHTML = `
      <div class="switchboard-card">
        <div class="switchboard-header">
          <span class="switchboard-mark">S</span>
          <div class="switchboard-title">Switchboard</div>
          <button class="switchboard-pause" type="button" aria-label="Pause Switchboard for this page">Pause</button>
        </div>
        <div class="switchboard-detail">Ready to route locally.</div>
        <div class="switchboard-reasons"></div>
        <div class="switchboard-tiers"></div>
      </div>`;
    this.title = this.root.querySelector('.switchboard-title') as HTMLDivElement;
    this.detail = this.root.querySelector('.switchboard-detail') as HTMLDivElement;
    this.reasons = this.root.querySelector('.switchboard-reasons') as HTMLDivElement;
    const tiers = this.root.querySelector('.switchboard-tiers') as HTMLDivElement;
    (Object.keys(TIER_LABELS) as QualityTier[]).forEach((tier) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.tier = tier;
      button.textContent = TIER_LABELS[tier];
      button.addEventListener('click', () => this.actions.onTierSelected(tier));
      tiers.append(button);
    });
    (this.root.querySelector('.switchboard-pause') as HTMLButtonElement).addEventListener('click', () => this.actions.onPause());
    document.documentElement.append(this.root);
  }

  setStatus(title: string, detail: string): void {
    this.title.textContent = title;
    this.detail.textContent = detail;
    this.reasons.replaceChildren();
    this.root.dataset.state = 'active';
  }

  showDecision(decision: RoutingDecision, note: string, showReasons: boolean): void {
    this.title.textContent = `${TIER_LABELS[decision.tier]} · ${Math.round(decision.confidence * 100)}%`;
    this.detail.textContent = note;
    this.root.dataset.tier = decision.tier;
    this.root.dataset.state = 'active';
    this.root.querySelectorAll<HTMLButtonElement>('[data-tier]').forEach((button) => {
      button.dataset.selected = String(button.dataset.tier === decision.tier);
    });
    this.reasons.replaceChildren();
    if (showReasons) {
      decision.reasons.slice(0, 3).forEach((reason) => {
        const row = document.createElement('div');
        row.textContent = reason.detail;
        this.reasons.append(row);
      });
    }
  }

  showError(message: string): void {
    this.title.textContent = 'Switchboard fallback';
    this.detail.textContent = message;
    this.reasons.replaceChildren();
    this.root.dataset.state = 'error';
  }

  hide(): void {
    this.root.dataset.state = 'hidden';
  }
}
