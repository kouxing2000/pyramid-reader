// The Anthropic Messages transport against a local server (no Anthropic key exists for a live
// run; the event shapes are the API's documented ones).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { checkModel, lenientSchema, stream } from '../../src/lib/providers/anthropic.js';
import { providerConfig, PROVIDERS } from '../../src/lib/providers/index.js';
import { TREE_SCHEMA } from '../../src/lib/tree.js';
import { collect, localServer, sse } from './local-server.js';

const KEY = 'sk-ant-unit-test-0000';
const PROMPT = { system: 'SYSTEM', user: 'USER', schema: { type: 'object' } };
let server;
before(async () => { server = await localServer(); });
after(() => server.close());

const cfg = (over = {}) => ({ baseUrl: `${server.base}/v1`, apiKey: KEY, model: 'claude-x', params: { thinking: { type: 'disabled' } }, ...over });
const text = (t) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } });
const stop = (reason, extra = {}) => ({ type: 'message_delta', delta: { stop_reason: reason, ...extra }, usage: { output_tokens: 9 } });
const answer = (...middle) => [
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [] } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'ping' },
  ...middle,
  { type: 'content_block_stop', index: 0 },
];

test('posts one streaming message request and yields the text deltas', async () => {
  server.requests.length = 0;
  server.reply = (req, res) => sse(res, [...answer(text('{"a"'), text(': 1}')), stop('end_turn'), { type: 'message_stop' }], { named: true });
  assert.deepEqual(await collect(stream(cfg(), PROMPT)), ['{"a"', ': 1}']);
  const [r] = server.requests;
  assert.equal(r.method, 'POST');
  assert.equal(r.url, '/v1/messages');
  assert.equal(r.headers['x-api-key'], KEY);
  assert.equal(r.headers['anthropic-version'], '2023-06-01');
  assert.equal(r.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(r.headers.authorization, undefined);
  assert.deepEqual(r.body, {
    model: 'claude-x',
    max_tokens: 16000,
    system: 'SYSTEM',
    messages: [{ role: 'user', content: 'USER' }],
    stream: true,
    output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
    thinking: { type: 'disabled' },
  });
});

test('onUsage gets the usage of message_start and of each message_delta', async () => {
  const input = { input_tokens: 11, output_tokens: 1 };
  server.reply = (req, res) => sse(res, [
    { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], usage: input } },
    text('{}'), stop('end_turn'), { type: 'message_stop' },
  ], { named: true });
  const seen = [];
  assert.deepEqual(await collect(stream(cfg({ onUsage: (u) => seen.push(u) }), PROMPT)), ['{}']);
  assert.deepEqual(seen, [input, { output_tokens: 9 }]);
});

test('thinking deltas and other blocks are not the answer', async () => {
  server.reply = (req, res) => sse(res, [
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'x' } },
    text('{}'), stop('end_turn'), { type: 'message_stop' },
  ], { named: true });
  assert.deepEqual(await collect(stream(cfg(), PROMPT)), ['{}']);
});

test('an answer cut off, refused, failing mid-stream or empty is a ProviderError', async () => {
  for (const [events, message] of [
    [[...answer(text('{"a"')), stop('max_tokens')], "the answer hit the model's output limit"],
    [[...answer(text('{')), stop('model_context_window_exceeded')], "the article is too long for the model's context window"],
    [[...answer(), stop('refusal', { stop_details: { type: 'refusal', category: null, explanation: `no ${KEY}` } })],
      'the model declined: no [key]'],
    [[...answer(), stop('refusal')], 'the model declined'],
    [[...answer(text('{')), { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }], 'Overloaded'],
    [[...answer(), stop('end_turn'), { type: 'message_stop' }], 'the stream ended without an answer'],
  ]) {
    server.reply = (req, res) => sse(res, events, { named: true });
    await assert.rejects(collect(stream(cfg(), PROMPT)), { name: 'ProviderError', message });
  }
});

test('an error status is a ProviderError in the API\'s words, key scrubbed', async () => {
  server.reply = (req, res) => res.writeHead(401, { 'content-type': 'application/json' })
    .end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } }));
  await assert.rejects(collect(stream(cfg(), PROMPT)), { name: 'ProviderError', message: '401 invalid x-api-key [key]' });
});

test('the schema sent drops the array bounds the API rejects; the prompt and validator keep them', () => {
  const sent = lenientSchema(TREE_SCHEMA);
  const bounds = [];
  const walk = (s, path) => {
    if (Array.isArray(s)) return s.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (typeof s !== 'object' || s === null) return;
    for (const k of ['minItems', 'maxItems']) if (k in s) bounds.push(`${path}.${k}`);
    for (const [k, v] of Object.entries(s)) walk(v, `${path}.${k}`);
  };
  walk(sent, '$');
  assert.deepEqual(bounds, []);
  const branch = sent.properties.branches;
  assert.deepEqual(Object.keys(branch).sort(), ['items', 'type']);
  // "0 or 2 children" reads as one plain array once its bounds are gone.
  assert.deepEqual(branch.items.properties.children, { type: 'array', items: TREE_SCHEMA.properties.branches.items.properties.children.anyOf[1].items });
  assert.deepEqual(sent.properties.kind, TREE_SCHEMA.properties.kind);
  assert.deepEqual(sent.required, TREE_SCHEMA.required);
  assert.equal(TREE_SCHEMA.properties.branches.minItems, 3); // the original is untouched
  // anyOf alternatives that still differ stay.
  assert.deepEqual(lenientSchema({ anyOf: [{ type: 'array', minItems: 1 }, { type: 'string' }] }),
    { anyOf: [{ type: 'array' }, { type: 'string' }] });
});

test('providerConfig: Anthropic\'s fixed endpoint, its key only, thinking disabled', () => {
  assert.equal(providerConfig({ provider: 'anthropic' }, {}), null);
  const c = providerConfig({ provider: 'anthropic', providers: { anthropic: { baseUrl: 'https://evil.example/v1' } } },
    { 'https://api.anthropic.com': 'k', 'https://evil.example': 'other' });
  assert.equal(c.baseUrl, 'https://api.anthropic.com/v1');
  assert.equal(c.apiKey, 'k');
  assert.equal(c.model, PROVIDERS.anthropic.model);
  assert.deepEqual(c.params, { thinking: { type: 'disabled' } });
  assert.equal(c.transport.stream, stream);
});

test('checkModel gets the model by name with the build\'s headers: 200 valid, 404 missing, 401 key, else nothing', async () => {
  const status = (code) => (req, res) => res.writeHead(code, { 'content-type': 'application/json' }).end('{}');
  server.requests.length = 0;
  server.reply = status(200);
  assert.equal(await checkModel(cfg({ model: 'claude-x 1' })), 'valid');
  const [r] = server.requests;
  assert.deepEqual([r.method, r.url, r.headers['x-api-key'], r.headers['anthropic-version'], r.headers['anthropic-dangerous-direct-browser-access']],
    ['GET', '/v1/models/claude-x%201', KEY, '2023-06-01', 'true']);
  server.reply = status(404);
  assert.equal(await checkModel(cfg()), 'missing');
  server.reply = status(401);
  assert.equal(await checkModel(cfg()), 'key');
  server.reply = status(529);
  assert.equal(await checkModel(cfg()), null);
});
