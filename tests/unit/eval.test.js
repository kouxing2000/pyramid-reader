// The eval's own logic (eval/lib): reading claude -p's event stream, pricing usage reports, the
// spend cap, the page list, the offline scores and the guard on committed text. The builds
// themselves run the extension's code, which its own tests cover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeArgs, END, newState, readEvent } from '../../eval/lib/claude-cli.js';
import { leaks, pageRuns } from '../../eval/lib/leak.js';
import { attemptWorstCase, connect, cost, MAX_OUTPUT_TOKENS, MODELS, tokens } from '../../eval/lib/models.js';
import { readPageList } from '../../eval/lib/pages.js';
import { summaryMarkdown, testedRows } from '../../eval/lib/report.js';
import { Budget, runOne } from '../../eval/lib/run.js';
import { commonPages, scoreRun } from '../../eval/lib/score.js';
import { ARTICLE_PAGE, ARTICLE_TREE, FLAWED_TREE } from '../fixtures/trees/article.js';
import { collect } from './local-server.js';

const FAKE_CLAUDE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-claude.mjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pyramid-eval-'));

test('claude -p: the first StructuredOutput call is the answer, and nothing after it is', () => {
  const se = (event) => ({ type: 'stream_event', event });
  const events = [
    { type: 'system', subtype: 'init' },
    se({ type: 'message_start', message: {} }),
    se({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    se({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'StructuredOutput', input: {} } }),
    se({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '' } }),
    se({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a"' } }),
    se({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'aside' } }),
    se({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ': 1}' } }),
    se({ type: 'content_block_stop', index: 1 }),
    // The CLI rejects it and the model answers again, in a block with the same index.
    { type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'does not match' }] } },
    se({ type: 'message_start', message: {} }),
    se({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'StructuredOutput', input: {} } }),
    se({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a": 2}' } }),
    se({ type: 'content_block_stop', index: 1 }),
    { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } },
    { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01 },
  ];
  const state = newState();
  const out = events.map((e) => readEvent(e, state)).filter((x) => x !== null);
  assert.deepEqual(out, ['{"a"', ': 1}', END]);
  assert.deepEqual(state.rateLimit, { status: 'allowed' });
  assert.equal(state.result.total_cost_usd, 0.01);
});

test('usage reports from each provider become tokens, priced per million', () => {
  assert.deepEqual(tokens({ prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 200 }, completion_tokens: 300 }),
    { input: 1000, cached: 200, output: 300 });
  assert.deepEqual(tokens({ promptTokenCount: 1000, candidatesTokenCount: 250, thoughtsTokenCount: 50 }),
    { input: 1000, cached: 0, output: 300 });
  // An answer abandoned mid-stream: Gemini has said nothing yet about the output.
  assert.deepEqual(tokens({ promptTokenCount: 1000 }), { input: 1000, cached: 0, output: null });
  assert.deepEqual(tokens({ input_tokens: 10, cache_creation_input_tokens: 900, cache_read_input_tokens: 100, output_tokens: 300 }),
    { input: 1010, cached: 100, output: 300 });
  // 800 fresh at $1, 200 cached at $0.10, 300 out at $4: (800 + 20 + 1200) / 1e6
  assert.equal(cost({ input: 1000, cached: 200, output: 300 }, { in: 1, cached: 0.1, out: 4 }), 0.00202);
});

test('claude -p runs with the attempt\'s budget as its spending limit', () => {
  const args = claudeArgs('haiku', { system: 'S', schema: { type: 'object' } }, 0.12345);
  assert.equal(args[args.indexOf('--max-budget-usd') + 1], '0.1235');
});

