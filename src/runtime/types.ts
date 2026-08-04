import type { EffortLevel, QualityTier } from '../shared/types.js';

export type RuntimeActionKind = 'read' | 'search' | 'write' | 'execute' | 'verify' | 'communicate' | 'other';
export type RuntimeObservationStatus = 'pending' | 'success' | 'failure';
export type RuntimeSignalSeverity = 'warning' | 'severe';
export type RuntimeSignalCode =
  | 'action-observation-repeat'
  | 'repeated-error-class'
  | 'ping-pong'
  | 'rewrite-retest-cycle'
  | 'consecutive-failures'
  | 'steps-since-progress';
export type RuntimeDecisionAction =
  | 'continue'
  | 'raise_effort'
  | 'switch_model'
  | 'restart_clean'
  | 'escalate_human'
  | 'stop_budget';

export interface RuntimeObservationInput {
  sequence?: number;
  timestamp?: number;
  tool: string;
  kind: RuntimeActionKind;
  status: RuntimeObservationStatus;
  arguments?: unknown;
  output?: unknown;
  errorClass?: string;
  relativeCost?: number;
  contextTokens?: number;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface RuntimeNormalizationOptions {
  includePreview?: boolean;
  previewCharacters?: number;
}

export interface RuntimeEvidenceStep {
  id: string;
  sequence: number;
  timestamp: number;
  tool: string;
  kind: RuntimeActionKind;
  status: RuntimeObservationStatus;
  argumentsDigest: string;
  outputDigest?: string;
  preview?: string;
  errorClass?: string;
  relativeCost: number;
  contextTokens: number;
  metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface RuntimeSignal {
  code: RuntimeSignalCode;
  severity: RuntimeSignalSeverity;
  detail: string;
  evidenceIds: string[];
}

export interface RuntimePolicyConfig {
  maxRelativeCost: number;
  maxContextTokens: number;
  maxSwitches: number;
  maxRestarts: number;
  maxRetainedSteps: number;
  actionRepeatThreshold: number;
  errorRepeatThreshold: number;
  pingPongThreshold: number;
  rewriteRetestThreshold: number;
  maxConsecutiveFailures: number;
  maxStepsWithoutProgress: number;
  badCheckpointThreshold: number;
}

export interface RuntimeDecision {
  action: RuntimeDecisionAction;
  reasonCodes: string[];
  signals: RuntimeSignal[];
  targetTier?: QualityTier;
  targetEffort?: EffortLevel;
  preserveArtifacts: boolean;
  dropNarration: boolean;
}

export interface RuntimeSessionConfig {
  id: string;
  initialTier: QualityTier;
  initialEffort: EffortLevel;
  modelLadder?: QualityTier[];
  policy?: Partial<RuntimePolicyConfig>;
}

export interface RuntimeSessionSnapshot {
  id: string;
  initialTier: QualityTier;
  currentTier: QualityTier;
  currentEffort: EffortLevel;
  modelLadder: QualityTier[];
  steps: RuntimeEvidenceStep[];
  decisions: RuntimeDecision[];
  totalSteps: number;
  relativeCost: number;
  contextTokens: number;
  switches: number;
  restarts: number;
  badCheckpoints: number;
  createdAt: number;
  lastAccessedAt: number;
}

export interface RuntimeObservationResult {
  step: RuntimeEvidenceStep;
  signals: RuntimeSignal[];
  decision: RuntimeDecision;
  snapshot: RuntimeSessionSnapshot;
}

export interface RuntimePolicyState {
  initialTier: QualityTier;
  currentTier: QualityTier;
  currentEffort: EffortLevel;
  modelLadder: QualityTier[];
  relativeCost: number;
  contextTokens: number;
  switches: number;
  restarts: number;
  badCheckpoints: number;
}

export interface RuntimeSessionStoreOptions {
  maxSessions?: number;
  ttlMs?: number;
  now?: () => number;
}
