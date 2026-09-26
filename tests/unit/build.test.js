import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree } from '../../src/lib/build.js';
import { treePrompt } from '../../src/lib/prompt.js';
import { ProviderError } from '../../src/lib/providers/http.js';
import { SchemaError } from '../../src/lib/tree.js';
import { verifier } from '../../src/lib/verify/index.js';
import { ARTICLE_NODE_IDS, ARTICLE_PAGE, ARTICLE_PARAGRAPHS, ARTICLE_TREE } from '../fixtures/trees/article.js';

const PROMPT = treePrompt({ title: 'T', paragraphs: [{ n: 1, text: 'x', heading: null }] });
const TEXT = JSON.stringify(ARTICLE_TREE);
const chunks = (text, size = 7) => Array.from({ length: Math.ceil(text.length / size) }, (_, i) => text.slice(i * size, (i + 1) * size));

// A fake transport: answers[i] is the text of the i-th answer. Records each prompt it was sent and
// whether each answer's stream was stopped before its end.
function fakeStream(...answers) {
  const calls = [];
  const stream = async function* (prompt) {
    const call = { prompt, stopped: true };
    calls.push(call);
    for (const c of chunks(answers[calls.length - 1])) yield c;
    call.stopped = false; // not reached when the consumer stops early
  };
  return { stream, calls };
}

const run = (stream, extra = {}) => {
  const nodes = [];
  const retries = [];
  const done = buildTree({
    prompt: PROMPT, stream, count: ARTICLE_PARAGRAPHS,
    onNode: (n) => nodes.push(n), onRetry: (e) => retries.push(e), ...extra,
  });
  return { done, nodes, retries };
};

test('a valid answer: every node once, in reading order', async () => {
  const { stream, calls } = fakeStream(TEXT);
  const { done, nodes, retries } = run(stream);
  assert.deepEqual(await done, ARTICLE_TREE);
  assert.deepEqual(nodes.map((n) => n.id), ARTICLE_NODE_IDS);
  assert.deepEqual(retries, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, PROMPT);
});

test('the verdict is shown while the rest of the answer is still to come', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const cut = TEXT.indexOf('"branches"');
  const nodes = [];
  const done = buildTree({
    prompt: PROMPT, count: ARTICLE_PARAGRAPHS, onNode: (n) => nodes.push(n),
    stream: async function* () {
      yield TEXT.slice(0, cut);
      await gate;
      yield TEXT.slice(cut);
    },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(nodes.map((n) => n.id), ['verdict']);
  release();
  await done;
  assert.equal(nodes.at(-1).id, 'b2.1');
});

test('each node is verified once, before it is shown, and shown as what verify returns', async () => {
  const { stream } = fakeStream(TEXT);
  const order = [];
  const { done, nodes } = run(stream, {
    verify: async (node) => { order.push(`verify ${node.id}`); return { ...node, checked: node.id }; },
    onNode: (n) => { order.push(`show ${n.id}`); nodes.push(n); },
  });
  await done;
  assert.ok(nodes.every((n) => n.checked === n.id));
  assert.deepEqual(order.filter((o) => o.startsWith('verify')), ARTICLE_NODE_IDS.map((id) => `verify ${id}`));
  assert.deepEqual(order.slice(0, 3), ['verify verdict', 'show verdict', 'verify b0']);
});

test('a broken answer is retried once, with the error text; nodes shown so far are void', async () => {
  const bad = structuredClone(ARTICLE_TREE);
  bad.branches.pop();
  const { stream, calls } = fakeStream(JSON.stringify(bad), TEXT);
  const { done, nodes, retries } = run(stream);
  assert.deepEqual(await done, ARTICLE_TREE);
  assert.deepEqual(retries, ['branches has 2 items; it must have 3-5']);
  assert.equal(calls.length, 2);
  assert.match(calls[1].prompt.user, /rejected: branches has 2 items; it must have 3-5\./);
  assert.ok(calls[1].prompt.user.startsWith(PROMPT.user));
  assert.equal(nodes.filter((n) => n.id === 'b0').length, 2); // once per answer
});

test('a node that breaks the schema stops that answer\'s stream at once', async () => {
  const bad = structuredClone(ARTICLE_TREE);
  bad.verdict_src = [99];
  const { stream, calls } = fakeStream(JSON.stringify(bad), TEXT);
  const { done, retries } = run(stream);
  await done;
  assert.deepEqual(retries, ['verdict_src[0] is 99, not a paragraph number (1-9)']);
  assert.deepEqual(calls.map((c) => c.stopped), [true, false]);
});

test('a paragraph number the page does not have is retried as a broken answer and never reaches verify', async () => {
  for (const [n, set] of [[0, (t) => { t.verdict_src = [3, 0]; }], [ARTICLE_PARAGRAPHS + 1, (t) => { t.branches[2].children[0].src = [ARTICLE_PARAGRAPHS + 1]; }]]) {
    const bad = structuredClone(ARTICLE_TREE);
    set(bad);
    const { stream } = fakeStream(JSON.stringify(bad), TEXT);
    const check = verifier(ARTICLE_PAGE);
    const cited = [];
    const { done, retries } = run(stream, { verify: (node) => { cited.push(...node.src); return check(node); } });
    assert.deepEqual(await done, ARTICLE_TREE);
    assert.equal(retries.length, 1);
    assert.match(retries[0], new RegExp(`is ${n}, not a paragraph number \\(1-${ARTICLE_PARAGRAPHS}\\)$`));
    assert.ok(cited.length > 0 && cited.every((k) => k >= 1 && k <= ARTICLE_PARAGRAPHS), JSON.stringify(cited));
  }
});

test('answers that are cut off or not JSON count as broken', async () => {
  for (const [answer, error] of [
    [TEXT.slice(0, -1), 'the answer ends before its JSON object closes'],
    ['Sorry, I cannot help.', 'the answer holds no JSON object'],
    ['{"kind": nope}', /^the answer is not JSON \(unexpected character/],
  ]) {
    const { stream } = fakeStream(answer, TEXT);
    const { done, retries } = run(stream);
    await done;
    assert.equal(retries.length, 1);
    assert.ok(typeof error === 'string' ? retries[0] === error : error.test(retries[0]), retries[0]);
  }
});

test('an answer that does not name its language is retried: a new tree must name it', async () => {
  const { lang, ...unnamed } = ARTICLE_TREE;
  const { stream, calls } = fakeStream(JSON.stringify(unnamed), TEXT);
  const { done, retries } = run(stream);
  assert.deepEqual(await done, ARTICLE_TREE);
  assert.deepEqual(retries, ['lang is missing']);
  assert.equal(calls.length, 2);
});

test('a second broken answer fails the build', async () => {
  const bad = structuredClone(ARTICLE_TREE);
  bad.kind = 'essay';
  const { stream, calls } = fakeStream(JSON.stringify(bad), JSON.stringify(bad));
  await assert.rejects(run(stream).done, (e) => e instanceof SchemaError && /^kind must be one of/.test(e.message));
  assert.equal(calls.length, 2);
});

test('a provider error is not retried', async () => {
  let calls = 0;
  const stream = async function* () {
    calls++;
    throw new ProviderError('401 bad key');
  };
  await assert.rejects(run(stream).done, ProviderError);
  assert.equal(calls, 1);
});