test('every API model\'s request asks for at most MAX_OUTPUT_TOKENS, where its API takes the cap', async () => {
  // Where each API reads the cap: written out here, not taken from the code under test.
  const cap = { openai: (b) => b.max_completion_tokens, compatible: (b) => b.max_tokens,
    gemini: (b) => b.generationConfig.maxOutputTokens, anthropic: (b) => b.max_tokens };
  const bodies = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    bodies.push({ url, body: JSON.parse(init.body) });
    throw new TypeError('not sent');
  };
  const api = MODELS.filter((m) => m.transport === 'api');
  try {
    for (const m of api) {
      const conn = connect({ ...m, price: m.price ?? { in: 1, cached: 1, out: 1 } }, { [m.key]: 'k' });
      await assert.rejects(collect(conn.stream({ system: 'S', user: 'U', schema: { type: 'object' } }, undefined, {})), { name: 'ProviderError' });
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(bodies.length, api.length);
  for (const [i, m] of api.entries()) {
    assert.equal(cap[m.provider](bodies[i].body), MAX_OUTPUT_TOKENS, m.id);
    if (m.provider === 'openai' || m.provider === 'compatible') assert.deepEqual(bodies[i].body.stream_options, { include_usage: true }, m.id);
  }
});

test('claude -p models get the output cap in the CLI\'s environment and the attempt\'s budget', async () => {
  const m = { ...MODELS.find((x) => x.transport === 'claude-cli'), model: 'answer' };
  assert.equal(connect(m, {}, { bin: '/nonexistent/claude' }).skip, 'no claude CLI at /nonexistent/claude');
  const prompt = { system: 'S', user: 'U', schema: { type: 'object' } };
  let settled;
  await collect(connect(m, {}, { bin: FAKE_CLAUDE }).stream(prompt, undefined, { onSettled: (s) => { settled = s; } }));
  const { result } = await settled;
  assert.equal(result.result, String(MAX_OUTPUT_TOKENS));
  assert.equal(result.args[result.args.indexOf('--max-budget-usd') + 1], attemptWorstCase(m, prompt).toFixed(4));
});

test('a build\'s cost: an abandoned attempt is counted from its characters, a finished one from its usage', async () => {
  const page = { id: 'p1', url: 'https://example.com/a', sha256: 'h1', paragraphs: ARTICLE_PAGE.map((p) => ({ ...p, heading: null })) };
  const short = JSON.stringify({ ...ARTICLE_TREE, branches: ARTICLE_TREE.branches.slice(0, 2) });
  const answers = [[short.slice(0, -1), '}'], [JSON.stringify(ARTICLE_TREE)]];
  const usage = [{ input_tokens: 100, output_tokens: 1 }, { input_tokens: 120, output_tokens: 50 }];
  let call = 0;
  const conn = {
    async* stream(prompt, signal, { onUsage }) {
      const i = call++;
      onUsage(usage[i]); // as Anthropic's message_start reports it, and as a finished answer does
      yield* answers[i];
    },
  };
  const m = { id: 'fake', provider: 'anthropic', model: 'x', price: { in: 1, cached: 1, out: 1 } };
  const r = await runOne(m, conn, page);
  assert.deepEqual(r.tree, ARTICLE_TREE);
  assert.equal(r.retries.length, 1); // the two-branch answer broke off before its last character
  assert.equal(r.attempts[0].tokens.output, Math.ceil(short.slice(0, -1).length / 3));
  assert.deepEqual(r.attempts[1].tokens, { input: 120, cached: 0, output: 50 });
  assert.equal(r.estimated, true);
  assert.ok(Math.abs(r.costUsd - (100 + r.attempts[0].tokens.output + 120 + 50) / 1e6) < 1e-15);
  assert.ok(r.seconds.verdict > 0 && r.seconds.verdict <= r.seconds.total);
});

test('a stopped build ends at once, keeps no tree, and is priced from what it had streamed', async () => {
  const page = { id: 'p1', url: 'https://example.com/a', sha256: 'h1', paragraphs: ARTICLE_PAGE.map((p) => ({ ...p, heading: null })) };
  const conn = {
    async* stream(prompt, signal) {
      yield '{"kind": "report"';
      await new Promise((ok, fail) => signal.addEventListener('abort', () => fail(signal.reason)));
    },
  };
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 50);
  const r = await runOne({ id: 'fake', provider: 'openai', model: 'x', price: { in: 1, cached: 1, out: 1 } }, conn, page, { signal: stop.signal });
  assert.equal(r.tree, null);
  assert.match(r.error, /^AbortError/);
  assert.equal(r.retries.length, 0);
  assert.equal(r.estimated, true);
  assert.equal(r.attempts[0].tokens.output, Math.ceil('{"kind": "report"'.length / 3));
});

test('the spend cap refuses a cap that is not a positive number of dollars', () => {
  const file = path.join(tmp(), 'spend.jsonl');
  for (const cap of [NaN, 0, -1, Infinity]) assert.throws(() => new Budget(cap, file), RangeError);
});

