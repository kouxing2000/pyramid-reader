// The chat-completions transport against a real local HTTP server, through Node's fetch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { checkModel, stream } from '../../src/lib/providers/chat-completions.js';
import { ProviderError } from '../../src/lib/providers/http.js';
import { originPattern, providerConfig, PROVIDERS } from '../../src/lib/providers/index.js';

const KEY = 'sk-unit-test-0000';
const PROMPT = { system: 'SYSTEM', user: 'USER', schema: { type: 'object' } };
let server;
let base;
let reply; // (req, res, body) => void, set per test
const requests = [];

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const record = { method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body || 'null'), closed: false };
      requests.push(record);
      res.on('close', () => { record.closed = !res.writableFinished; });
      reply(req, res, record);
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}/v1`;
});
after(() => new Promise((ok) => server.close(ok)));

const sse = (res, events, { done = true } = {}) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
  if (done) res.write('data: [DONE]\n\n');
  res.end();
};
const delta = (content, finish = null) => ({ choices: [{ index: 0, delta: { content }, finish_reason: finish }] });
const collect = async (cfg) => {
  const out = [];
  for await (const d of stream(cfg, PROMPT)) out.push(d);
  return out;
};
const cfg = (over = {}) => ({ baseUrl: base, apiKey: KEY, model: 'm1', jsonMode: 'json_schema', params: {}, ...over });

test('posts one streaming chat completion and yields the content deltas', async () => {
  requests.length = 0;
  reply = (req, res) => sse(res, [{ choices: [{ delta: { role: 'assistant' } }] }, delta('{"a"'), delta(': 1}'),
    delta('', 'stop'), { choices: [], usage: { total_tokens: 9 } }]);
  assert.deepEqual(await collect(cfg({ params: { reasoning_effort: 'none' } })), ['{"a"', ': 1}']);
  const [r] = requests;
  assert.equal(r.method, 'POST');
  assert.equal(r.url, '/v1/chat/completions');
  assert.equal(r.headers.authorization, `Bearer ${KEY}`);
  assert.equal(r.headers['content-type'], 'application/json');
  assert.deepEqual(r.body, {
    model: 'm1',
    messages: [{ role: 'system', content: 'SYSTEM' }, { role: 'user', content: 'USER' }],
    stream: true,
    response_format: { type: 'json_schema', json_schema: { name: 'pyramid_tree', strict: true, schema: PROMPT.schema } },
    reasoning_effort: 'none',
  });
});

test('onUsage gets the usage the stream reports, which is not part of the answer', async () => {
  const usage = { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 };
  reply = (req, res) => sse(res, [delta('{}'), delta('', 'stop'), { choices: [], usage }]);
  const seen = [];
  assert.deepEqual(await collect(cfg({ params: { stream_options: { include_usage: true } }, onUsage: (u) => seen.push(u) })), ['{}']);
  assert.deepEqual(seen, [usage]);
  assert.deepEqual(requests.at(-1).body.stream_options, { include_usage: true });
});

test('JSON mode follows the endpoint; no key sends no Authorization header', async () => {
  requests.length = 0;
  reply = (req, res) => sse(res, [delta('{}')], { done: false });
  await collect(cfg({ jsonMode: 'json_object', apiKey: '', baseUrl: `${base}/` }));
  assert.deepEqual(requests[0].body.response_format, { type: 'json_object' });
  assert.equal(requests[0].headers.authorization, undefined);
  assert.equal(requests[0].url, '/v1/chat/completions');
});

test('an error status becomes a ProviderError with the provider\'s message, key scrubbed', async () => {
  reply = (req, res) => res.writeHead(401, { 'content-type': 'application/json' })
    .end(JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}.` } }));
  await assert.rejects(collect(cfg()), (e) => e instanceof ProviderError &&
    e.message === '401 Incorrect API key provided: [key].');
  reply = (req, res) => res.writeHead(502).end('Bad gateway');
  await assert.rejects(collect(cfg()), { name: 'ProviderError', message: '502 Bad gateway' });
});

