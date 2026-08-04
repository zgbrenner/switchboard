import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractAnthropicMessages,
  extractOpenAIResponses,
  inferActionKind,
  sanitizeForCleanRestart,
  stableProxySessionId,
} from '../.test-dist/proxy/index.js';

test('OpenAI Responses history pairs calls and outputs and extracts prompt context', () => {
  const body = {
    model: 'switchboard',
    prompt_cache_key: 'conversation-123',
    input: [
      { role: 'user', content: 'Fix the test' },
      { type: 'function_call', call_id: 'c1', name: 'write_file', arguments: '{"path":"x"}' },
      { type: 'function_call_output', call_id: 'c1', output: 'written' },
      { type: 'function_call', call_id: 'c2', name: 'run_tests', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c2', output: { error: 'AssertionError: red' } },
    ],
  };
  const parsed = extractOpenAIResponses(body);
  assert.equal(parsed.prompt, 'Fix the test');
  assert.equal(parsed.observations.length, 2);
  assert.equal(parsed.observations[0].input.kind, 'write');
  assert.equal(parsed.observations[1].input.kind, 'verify');
  assert.equal(parsed.observations[1].input.status, 'failure');
  assert.equal(parsed.sessionHint, 'conversation-123');
});

test('Anthropic Messages history honors tool_result is_error', () => {
  const body = {
    model: 'switchboard',
    messages: [
      { role: 'user', content: 'Audit this code' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'shell', input: { command: 'npm test' } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'TypeError' }],
      },
    ],
  };
  const parsed = extractAnthropicMessages(body);
  assert.equal(parsed.prompt, 'Audit this code');
  assert.equal(parsed.observations.length, 1);
  assert.equal(parsed.observations[0].input.status, 'failure');
  assert.equal(parsed.observations[0].input.errorClass, 'TypeError');
});

test('action inference recognizes common tool purposes', () => {
  assert.equal(inferActionKind('read_file'), 'read');
  assert.equal(inferActionKind('grep_search'), 'search');
  assert.equal(inferActionKind('write_file'), 'write');
  assert.equal(inferActionKind('run_tests'), 'verify');
  assert.equal(inferActionKind('shell'), 'execute');
});

test('clean restart keeps artifacts and tool facts while dropping narration and reasoning', () => {
  const responses = sanitizeForCleanRestart('responses', {
    model: 'switchboard',
    input: [
      { role: 'user', content: 'Do it' },
      { role: 'assistant', content: 'I think the answer is...' },
      { type: 'reasoning', encrypted_content: 'opaque' },
      { type: 'function_call', call_id: 'c1', name: 'shell', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c1', output: 'real result' },
    ],
  });
  assert.equal(
    responses.input.some((item) => item.type === 'reasoning'),
    false,
  );
  assert.equal(
    responses.input.some((item) => item.role === 'assistant'),
    false,
  );
  assert.equal(
    responses.input.some((item) => item.type === 'function_call_output'),
    true,
  );

  const messages = sanitizeForCleanRestart('messages', {
    model: 'switchboard',
    messages: [
      { role: 'user', content: 'Do it' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'dead end' },
          { type: 'text', text: 'narration' },
          { type: 'tool_use', id: 't1', name: 'shell', input: {} },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'real result' }] },
    ],
  });
  const assistantBlocks = messages.messages.find((message) => message.role === 'assistant').content;
  assert.deepEqual(
    assistantBlocks.map((block) => block.type),
    ['tool_use'],
  );
});

test('stable session id honors explicit values and otherwise stores only a digest', () => {
  assert.equal(stableProxySessionId({ explicit: 'task-1', wire: 'responses', prompt: 'secret' }), 'task-1');
  const generated = stableProxySessionId({ wire: 'responses', prompt: 'secret', clientFingerprint: 'client' });
  assert.match(generated, /^sw_[a-f0-9]{32}$/);
  assert.ok(!generated.includes('secret'));
});
