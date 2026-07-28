import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';

await rm('.test-dist', { recursive: true, force: true });
const compile = spawnSync('tsc', ['-p', 'tsconfig.test.json'], { stdio: 'inherit' });
if (compile.status !== 0) process.exit(compile.status ?? 1);
const tests = spawnSync(process.execPath, ['--test', 'test/*.test.mjs'], {
  stdio: 'inherit',
  shell: true,
});
process.exit(tests.status ?? 1);