test('an answer cut off, filtered, refused or failing mid-stream is a ProviderError', async () => {
  for (const [events, message] of [
    [[delta('{"a"'), delta('', 'length')], "the answer hit the model's output limit"],
    [[delta('', 'content_filter')], "the provider's content filter stopped the answer"],
    [[{ choices: [{ delta: { refusal: 'I can' } }] }, { choices: [{ delta: { refusal: 'not.' }, finish_reason: 'stop' }] }],
      'the model declined: I cannot.'],
    [[delta('{'), { error: { message: 'overloaded' } }], 'overloaded'],
  ]) {
    reply = (req, res) => sse(res, events);
    await assert.rejects(collect(cfg()), { name: 'ProviderError', message });
  }
});

test('a response that is not a stream, or a stream with no answer, is a ProviderError', async () => {
  for (const [send, message] of [
    [(res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: '{}' } }] })),
      'the endpoint sent application/json, not a stream'],
    [(res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: `quota exceeded for ${KEY}` } })),
      'quota exceeded for [key]'],
    [(res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<html>Log in to the Wi-Fi</html>'),
      'the endpoint sent text/html, not a stream'],
    [(res) => res.writeHead(429, { 'content-type': 'application/json' }).end('{"error": "slow down"}'), '429 slow down'],
    [(res) => sse(res, [delta('', 'stop')]), 'the stream ended without an answer'],
  ]) {
    reply = (req, res) => send(res);
    await assert.rejects(collect(cfg()), { name: 'ProviderError', message });
  }
});

