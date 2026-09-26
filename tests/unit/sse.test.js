import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sseData } from '../../src/lib/sse.js';

const body = (chunks) => new ReadableStream({
  start(controller) {
    for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
    controller.close();
  },
});
const collect = async (chunks) => {
  const out = [];
  for await (const data of sseData(body(chunks))) out.push(data);
  return out;
};

const STREAM = [
  ': a comment\n',
  'event: message\ndata: {"a":1}\n\n',
  'data:no-space\r\n\r\n',
  'id: 7\ndata: line one\ndata: line two\n\n',
  'retry: 10\n\n', // no data: no event
  'data: 中文 😀\r\r',
  'data: [DONE]\n\n',
].join('');
const EVENTS = ['{"a":1}', 'no-space', 'line one\nline two', '中文 😀', '[DONE]'];

test('yields each event\'s data, whatever the line endings', async () => {
  assert.deepEqual(await collect([STREAM]), EVENTS);
});

test('the same events however the bytes are split, even inside \\r\\n or a UTF-8 character', async () => {
  const bytes = new TextEncoder().encode(STREAM);
  for (let cut = 1; cut < bytes.length; cut++) {
    const chunks = [bytes.slice(0, cut), bytes.slice(cut)];
    const out = [];
    const stream = new ReadableStream({ start(c) { chunks.forEach((b) => c.enqueue(b)); c.close(); } });
    for await (const data of sseData(stream)) out.push(data);
    assert.deepEqual(out, EVENTS, `split at byte ${cut}`);
  }
});

test('a stream that ends without the closing blank line still yields its last event', async () => {
  assert.deepEqual(await collect(['data: one\n\ndata: two']), ['one', 'two']);
  assert.deepEqual(await collect(['data: one\n\ndata: two\r']), ['one', 'two']);
});

test('stopping early cancels the body', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(c) { c.enqueue(new TextEncoder().encode('data: x\n\n')); },
    cancel() { cancelled = true; },
  });
  for await (const data of sseData(stream)) {
    assert.equal(data, 'x');
    break;
  }
  assert.ok(cancelled);
});
