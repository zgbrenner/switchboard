import assert from 'node:assert/strict';
import test from 'node:test';
import { extractProxyRequirements, filterCompatibleUpstreams, validateProxyConfig } from '../.test-dist/proxy/index.js';

function endpoint(id, capabilities) {
  const config = validateProxyConfig({
    routes: {
      responses: {
        balanced: {
          id,
          baseUrl: `https://${id}.invalid/v1`,
          model: id,
          capabilities,
        },
      },
    },
  });
  return config.routes.responses.balanced[0];
}

test('Responses requirements detect tools, vision, JSON, reasoning, and output limits without retaining content', () => {
  const requirements = extractProxyRequirements(
    'responses',
    {
      model: 'switchboard',
      tools: [{ type: 'function', name: 'lookup' }],
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'private prompt text' },
            { type: 'input_image', image_url: 'data:image/png;base64,private-bytes' },
          ],
        },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'answer', schema: { type: 'object' } } },
      reasoning: { effort: 'high' },
      max_output_tokens: 4096,
    },
    { requireZeroDataRetention: true },
  );
  assert.equal(requirements.tools, true);
  assert.equal(requirements.vision, true);
  assert.equal(requirements.json, true);
  assert.equal(requirements.reasoning, true);
  assert.equal(requirements.maxOutputTokens, 4096);
  assert.equal(requirements.zeroDataRetention, true);
  assert.ok(requirements.estimatedInputTokens > 0);
  assert.ok(!JSON.stringify(requirements).includes('private prompt text'));
  assert.ok(!JSON.stringify(requirements).includes('private-bytes'));
});

test('Messages requirements recognize Anthropic tools, image blocks, thinking, and max tokens', () => {
  const requirements = extractProxyRequirements('messages', {
    model: 'switchboard',
    tools: [{ name: 'lookup', input_schema: { type: 'object' } }],
    thinking: { type: 'enabled', budget_tokens: 1000 },
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'private' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'private' } },
        ],
      },
    ],
  });
  assert.equal(requirements.tools, true);
  assert.equal(requirements.vision, true);
  assert.equal(requirements.reasoning, true);
  assert.equal(requirements.maxOutputTokens, 2048);
});

test('explicit capability incompatibilities are removed while unknown metadata remains backward compatible', () => {
  const requirements = {
    tools: true,
    vision: false,
    json: true,
    reasoning: false,
    estimatedInputTokens: 1000,
    maxOutputTokens: 1000,
    zeroDataRetention: false,
  };
  const capable = endpoint('capable', { tools: true, json: true });
  const explicitNo = endpoint('no-tools', { tools: false, json: true });
  const unknown = endpoint('unknown', {});
  assert.deepEqual(
    filterCompatibleUpstreams([capable, explicitNo, unknown], requirements).map((item) => item.id),
    ['capable', 'unknown'],
  );
  assert.deepEqual(
    filterCompatibleUpstreams([capable, unknown], requirements, { strictCapabilities: true }).map((item) => item.id),
    ['capable'],
  );
});

test('privacy, context, and output limits are hard requirements', () => {
  const requirements = {
    tools: false,
    vision: false,
    json: false,
    reasoning: false,
    estimatedInputTokens: 9000,
    maxOutputTokens: 3000,
    zeroDataRetention: true,
  };
  const compatible = endpoint('compatible', {
    maxContextTokens: 16000,
    maxOutputTokens: 4000,
    dataRetention: 'zero',
  });
  const shortContext = endpoint('short-context', {
    maxContextTokens: 8000,
    maxOutputTokens: 4000,
    dataRetention: 'zero',
  });
  const shortOutput = endpoint('short-output', {
    maxContextTokens: 16000,
    maxOutputTokens: 2000,
    dataRetention: 'zero',
  });
  const retained = endpoint('retained', {
    maxContextTokens: 16000,
    maxOutputTokens: 4000,
    dataRetention: 'provider',
  });
  assert.deepEqual(
    filterCompatibleUpstreams([compatible, shortContext, shortOutput, retained], requirements).map((item) => item.id),
    ['compatible'],
  );
});
