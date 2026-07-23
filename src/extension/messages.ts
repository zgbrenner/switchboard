import type { OverrideLearningEvent } from '../router/personalization.js';
import type { SwitchboardSettings } from './settings.js';

export type SwitchboardMessage =
  | { type: 'get-settings' }
  | { type: 'save-settings'; settings: SwitchboardSettings }
  | { type: 'update-settings'; patch: Partial<SwitchboardSettings> }
  | { type: 'record-override'; event: OverrideLearningEvent }
  | { type: 'clear-data' }
  | { type: 'get-status' };

export interface SwitchboardStatus {
  version: string;
  localOnly: true;
  modelPacks: 'not-installed';
}
