import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const tscBin = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));

await rm('.test-dist', { recursive: true, force: true });
const compile = spawnSync(process.execPath, [tscBin, '-p', 'tsconfig.test.json'], { stdio: 'inherit' });
if (compile.status !== 0) process.exit(compile.status ?? 1);
const tests = spawnSync(process.execPath, ['--test', 'test/*.test.mjs'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    SWITCHBOARD_ROUTER_MODULE: '.test-dist/router/route.js',
  },
});
process.exit(tests.status ?? 1);
