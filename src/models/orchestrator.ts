import type { QualityTier, RoutingRequest } from '../shared/types.js';

export interface NeuralStageResult {
  stage: 'scout' | 'arbiter' | 'judge';
  scores: Partial<Record<QualityTier, number>>;
  confidence: number;
}

export interface NeuralRouterRuntime {
  readonly available: boolean;
  runScout(request: RoutingRequest): Promise<NeuralStageResult | null>;
  runArbiter(request: RoutingRequest, candidates: QualityTier[]): Promise<NeuralStageResult | null>;
  runJudge(request: RoutingRequest, candidates: QualityTier[]): Promise<NeuralStageResult | null>;
}

export class DeterministicOnlyRuntime implements NeuralRouterRuntime {
  readonly available = false;
  async runScout(): Promise<null> { return null; }
  async runArbiter(): Promise<null> { return null; }
  async runJudge(): Promise<null> { return null; }
}

export const neuralRuntime: NeuralRouterRuntime = new DeterministicOnlyRuntime();
