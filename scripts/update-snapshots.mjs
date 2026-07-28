/** Regenerate the committed wire-contract snapshot. Review the resulting diff before committing. */
import { mkdir, writeFile } from 'node:fs/promises';
import { createSwitchboardMcpSession } from '../mcp/server.mjs';

const session = createSwitchboardMcpSession({ lifecycle: 'stateless' });
const response = await session.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
const snapshot = {
  tools: response.result.tools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    annotations: tool.annotations,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  })),
};
await mkdir(new URL('../test/__snapshots__/', import.meta.url), { recursive: true });
await writeFile(new URL('../test/__snapshots__/tools-list.json', import.meta.url), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Updated the tool contract snapshot (${snapshot.tools.length} tools). Review the diff.`);
