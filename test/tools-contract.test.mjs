/**
 * Golden snapshot of the published wire contract.
 *
 * `tools/list` is a public API. Clients cache tool descriptions and models plan against the
 * schemas, so an accidental edit to a description, an annotation, or a field bound is a breaking
 * change that no other test in this suite would catch. This makes every such edit show up as a
 * reviewable diff in `test/__snapshots__/tools-list.json` rather than shipping silently.
 *
 * To accept an intentional change:
 *   npm run snapshot:update
 * and review the resulting diff as part of the change.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createSwitchboardMcpSession } from '../mcp/server.mjs';

const SNAPSHOT_PATH = new URL('./__snapshots__/tools-list.json', import.meta.url);

async function liveToolList() {
  const session = createSwitchboardMcpSession({ lifecycle: 'stateless' });
  const response = await session.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  return {
    tools: response.result.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      annotations: tool.annotations,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
    })),
  };
}

test('the published tool contract matches the committed snapshot', async () => {
  const live = await liveToolList();
  const committed = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

  const liveNames = live.tools.map((tool) => tool.name);
  const committedNames = committed.tools.map((tool) => tool.name);
  assert.deepEqual(liveNames, committedNames, 'the set or order of tools changed');

  for (const [index, tool] of live.tools.entries()) {
    assert.deepEqual(
      tool,
      committed.tools[index],
      `the published contract for "${tool.name}" changed. If intended, run: npm run snapshot:update`,
    );
  }
});

test('every tool publishes an input and output contract and complete annotations', async () => {
  const { tools } = await liveToolList();
  assert.equal(tools.length, 9);
  for (const tool of tools) {
    assert.match(tool.name, /^[A-Za-z0-9_.-]{1,128}$/);
    assert.ok(tool.title, `${tool.name} has no title`);
    assert.ok(tool.description?.length > 0, `${tool.name} has no description`);

    for (const contract of [tool.inputSchema, tool.outputSchema]) {
      assert.ok(contract, `${tool.name} is missing a schema`);
      assert.equal(contract.type, 'object');
      // Unbounded object inputs are how a bounded contract silently stops being bounded.
      assert.equal(contract.additionalProperties, false, `${tool.name} schema allows extra properties`);
    }

    // The MCP defaults are hostile -- destructiveHint defaults to true and openWorldHint to true --
    // so every hint must be stated rather than inherited.
    for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
      assert.equal(typeof tool.annotations?.[hint], 'boolean', `${tool.name} does not declare ${hint}`);
    }
    // Switchboard performs no outbound I/O; any tool claiming otherwise is a bug or a lie.
    assert.equal(tool.annotations.openWorldHint, false, `${tool.name} claims an open world`);
  }
});

test('exactly the two state-mutating tools are marked non-read-only', async () => {
  const { tools } = await liveToolList();
  const mutating = tools.filter((tool) => tool.annotations.readOnlyHint === false).map((tool) => tool.name);
  // Pinned deliberately: a host may auto-approve readOnlyHint tools, so silently flipping a tool
  // into this set is a privilege change, not a cosmetic edit.
  assert.deepEqual(mutating.sort(), ['record_override', 'reset_preference_state']);
});

test('every input schema property carries a description', async () => {
  const { tools } = await liveToolList();
  const undocumented = [];
  for (const tool of tools) {
    for (const [property, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
      if (!schema.description) undocumented.push(`${tool.name}.${property}`);
    }
  }
  // Property descriptions are what the model fills arguments from. An undescribed property is a
  // parameter the model has to guess at.
  assert.deepEqual(undocumented, [], `input properties with no description: ${undocumented.join(', ')}`);
});