test('the spend cap knows when no build holds a reservation, whatever the sum of the dollars', () => {
  const budget = new Budget(10, path.join(tmp(), 'spend.jsonl'));
  const held = [0.1, 0.1, 0.1]; // added then taken away in floating point, these leave 2.8e-17 behind
  for (const usd of held) assert.equal(budget.reserve(usd), true);
  for (const usd of held) budget.settle(usd, { costUsd: 0 });
  assert.equal(budget.inFlight, 0);
  assert.equal(budget.reserved, 0);
});

test('the spend cap counts the ledger, read afresh, and what running builds reserved', () => {
  const file = path.join(tmp(), 'spend.jsonl');
  fs.writeFileSync(file, `${JSON.stringify({ costUsd: 6 })}\n`);
  const a = new Budget(10, file);
  const b = new Budget(10, file);
  assert.equal(a.reserve(3), true);
  assert.equal(a.reserve(1.5), false); // 6 spent + 3 reserved + 1.5 > 10
  a.settle(3, { costUsd: 2.5 });
  assert.equal(b.spent, 8.5); // the other run sees the settled cost
  assert.equal(b.reserve(1.5), true);
  assert.equal(b.reserve(0.5), false);
});

test('pages.txt: kind and URL per line; a bad line or a repeated URL names its line', () => {
  const dir = tmp();
  const file = path.join(dir, 'pages.txt');
  fs.writeFileSync(file, '# heading\n\nanalysis https://example.com/a  # note\nreference https://example.com/b\n');
  const pages = readPageList(file);
  assert.deepEqual(pages.map((p) => [p.kind, p.url]), [['analysis', 'https://example.com/a'], ['reference', 'https://example.com/b']]);
  assert.match(pages[0].id, /^[0-9a-f]{12}$/);
  fs.writeFileSync(file, 'analysis https://example.com/a\nopinion https://example.com/c\n');
  assert.throws(() => readPageList(file), /pages\.txt:2: expected/);
  fs.writeFileSync(file, 'analysis https://example.com/a\nnarrative https://example.com/a\n');
  assert.throws(() => readPageList(file), /pages\.txt:2: https:\/\/example\.com\/a is listed twice/);
});

test('committed text may not repeat eight words in a row from a page', () => {
  const runs = pageRuns([{ paragraphs: ARTICLE_PAGE }]);
  // ¶4: "Engineers said the cheapest bridges to build were often ..."
  assert.deepEqual(leaks('A note: ENGINEERS said the cheapest bridges, to build were — fine.', runs),
    ['engineers said the cheapest bridges to build were']);
  assert.deepEqual(leaks('Engineers said the cheapest bridges to build cost more.', runs), []); // seven
  assert.deepEqual(leaks('"url": "https://example.com/engineers-said-the-cheapest-bridges-to-build-were-often"', runs), []);
  // Chinese has no spaces: each character is a word, and a Latin word next to one stays apart.
  const zh = pageRuns([{ paragraphs: [{ text: '县里调查发现部分人行桥需要维修' }] }]);
  assert.equal(leaks('据说AI县里调查发现部分人行桥', zh).length, 4); // 11 characters of the page: 4 runs
  assert.deepEqual(leaks('AI县里调查发现部', zh), []); // seven
});

const PAGE = { id: 'p1', kind: 'analysis', url: 'https://example.com/a', sha256: 'h1', paragraphs: ARTICLE_PAGE };
const record = (over = {}) => ({
  model: 'm1', provider: 'openai', via: null, resolvedModel: 'm1', page: { id: 'p1', sha256: 'h1' },
  tree: FLAWED_TREE, error: null, retries: [], attempts: [{ tokens: { input: 1000, output: 400 } }],
  seconds: { verdict: 1.5, total: 5 }, costUsd: 0.01, estimated: false, ...over,
});

