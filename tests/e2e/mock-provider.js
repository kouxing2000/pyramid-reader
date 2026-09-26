// A local stand-in for an OpenAI-compatible endpoint. POST /v1/chat/completions streams the next
// queued answer as chat-completion SSE in small chunks, and every request is recorded, with
// whether the client hung up before the answer ended (`closed`). GET /v1/models lists `models`,
// or answers `modelsStatus` when set; each such lookup is recorded apart, in `lookups`.
//
// CORS is open. A real Save grants the panel host permission for the endpoint through
// chrome.permissions.request, but that shows a native prompt no test can accept (no CDP command
// or switch answers it), so the E2E reaches the mock without the grant.
import http from 'node:http';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST',
  'access-control-allow-private-network': 'true',
};
const event = (res, data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startMockProvider() {
  const requests = [];
  const lookups = [];
  const queue = [];
  let release = () => {};
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();
    if (req.method === 'GET') {
      lookups.push({ url: req.url, headers: req.headers });
      const status = mock.modelsStatus ?? (req.url === '/v1/models' ? 200 : 404);
      const body = status === 200 ? { object: 'list', data: mock.models.map((id) => ({ id, object: 'model' })) }
        : { error: { message: `mock provider: ${status}`, ...(status === 401 && { code: 'invalid_api_key' }) } };
      return res.writeHead(status, { ...CORS, 'content-type': 'application/json' }).end(JSON.stringify(body));
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const record = { url: req.url, headers: req.headers, body: JSON.parse(body), closed: false };
    requests.push(record);
    res.on('close', () => { record.closed = !res.writableFinished; });
    const answer = queue.shift() ?? { status: 500, body: { error: { message: 'mock provider: no answer queued' } } };
    if (answer.status) {
      return res.writeHead(answer.status, { ...CORS, 'content-type': 'application/json' }).end(JSON.stringify(answer.body));
    }
    res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream' });
    const send = async (text) => {
      for (let i = 0; i < text.length && !res.destroyed; i += 24) {
        event(res, { choices: [{ index: 0, delta: { content: text.slice(i, i + 24) }, finish_reason: null }] });
        await sleep(1);
      }
    };
    const hold = answer.holdAt ?? answer.text.length;
    await send(answer.text.slice(0, hold));
    if (answer.holdAt !== undefined) await answer.held;
    await send(answer.text.slice(hold));
    if (res.destroyed) return;
    event(res, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    res.end('data: [DONE]\n\n');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const mock = {
    origin,
    baseUrl: `${origin}/v1`,
    requests,
    lookups,
    /** What GET /v1/models lists. */
    models: ['mock-model'],
    /** An error status GET /v1/models answers instead, e.g. 401; null lists the models. */
    modelsStatus: null,
    /** Queues an answer. With holdAt, streaming pauses at that character until release(). */
    answer(text, { holdAt } = {}) {
      const held = new Promise((r) => { release = r; });
      queue.push({ text, holdAt, held });
    },
    /** Queues an error response. */
    fail(status, body) {
      queue.push({ status, body });
    },
    release: () => release(),
    close: () => new Promise((ok) => {
      server.closeAllConnections();
      server.close(ok);
    }),
  };
  return mock;
}
