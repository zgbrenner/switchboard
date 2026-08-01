import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const tscBin = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));

await rm('dist/js/router', { recursive: true, force: true });
await rm('dist/js/shared', { recursive: true, force: true });
const result = spawnSync(process.execPath, [tscBin, '-p', 'tsconfig.mcp.json'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Built Switchboard MCP router runtime in dist/js/.');
