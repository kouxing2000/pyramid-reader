// A local HTTP server for the transport tests, reached through Node's real fetch. Each request is
// recorded, with whether the client hung up before the answer ended (`closed`); `reply` answers it.
import http from 'node:http';

export async function localServer() {
  const requests = [];
  const s = {
    requests,
    reply: (req, res) => res.writeHead(500).end(),
    base: '',
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); }),
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const record = { method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body || 'null'), closed: false };
      requests.push(record);
      res.on('close', () => { record.closed = !res.writableFinished; });
      s.reply(req, res, record);
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  s.base = `http://127.0.0.1:${server.address().port}`;
  return s;
}

/** Answers with the events as a server-sent event stream; `event` names each one, like Anthropic's. */
export function sse(res, events, { named = false } = {}) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`${named ? `event: ${e.type}\n` : ''}data: ${JSON.stringify(e)}\n\n`);
  res.end();
}

export async function collect(iterable) {
  const out = [];
  for await (const x of iterable) out.push(x);
  return out;
}
