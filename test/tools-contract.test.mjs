/**
 * Golden snapshot of the published wire contract.
 *
 * `tools/list` is a public API. Clients cache tool descriptions and models plan against the
 * schemas, so an accidental edit to a description, an annotation, or a field bound is a breaking
 * change that no other test in this suite would catch. The nine legacy tools stay pinned to their
 * existing snapshot; the additive prepare_request contract is asserted separately below.
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

test('the nine legacy tool contracts match the committed snapshot', async () => {
  const live = await liveToolList();
  const committed = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  const committedByName = new Map(committed.tools.map((tool) => [tool.name, tool]));

  assert.deepEqual(
    live.tools.filter((tool) => committedByName.has(tool.name)).map((tool) => tool.name),
    committed.tools.map((tool) => tool.name),
    'the set or order of legacy tools changed',
  );

  for (const tool of live.tools.filter((candidate) => committedByName.has(candidate.name))) {
    assert.deepEqual(
      tool,
      committedByName.get(tool.name),
      `the published contract for "${tool.name}" changed. If intended, run: npm run snapshot:update`,
    );
  }
  assert.deepEqual(
    live.tools.filter((tool) => !committedByName.has(tool.name)).map((tool) => tool.name),
    ['prepare_request'],
  );
});

test('prepare_request exposes four bounded independent feature switches', async () => {
  const { tools } = await liveToolList();
  const prepare = tools.find((tool) => tool.name === 'prepare_request');
  assert.ok(prepare);
  assert.deepEqual(Object.keys(prepare.inputSchema.properties.features.properties), [
    'routing',
    'compression',
    'brevity',
    'fileToMarkdown',
  ]);
  assert.equal(prepare.inputSchema.properties.features.properties.routing.default, true);
  assert.equal(prepare.inputSchema.properties.features.properties.compression.default, false);
  assert.equal(prepare.inputSchema.properties.features.properties.brevity.default, false);
  assert.equal(prepare.inputSchema.properties.features.properties.fileToMarkdown.default, false);
  assert.deepEqual(prepare.outputSchema.required, [
    'pipelineVersion',
    'features',
    'route',
    'preparedPrompt',
    'convertedAttachments',
    'stages',
    'warnings',
    'transforms',
    'receipt',
  ]);
});

test('every tool publishes an input and output contract and complete annotations', async () => {
  const { tools } = await liveToolList();
  assert.equal(tools.length, 10);
  for (const tool of tools) {
    assert.match(tool.name, /^[A-Za-z0-9_.-]{1,128}$/);
    assert.ok(tool.title, `${tool.name} has no title`);
    assert.ok(tool.description?.length > 0, `${tool.name} has no description`);

    for (const contract of [tool.inputSchema, tool.outputSchema]) {
      assert.ok(contract, `${tool.name} is missing a schema`);
      assert.equal(contract.type, 'object');
      assert.equal(contract.additionalProperties, false, `${tool.name} schema allows extra properties`);
    }

    for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
      assert.equal(typeof tool.annotations?.[hint], 'boolean', `${tool.name} does not declare ${hint}`);
    }
    assert.equal(tool.annotations.openWorldHint, false, `${tool.name} claims an open world`);
  }
});

test('exactly the two state-mutating tools are marked non-read-only', async () => {
  const { tools } = await liveToolList();
  const mutating = tools.filter((tool) => tool.annotations.readOnlyHint === false).map((tool) => tool.name);
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
  assert.deepEqual(undocumented, [], `input properties with no description: ${undocumented.join(', ')}`);
});
