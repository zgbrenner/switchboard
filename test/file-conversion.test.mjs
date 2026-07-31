import assert from 'node:assert/strict';
import test from 'node:test';
import { convertAttachment } from '../mcp/pipeline/files.mjs';

function inline(name, text, mediaType) {
  return { name, mediaType, contentBase64: Buffer.from(text).toString('base64') };
}

test('plain text is converted without a sidecar', async () => {
  const result = await convertAttachment(inline('notes.txt', 'alpha\nbeta', 'text/plain'));
  assert.equal(result.markdown, 'alpha\nbeta');
  assert.deepEqual(result.warnings, []);
});

test('CSV is rendered as a Markdown table', async () => {
  const result = await convertAttachment(inline('people.csv', 'name,role\nAda,Engineer\nGrace,"Rear Admiral"', 'text/csv'));
  assert.match(result.markdown, /\| name \| role \|/);
  assert.match(result.markdown, /\| Grace \| Rear Admiral \|/);
});

test('JSON is normalized inside a fenced block', async () => {
  const result = await convertAttachment(inline('settings.json', '{"enabled":true}', 'application/json'));
  assert.equal(result.markdown, '```json\n{\n  "enabled": true\n}\n```');
});

test('remote URLs are rejected rather than fetched', async () => {
  await assert.rejects(
    () => convertAttachment({ name: 'remote.pdf', path: 'https://example.com/remote.pdf' }),
    /local path/,
  );
});