test('scores re-check each stored tree: anchors, and numbers the cited paragraphs do not hold', () => {
  const pages = new Map([['p1', PAGE]]);
  // FLAWED_TREE: b0.0 cites the wrong paragraph; b1's basis is not on the page; b2 states a number
  // its paragraphs do not hold. b2.1 is a derived value.
  const { models: [m], nodes } = scoreRun(pages, [record()]);
  assert.equal(m.built, 1);
  assert.deepEqual(m.evidence, { total: 4, anchored: 2, repaired: 1, unanchored: 0, derived: 1 });
  assert.equal(m.anchored, 1);
  assert.deepEqual(m.basis, { total: 4, anchored: 3, repaired: 0, unanchored: 1 });
  assert.equal(m.basisAnchored, 0.75);
  assert.equal(m.numberFlaggedNodes, 1);
  assert.deepEqual(nodes.filter((n) => n.flags?.length), [{ model: 'm1', page: 'p1', node: 'b2', type: 'claim', anchor: 'anchored',
    flags: [{ type: 'number', value: '4.5 million', foundIn: null }] }]);
});

test('medians average the middle two of an even count; rates round down', () => {
  const pages = new Map([['p1', PAGE], ['p2', { ...PAGE, id: 'p2' }]]);
  const two = [record({ seconds: { verdict: 1, total: 4 } }),
    record({ page: { id: 'p2', sha256: 'h1' }, seconds: { verdict: 2, total: 7 } })];
  const [m] = scoreRun(pages, two).models;
  assert.equal(m.seconds.verdict, 1.5);
  assert.equal(m.seconds.total, 5.5);
  // FLAWED_TREE's three quoted evidence nodes, one moved off the page: 2 of 3 found.
  const tree = structuredClone(FLAWED_TREE);
  tree.branches[0].children[1].quote = 'a sentence this page never had';
  const [third] = scoreRun(new Map([['p1', PAGE]]), [record({ tree })]).models;
  assert.deepEqual([third.evidence.unanchored, third.evidence.total - third.evidence.derived], [1, 3]);
  assert.equal(third.anchored, 0.666);
  // The summary rounds down too: 2 of 3 must not read as 66.7%.
  const summary = summaryMarkdown({ run: 'r', pages: [PAGE], models: scoreRun(new Map([['p1', PAGE]]), [record({ tree })]).models, skipped: [], spend: 0 });
  assert.match(summary, /^All models: 66\.6% of 3 evidence quotes/m);
});

test('a build with no tree, or a page whose text changed since, is a failure, not a score', () => {
  const pages = new Map([['p1', PAGE]]);
  const { models: [m] } = scoreRun(pages, [
    record({ tree: null, error: 'SchemaError: branches has 2 items; it must have 3-5' }),
    record({ page: { id: 'p1', sha256: 'other' } }),
  ]);
  assert.equal(m.attempted, 2);
  assert.equal(m.built, 0);
  assert.deepEqual(m.failures.map((f) => f.error), ['SchemaError: branches has 2 items; it must have 3-5', 'page p1 changed since the build']);
});

test('the pages every model built: the like-for-like comparison', () => {
  const r = (model, page) => ({ model, page: { id: page } });
  assert.equal(commonPages([]), null);
  assert.deepEqual([...commonPages([r('a', 'p1'), r('a', 'p2')])], ['p1', 'p2']);
  assert.deepEqual([...commonPages([r('a', 'p1'), r('a', 'p2'), r('b', 'p2'), r('b', 'p3')])], ['p2']);
});

test('tested-models rows: every model with a tree built; claude -p rows by API name, after the others', () => {
  const model = (over) => ({ provider: 'openai', via: null, resolvedModel: null, built: 40, anchored: 0.99,
    seconds: { verdict: 1.2, total: 5.1 }, ...over });
  const rows = testedRows({ run: '2026-09-24', models: [
    model({ model: 'claude-cli-sonnet', provider: 'anthropic', via: 'claude -p', resolvedModel: 'claude-sonnet-5' }),
    model({ model: 'gpt-5.4-mini' }),
    model({ model: 'gpt-5.5', built: 0 }),
  ] });
  assert.deepEqual(rows, [
    { provider: 'openai', model: 'gpt-5.4-mini', anchored: 0.99, verdictSeconds: 1.2, totalSeconds: 5.1, pages: 40, measured: '2026-09-24' },
    { provider: 'anthropic', model: 'claude-sonnet-5', via: 'claude -p', anchored: 0.99, verdictSeconds: 1.2, totalSeconds: 5.1, pages: 40, measured: '2026-09-24' },
  ]);
});
