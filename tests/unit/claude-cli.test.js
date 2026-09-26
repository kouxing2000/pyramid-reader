// The claude -p transport's process handling, against a fake CLI (fake-claude.mjs): the answer and
// the cost reported after it, an error with no answer, a CLI that cannot start, Stop, and a process
// that outlives its deadline. The event reading itself is tested in eval.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stream } from '../../eval/lib/claude-cli.js';
import { runOne } from '../../eval/lib/run.js';
import { ProviderError } from '../../src/lib/providers/http.js';
import { ARTICLE_PAGE, ARTICLE_TREE } from '../fixtures/trees/article.js';
import { collect } from './local-server.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-claude.mjs');
const PROMPT = { system: 'S', user: 'U', schema: { type: 'object' } };
const cfg = (model, over = {}) => ({ model, maxBudgetUsd: 1, maxOutputTokens: 123, bin: FAKE, ...over });

test('the answer streams, and the cost the CLI reports after it arrives through onSettled', async () => {
  let settled;
  assert.deepEqual(await collect(stream(cfg('answer', { onSettled: (s) => { settled = s; } }), PROMPT)), ['{"a":', ' 1}']);
  const s = await settled;
  assert.equal(s.result.total_cost_usd, 0.0123);
  assert.equal(s.result.result, '123'); // the output cap reached the CLI's environment
  assert.equal(s.code, 0);
});

test('an error with no answer is a ProviderError, and its reported cost is kept', async () => {
  let settled;
  await assert.rejects(collect(stream(cfg('error', { onSettled: (s) => { settled = s; } }), PROMPT)),
    (e) => e instanceof ProviderError && e.message === 'claude -p: error_during_execution: boom');
  assert.equal((await settled).result.total_cost_usd, 0.004);
});

test('a CLI that cannot start is a ProviderError, not a crash', async () => {
  await assert.rejects(collect(stream(cfg('answer', { bin: '/nonexistent/claude' }), PROMPT)),
    (e) => e instanceof ProviderError && /^could not start claude -p: /.test(e.message));
});

test('Stop ends the process and the stream', async () => {
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 200);
  await assert.rejects(collect(stream(cfg('slow'), PROMPT, stop.signal)), { name: 'AbortError' });
});

test('a process still running after its deadline is killed, and settles with no cost', async () => {
  let settled;
  assert.deepEqual(await collect(stream(cfg('hang', { settleMs: 200, onSettled: (s) => { settled = s; } }), PROMPT)), ['{"a":', ' 1}']);
  const s = await settled;
  assert.equal(s.sig, 'SIGKILL');
  assert.equal(s.result, null);
});

const PAGE = { id: 'p1', url: 'https://example.com/a', sha256: 'h1', paragraphs: ARTICLE_PAGE.map((p) => ({ ...p, heading: null })) };
const CLI_MODEL = { id: 'cli', transport: 'claude-cli', via: 'claude -p', provider: 'anthropic', price: { in: 1, cached: 1, out: 1 } };
const cliConn = (model) => ({ stream: (p, signal, hooks) => stream(cfg(model, hooks), p, signal) });

test('a build through claude -p is priced at the CLI\'s reported cost and named by its model', async () => {
  const r = await runOne({ ...CLI_MODEL, model: 'tree' }, cliConn('tree'), PAGE);
  assert.deepEqual(r.tree, ARTICLE_TREE);
  assert.equal(r.costUsd, 0.0123);
  assert.equal(r.estimated, false);
  assert.equal(r.resolvedModel, 'claude-x');
  assert.deepEqual(r.rateLimit, { status: 'allowed' });
});

test('a claude -p answer rejected as it streams is abandoned, killed and priced as an estimate', async () => {
  // '{"a": 1}' closes with no kind: rejected before the CLI ends, so it reports no cost.
  const r = await runOne({ ...CLI_MODEL, model: 'answer' }, cliConn('answer'), PAGE);
  assert.match(r.error, /^SchemaError: kind is missing/);
  assert.equal(r.attempts.length, 2);
  assert.equal(r.estimated, true);
  assert.ok(r.costUsd > 0);
});
