import assert from 'node:assert/strict';
import test from 'node:test';
import { appendBrevityInstruction, BREVITY_MARKER } from '../mcp/pipeline/brevity.mjs';
import { chunkText, reassembleChunks } from '../mcp/pipeline/chunking.mjs';
import { normalizePrepareArguments } from '../mcp/pipeline/contracts.mjs';
import { prepareRequest } from '../mcp/pipeline/prepare.mjs';

test('prepare_request defaults to routing only', () => {
  const normalized = normalizePrepareArguments({ prompt: 'Rewrite this sentence.' });
  assert.deepEqual(normalized.features, {
    routing: true,
    compression: false,
    brevity: false,
    fileToMarkdown: false,
  });
});

test('brevity steering is appended at the end and is idempotent', () => {
  const once = appendBrevityInstruction('Explain the result.', 'concise');
  const twice = appendBrevityInstruction(once, 'concise');
  assert.equal(once, twice);
  assert.ok(once.endsWith(`${BREVITY_MARKER.end}`));
  assert.equal((once.match(/switchboard:brevity:start/g) ?? []).length, 1);
});

test('brevity marker stripping cleans up an unterminated block instead of leaving it orphaned', () => {
  // A start marker with no matching end (truncated content, or a malformed marker) is stale brevity
  // scaffolding. Leaving it untouched let a second full block get appended alongside the orphaned
  // one on the next call.
  const truncated = `Some reply text.\n\n${BREVITY_MARKER.start}\nReply instruction: partial`;
  const once = appendBrevityInstruction(truncated, 'concise');
  assert.equal((once.match(/switchboard:brevity:start/g) ?? []).length, 1);
  const twice = appendBrevityInstruction(once, 'concise');
  assert.equal(once, twice);
});

test('chunking never splits a surrogate pair', () => {
  // A long run of astral characters (emoji) with no whitespace anywhere forces the hard
  // character-count fallback, which has no content awareness and can otherwise land a chunk
  // boundary between a high and low surrogate. reassembleChunks recombines a split pair losslessly
  // in JS-string space, but a lone surrogate has no valid UTF-8 encoding: any consumer that
  // re-encodes a chunk on its own (the compression sidecar, over its UTF-8 stdin pipe) would
  // silently replace it with U+FFFD before the model ever sees it.
  const source = '😀'.repeat(400);
  const chunks = chunkText(source, { maxCharacters: 128 });
  assert.ok(chunks.length > 1);
  assert.equal(reassembleChunks(chunks), source);
  for (const chunk of chunks) {
    const first = chunk.text.charCodeAt(0);
    const last = chunk.text.charCodeAt(chunk.text.length - 1);
    assert.ok(!(first >= 0xdc00 && first <= 0xdfff), `chunk ${chunk.index} starts with a lone low surrogate`);
    assert.ok(!(last >= 0xd800 && last <= 0xdbff), `chunk ${chunk.index} ends with a lone high surrogate`);
  }
});

test('chunking preserves the source exactly before compression', () => {
  const source = ['# Heading', '', 'First paragraph. '.repeat(120), '', '```ts', 'const value = 1;', '```', '', 'Last paragraph.'].join(
    '\n',
  );
  const chunks = chunkText(source, { maxCharacters: 300 });
  assert.ok(chunks.length > 2);
  assert.equal(reassembleChunks(chunks), source);
  assert.equal(
    chunks.some((chunk) => chunk.protected),
    true,
  );
});

test('the pipeline routes the original request before conversion or compression', async () => {
  const calls = [];
  const normalized = normalizePrepareArguments({
    prompt: 'Please provide a very detailed explanation of the attached agreement.',
    features: { routing: true, compression: true, brevity: true, fileToMarkdown: true },
    attachments: [
      { name: 'agreement.txt', contentBase64: Buffer.from('The agreement renews automatically every year.').toString('base64') },
    ],
  });

  const result = await prepareRequest(normalized, {
    route: (routeArguments) => {
      calls.push(['route', routeArguments.request.prompt]);
      return { tier: 'balanced', effort: 'medium' };
    },
    convertAttachment: () => {
      calls.push(['convert']);
      return { name: 'agreement.txt', mediaType: 'text/plain', markdown: 'The agreement renews automatically every year.', warnings: [] };
    },
    compressChunks: (chunks) => {
      calls.push(['compress']);
      return {
        chunks: chunks.map((chunk) => ({ ...chunk, text: chunk.text.replaceAll('very ', '') })),
        model: 'test-compressor',
        warnings: [],
      };
    },
  });

  assert.deepEqual(
    calls.map(([name]) => name),
    ['route', 'convert', 'compress'],
  );
  assert.equal(calls[0][1], normalized.route.request.prompt);
  assert.equal(result.route.tier, 'balanced');
  assert.match(result.preparedPrompt, /agreement renews automatically/);
  assert.doesNotMatch(result.preparedPrompt, /very detailed/);
  assert.ok(result.preparedPrompt.endsWith(BREVITY_MARKER.end));
});

test('each feature can be disabled independently', async () => {
  const normalized = normalizePrepareArguments({
    prompt: 'Keep this unchanged.',
    features: { routing: false, compression: false, brevity: false, fileToMarkdown: false },
  });
  const unexpected = () => {
    throw new Error('disabled dependency was called');
  };
  const result = await prepareRequest(normalized, {
    route: unexpected,
    convertAttachment: unexpected,
    compressChunks: unexpected,
  });
  assert.equal(result.route, null);
  assert.equal(result.preparedPrompt, 'Keep this unchanged.');
  assert.deepEqual(result.warnings, []);
});

test('compression failure is lossless and visible', async () => {
  const prompt = 'This prompt must survive a compressor failure byte for byte. '.repeat(20).trim();
  const normalized = normalizePrepareArguments({
    prompt,
    features: { routing: false, compression: true, brevity: false, fileToMarkdown: false },
    compression: { minimumCharacters: 1 },
  });
  const result = await prepareRequest(normalized, {
    compressChunks: () => {
      throw new Error('sidecar unavailable');
    },
  });
  assert.equal(result.preparedPrompt, prompt);
  assert.equal(result.stages.compression.status, 'fallback');
  assert.match(result.warnings.join('\n'), /sidecar unavailable/);
});
