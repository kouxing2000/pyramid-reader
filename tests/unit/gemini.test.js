// The Gemini transport against a local server. The request shape and the thinking rule are the
// live API's (see providers/index.js); scripts/smoke.mjs runs the transport for real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { checkModel, stream } from '../../src/lib/providers/gemini.js';
import { providerConfig, PROVIDERS } from '../../src/lib/providers/index.js';
import { collect, localServer, sse } from './local-server.js';

const KEY = 'AIza-unit-test-0000';
const PROMPT = { system: 'SYSTEM', user: 'USER', schema: { type: 'object' } };
let server;
before(async () => { server = await localServer(); });
after(() => server.close());

const cfg = (over = {}) => ({ baseUrl: `${server.base}/v1beta`, apiKey: KEY, model: 'gemini-x-flash',
  params: { thinkingConfig: { thinkingBudget: 0 } }, ...over });
const chunk = (parts, finishReason) => ({
  candidates: [{ content: { parts, role: 'model' }, index: 0, ...(finishReason && { finishReason }) }],
  usageMetadata: { promptTokenCount: 3 },
});

test('posts one streamGenerateContent request, key in a header, and yields the text parts', async () => {
  server.requests.length = 0;
  server.reply = (req, res) => sse(res, [chunk([{ text: '{"a"' }]), chunk([{ text: ': 1}' }]),
    chunk([{ text: '', thoughtSignature: 'sig' }], 'STOP')]);
  assert.deepEqual(await collect(stream(cfg({ model: 'models/gemini-x-flash' }), PROMPT)), ['{"a"', ': 1}']);
  const [r] = server.requests;
  assert.equal(r.method, 'POST');
  assert.equal(r.url, '/v1beta/models/gemini-x-flash:streamGenerateContent?alt=sse');
  assert.equal(r.headers['x-goog-api-key'], KEY);
  assert.ok(!r.url.includes(KEY));
  assert.deepEqual(r.body, {
    systemInstruction: { parts: [{ text: 'SYSTEM' }] },
    contents: [{ role: 'user', parts: [{ text: 'USER' }] }],
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: { type: 'object' }, thinkingConfig: { thinkingBudget: 0 } },
  });
});

test('thought parts are not the answer', async () => {
  server.reply = (req, res) => sse(res, [chunk([{ text: 'planning', thought: true }, { text: '{}' }], 'STOP')]);
  assert.deepEqual(await collect(stream(cfg(), PROMPT)), ['{}']);
});

test('onUsage gets each chunk\'s usageMetadata, the last one covering the whole answer', async () => {
  const last = { promptTokenCount: 3, candidatesTokenCount: 5, totalTokenCount: 8 };
  server.reply = (req, res) => sse(res, [chunk([{ text: '{' }]), { ...chunk([{ text: '}' }], 'STOP'), usageMetadata: last }]);
  const seen = [];
  assert.deepEqual(await collect(stream(cfg({ onUsage: (u) => seen.push(u) }), PROMPT)), ['{', '}']);
  assert.deepEqual(seen, [{ promptTokenCount: 3 }, last]);
});

test('an answer cut off, filtered, blocked, failing mid-stream or empty is a ProviderError', async () => {
  for (const [events, message] of [
    [[chunk([{ text: '{"a"' }], 'MAX_TOKENS')], "the answer hit the model's output limit"],
    [[chunk([{ text: '{' }]), chunk([], 'SAFETY')], "the provider's safety filter stopped the answer"],
    [[chunk([{ text: '{' }], 'RECITATION')], 'the provider stopped the answer for quoting its source at length (RECITATION)'],
    [[chunk([], 'PROHIBITED_CONTENT')], 'the provider stopped the answer (PROHIBITED_CONTENT)'],
    [[{ promptFeedback: { blockReason: 'OTHER' } }], 'the provider refused the article (OTHER)'],
    [[chunk([{ text: '{' }]), { error: { code: 503, message: `busy ${KEY}`, status: 'UNAVAILABLE' } }], 'busy [key]'],
    [[chunk([{ text: '' }], 'STOP')], 'the stream ended without an answer'],
  ]) {
    server.reply = (req, res) => sse(res, events);
    await assert.rejects(collect(stream(cfg(), PROMPT)), { name: 'ProviderError', message });
  }
});

// As the live API sends it: an error status with an event-stream content type.
test('an error status is a ProviderError in the API\'s words', async () => {
  server.reply = (req, res) => res.writeHead(400, { 'content-type': 'text/event-stream' }).end(JSON.stringify(
    { error: { code: 400, message: 'Budget 0 is invalid. This model only works in thinking mode.', status: 'INVALID_ARGUMENT' } }));
  await assert.rejects(collect(stream(cfg(), PROMPT)),
    { name: 'ProviderError', message: '400 Budget 0 is invalid. This model only works in thinking mode.' });
});

test('providerConfig: Gemini\'s fixed endpoint; thinking budget 0 except the flash-lite models', () => {
  const at = (model) => providerConfig({ provider: 'gemini', providers: { gemini: { model } } },
    { 'https://generativelanguage.googleapis.com': 'k' });
  assert.equal(providerConfig({ provider: 'gemini' }, {}), null);
  const c = at(undefined);
  assert.equal(c.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
  assert.equal(c.model, PROVIDERS.gemini.model);
  assert.equal(c.transport.stream, stream);
  for (const model of ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-pro-latest']) {
    assert.deepEqual(at(model).params, { thinkingConfig: { thinkingBudget: 0 } }, model);
  }
  for (const model of ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite']) {
    assert.deepEqual(at(model).params, {}, model);
  }
});

// As Gemini answered, probed 2026-09-24: a typo is 404, a bad key a 400 whose reason is API_KEY_INVALID.
test('checkModel gets the model by name, key in a header: 200 valid, 404 missing, a bad key\'s 400 key, else nothing', async () => {
  const status = (code, body = {}) => (req, res) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  server.requests.length = 0;
  server.reply = status(200, { name: 'models/gemini-x-flash' });
  assert.equal(await checkModel(cfg({ model: 'models/gemini-x-flash' })), 'valid');
  const [r] = server.requests;
  assert.deepEqual([r.method, r.url, r.headers['x-goog-api-key']], ['GET', '/v1beta/models/gemini-x-flash', KEY]);
  server.reply = status(404, { error: { code: 404, status: 'NOT_FOUND' } });
  assert.equal(await checkModel(cfg()), 'missing');
  server.reply = status(400, { error: { code: 400, status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } });
  assert.equal(await checkModel(cfg()), 'key');
  server.reply = status(400, { error: { code: 400, status: 'INVALID_ARGUMENT' } });
  assert.equal(await checkModel(cfg()), null);
});
