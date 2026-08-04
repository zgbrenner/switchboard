import { DeterministicRuntimeJudge } from '../judge/deterministic.js';
import { RemoteRuntimeJudge } from '../judge/remote.js';
import type { RuntimeJudge } from '../judge/types.js';
import type { ProxyJudgeConfig } from './types.js';

export function createProxyJudge(config: ProxyJudgeConfig): RuntimeJudge {
  if (config.type === 'deterministic') return new DeterministicRuntimeJudge();
  return new RemoteRuntimeJudge({
    endpoint: config.endpoint,
    timeoutMs: config.timeoutMs,
    ...(config.token === undefined ? {} : { token: config.token }),
  });
}
