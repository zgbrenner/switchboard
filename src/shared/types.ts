export type QualityTier = 'fast' | 'balanced' | 'deep' | 'max';
export type EffortLevel = 'low' | 'medium' | 'high' | 'max';
export type RoutingPolicy = 'best' | 'balanced' | 'fast' | 'conserve';
export type DetectedFileType =
  | 'text'
  | 'markdown'
  | 'html'
  | 'json'
  | 'csv'
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'xlsx'
  | 'zip'
  | 'image'
  | 'unknown';

export interface CapabilitySet {
  web: boolean;
  files: boolean;
  vision: boolean;
  longContext: boolean;
  code: boolean;
}

export interface FileCapabilities {
  files: boolean;
  vision: boolean;
  longContext: boolean;
}

export interface FileInsight {
  name: string;
  size: number;
  detectedType: DetectedFileType;
  mediaType: string;
  textLength: number;
  excerpt: string;
  warnings: string[];
  capabilities: FileCapabilities;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface RouterPreferences {
  policy: RoutingPolicy;
  categoryBoosts?: Readonly<Record<string, number>>;
}

export interface RoutingRequest {
  prompt: string;
  context: ConversationTurn[];
  files: FileInsight[];
  preferences: RouterPreferences;
}

export interface RoutingReason {
  code: string;
  detail: string;
  weight: number;
}

export interface RoutingDecision {
  tier: QualityTier;
  effort: EffortLevel;
  capabilities: CapabilitySet;
  confidence: number;
  shouldUseJudge: boolean;
  reasons: RoutingReason[];
  scores: Record<QualityTier, number>;
  taskCategories: string[];
}

export interface RouteCandidateScore {
  tier: QualityTier;
  score: number;
}
