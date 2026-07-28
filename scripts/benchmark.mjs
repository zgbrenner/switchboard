import { spawnSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';

await rm('.test-dist', { recursive: true, force: true });
const compile = spawnSync('tsc', ['-p', 'tsconfig.test.json'], { stdio: 'inherit' });
if (compile.status !== 0) process.exit(compile.status ?? 1);

const [{ routeRequest }, { evaluateRoutingCases, validateBenchmarkCase }] = await Promise.all([
  import('../.test-dist/router/route.js'),
  import('../.test-dist/evaluation/metrics.js'),
]);
const source = await readFile('benchmarks/router-cases.jsonl', 'utf8');
const cases = source
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line, index) => {
    try {
      return validateBenchmarkCase(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid benchmark line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
const evaluated = cases.map((benchmarkCase) => ({
  case: benchmarkCase,
  decision: routeRequest({
    prompt: benchmarkCase.prompt,
    context: benchmarkCase.context ?? [],
    files: benchmarkCase.files ?? [],
    preferences: { policy: 'balanced' },
  }),
}));
const result = evaluateRoutingCases(evaluated);
const percent = (value) => `${(value * 100).toFixed(1)}%`;
console.log(`Switchboard router benchmark (${result.total} cases)`);
console.log(`  In expected range: ${result.inRange}/${result.total} (${percent(result.inRangeRate)})`);
console.log(`  Harmful under-routes: ${result.harmfulUnderRoutes} (${percent(result.harmfulUnderRouteRate)})`);
console.log(`  Wasteful over-routes: ${result.wastefulOverRoutes}`);
console.log(`  Capability misses: ${result.capabilityMisses} (${percent(result.capabilityMissRate)})`);
for (const failure of result.failures) console.log(`  [${failure.kind}] ${failure.id}: ${failure.detail}`);
if (process.argv.includes('--strict') && (result.harmfulUnderRoutes > 0 || result.capabilityMisses > 0)) process.exit(1);