test('an unreachable endpoint is a ProviderError naming its origin', async () => {
  const closed = http.createServer();
  await new Promise((ok) => closed.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${closed.address().port}`;
  await new Promise((ok) => closed.close(ok));
  await assert.rejects(collect(cfg({ baseUrl: `${url}/v1` })),
    (e) => e instanceof ProviderError && e.message.startsWith(`could not reach ${url} (`));
});

test('stopping the stream early ends the request', async () => {
  requests.length = 0;
  reply = (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const timer = setInterval(() => res.write(`data: ${JSON.stringify(delta('x'))}\n\n`), 5);
    res.on('close', () => clearInterval(timer));
  };
  for await (const d of stream(cfg(), PROMPT)) {
    assert.equal(d, 'x');
    break;
  }
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(requests[0].closed, true);
});

test('an abort signal ends the request with an AbortError, whichever body is arriving', async () => {
  for (const [status, type] of [[200, 'text/event-stream'], [503, 'application/json'], [200, 'application/json']]) {
    reply = (req, res) => { res.writeHead(status, { 'content-type': type }); res.write(type === 'text/event-stream' ? ': hold\n\n' : '{'); };
    const ac = new AbortController();
    const it = stream(cfg(), PROMPT, ac.signal);
    setTimeout(() => ac.abort(), 30);
    await assert.rejects(it.next(), { name: 'AbortError' }, `${status} ${type}`);
  }
});

test('a redirect is refused: the article and key go to the configured endpoint only', async () => {
  const elsewhere = [];
  const other = http.createServer((req, res) => { elsewhere.push(req.url); res.writeHead(200).end(); });
  await new Promise((ok) => other.listen(0, '127.0.0.1', ok));
  reply = (req, res) => res.writeHead(307, { location: `http://127.0.0.1:${other.address().port}/steal` }).end();
  await assert.rejects(collect(cfg()), { name: 'ProviderError' });
  await new Promise((ok) => other.close(ok));
  assert.deepEqual(elsewhere, []);
});

test('providerConfig: OpenAI needs a key; OpenAI-compatible needs a base URL and a model', () => {
  assert.equal(providerConfig(undefined, undefined), null);
  assert.equal(providerConfig({ provider: 'openai' }, {}), null);
  const openai = providerConfig({ provider: 'openai', providers: { openai: { baseUrl: 'https://evil.example/v1' } } },
    { 'https://api.openai.com': 'k', 'https://evil.example': 'other' });
  assert.equal(openai.baseUrl, 'https://api.openai.com/v1'); // fixed
  assert.equal(openai.apiKey, 'k');
  assert.equal(openai.model, PROVIDERS.openai.model);
  assert.deepEqual(openai.params, { reasoning_effort: 'none' });
  assert.equal(providerConfig({ provider: 'compatible', providers: { compatible: { model: 'x' } } }, {}), null);
  assert.equal(providerConfig({ provider: 'compatible', providers: { compatible: { baseUrl: 'not a url', model: 'x' } } }, {}), null);
  const compat = providerConfig({ provider: 'compatible', providers: { compatible: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3' } } }, {});
  assert.equal(compat.apiKey, '');
  assert.equal(compat.jsonMode, 'json_object');
  assert.equal(compat.transport.stream, stream);
});

// Probed against OpenAI: the first group answers 400 "Unrecognized request argument supplied:
// reasoning_effort"; the second takes 'none' (gpt-5-mini and o4-mini then answer 400 with their
// supported values rather than think).
test('OpenAI gets reasoning_effort none, except the models without reasoning', () => {
  const params = (model) => providerConfig({ provider: 'openai', providers: { openai: { model } } },
    { 'https://api.openai.com': 'k' }).params;
  for (const model of ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4', 'gpt-3.5-turbo', 'gpt-5-chat-latest',
    'chatgpt-4o-latest', 'ft:gpt-4o-mini-2024-07-18:acme::abc', 'ft:gpt-4.1-2025-04-14:acme::x']) {
    assert.deepEqual(params(model), {}, model);
  }
  for (const model of ['gpt-5.4-mini', 'gpt-5.5', 'gpt-6-luna', 'gpt-5-mini', 'o4-mini', 'ft:o4-mini-2025-04-16:acme::y']) {
    assert.deepEqual(params(model), { reasoning_effort: 'none' }, model);
  }
});

test('a key is used only for the endpoint origin it was stored under', () => {
  const keys = { 'https://api.deepseek.com': 'sk-deepseek' };
  const at = (baseUrl) => providerConfig({ provider: 'compatible', providers: { compatible: { baseUrl, model: 'm' } } }, keys).apiKey;
  assert.equal(at('https://api.deepseek.com/v1'), 'sk-deepseek');
  assert.equal(at('https://openrouter.ai/api/v1'), '');
  assert.equal(at('http://api.deepseek.com/v1'), ''); // another scheme is another origin
});

test('originPattern: the endpoint\'s scheme, host and port', () => {
  assert.equal(originPattern('https://api.openai.com/v1'), 'https://api.openai.com/*');
  assert.equal(originPattern('http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434/*');
  assert.throws(() => originPattern('api.deepseek.com'), TypeError);
  assert.throws(() => originPattern('ftp://x.example/'), TypeError);
});

// Status codes and bodies as OpenAI answered them, probed 2026-09-24: its list has every model
// the key can use; a bad key is 401 invalid_api_key; a region block is 403.
test('checkModel asks for the model list: listed is valid; unlisted is missing only on a provider\'s own endpoint', async () => {
  const list = (res, ids) => res.writeHead(200, { 'content-type': 'application/json' })
    .end(JSON.stringify({ object: 'list', data: ids.map((id) => ({ id, object: 'model' })) }));
  requests.length = 0;
  reply = (req, res) => list(res, ['m0', 'm1']);
  assert.equal(await checkModel(cfg()), 'valid');
  assert.deepEqual(requests.map((r) => [r.method, r.url, r.headers.authorization]), [['GET', '/v1/models', `Bearer ${KEY}`]]);
  reply = (req, res) => list(res, ['m0']);
  assert.equal(await checkModel(cfg({ fixedBaseUrl: true })), 'missing');
  // A compatible server may serve a name it does not list (Ollama's llama3 for llama3:latest).
  assert.equal(await checkModel(cfg({ fixedBaseUrl: false })), null);
  const status = (code, body) => (req, res) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  reply = status(401, { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } });
  assert.equal(await checkModel(cfg({ fixedBaseUrl: true })), 'key');
  // A restricted key without the models scope still builds: not a rejected key.
  reply = status(401, { error: { message: 'You have insufficient permissions for this operation. Missing scopes: api.model.read.', code: null } });
  assert.equal(await checkModel(cfg({ fixedBaseUrl: true })), null);
  reply = status(403, { error: { message: 'Country, region, or territory not supported', code: 'unsupported_country_region_territory' } });
  assert.equal(await checkModel(cfg({ fixedBaseUrl: true })), null);
  reply = status(404, { error: { message: 'Not found' } }); // a server with no model list
  assert.equal(await checkModel(cfg()), null);
  reply = (req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<html>sign in</html>'); // a gateway's page
  assert.equal(await checkModel(cfg({ fixedBaseUrl: true })), null);
  await assert.rejects(checkModel(cfg({ baseUrl: 'http://127.0.0.1:1/v1' })), (e) => e instanceof ProviderError && !e.message.includes(KEY));
});
