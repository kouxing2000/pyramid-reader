import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePartial } from '../../src/lib/partial-json.js';
import { readyNodes, SchemaError, TREE_SCHEMA } from '../../src/lib/tree.js';
import { ARTICLE_NODE_IDS, ARTICLE_PARAGRAPHS, ARTICLE_TREE } from '../fixtures/trees/article.js';

const N = ARTICLE_PARAGRAPHS;
const copy = () => structuredClone(ARTICLE_TREE);
const rejects = (tree, message) => assert.throws(() => readyNodes(tree, N, true),
  (e) => e instanceof SchemaError && e.message === message, message);

test('a valid tree lists its nodes in reading order', () => {
  const nodes = readyNodes(copy(), N, true);
  assert.deepEqual(nodes.map((n) => n.id), ARTICLE_NODE_IDS);
  assert.deepEqual(nodes[0], {
    id: 'verdict', type: 'verdict', lang: 'en', kind: 'report', title: ARTICLE_TREE.verdict, src: [3, 5],
    basis: ARTICLE_TREE.verdict_basis,
  });
  const b2 = ARTICLE_TREE.branches[2];
  assert.deepEqual(nodes.find((n) => n.id === 'b2'), {
    id: 'b2', type: 'claim', title: b2.title, src: b2.src, basis: b2.basis, body: b2.body,
  });
  assert.deepEqual(nodes.at(-1), { id: 'b2.1', type: 'evidence', parent: 'b2', ...b2.children[1] });
});

// The validator is hand-written (SPEC §6) next to TREE_SCHEMA; this walks the schema so a field
// added to one and not the other fails here.
function* schemaFields(schema, path, at) {
  for (const [key, field] of Object.entries(schema.properties)) {
    const sub = field.anyOf?.at(-1) ?? field; // children: the two-item branch of "0 or 2"
    yield { path: `${path}${key}`, sub, parent: at, key };
    const inner = sub.type === 'array' && sub.items.type === 'object' ? sub.items : null;
    if (inner) yield* schemaFields(inner, `${path}${key}[0].`, (t) => at(t)[key][0]);
  }
}

test('every field TREE_SCHEMA requires is required by the validator, lang excepted', () => {
  const fields = [...schemaFields(TREE_SCHEMA, '', (t) => t)];
  assert.equal(fields.length, 14);
  // Trees saved in the panel and scored by the eval before lang existed have none.
  const { lang, ...old } = copy();
  assert.equal(readyNodes(old, N, true)[0].lang, undefined);
  for (const { path, parent, key } of fields.filter((f) => f.path !== 'lang')) {
    const tree = copy();
    delete parent(tree)[key];
    rejects(tree, `${path} is missing`);
  }
});

test('every field TREE_SCHEMA types is type-checked by the validator', () => {
  const wrong = { string: 7, integer: 'x', boolean: 'yes', array: 'x', object: 'x' };
  for (const { path, sub, parent, key } of schemaFields(TREE_SCHEMA, '', (t) => t)) {
    const tree = copy();
    parent(tree)[key] = wrong[sub.type];
    assert.throws(() => readyNodes(tree, N, true), SchemaError, path);
    if (sub.type === 'array' && sub.items.type !== 'object') {
      const t2 = copy();
      parent(t2)[key] = [wrong[sub.items.type]];
      assert.throws(() => readyNodes(t2, N, true), SchemaError, `${path}[0]`);
    }
  }
});

test('the tree rules: 3-5 branches, two or no children, real paragraph numbers, known kind', () => {
  let t = copy();
  t.branches.pop();
  rejects(t, 'branches has 2 items; it must have 3-5');
  t = copy();
  t.branches.push(...copy().branches);
  rejects(t, 'branches has 6 items; it must have 3-5');
  t = copy();
  t.branches[0].children.pop();
  rejects(t, 'branches[0].children has 1 item; it must have 0 or 2');
  for (const [src, message] of [
    [[], 'verdict_src must list at least one paragraph number'],
    [[0], 'verdict_src[0] is 0, not a paragraph number (1-9)'],
    [[3, 10], 'verdict_src[1] is 10, not a paragraph number (1-9)'],
    [[1.5], 'verdict_src[0] is 1.5, not a paragraph number (1-9)'],
  ]) {
    t = copy();
    t.verdict_src = src;
    rejects(t, message);
  }
  t = copy();
  t.lang = 'English language';
  rejects(t, 'lang must be a language code such as en, zh or pt-BR');
  t = copy();
  t.kind = 'opinion';
  rejects(t, 'kind must be one of argument, report, narrative, reference');
  t = copy();
  t.branches[1].title = '  ';
  rejects(t, 'branches[1].title must be a non-empty string');
  t = copy();
  t.branches[2].children[1].derived = 'true';
  rejects(t, 'branches[2].children[1].derived must be true or false');
});

test('while streaming, nodes appear in order as their own fields complete, verdict first', () => {
  const text = JSON.stringify(ARTICLE_TREE);
  const full = readyNodes(copy(), N, true);
  let seen = 0;
  for (let k = 1; k <= text.length; k++) {
    const nodes = readyNodes(parsePartial(text.slice(0, k)), N, false);
    assert.ok(nodes.length >= seen, `nodes never disappear (prefix ${k})`);
    seen = nodes.length;
    // Every node is final when shown.
    for (const [i, node] of nodes.entries()) assert.deepEqual(node, full[i], `prefix ${k}`);
  }
  const verdictReady = text.indexOf('"branches"');
  assert.equal(readyNodes(parsePartial(text.slice(0, verdictReady)), N)[0].id, 'verdict');
  assert.equal(readyNodes(parsePartial(text.slice(0, verdictReady - 3)), N).length, 0);
});

test('a bad value fails as soon as its node is complete, before the answer ends', () => {
  const t = copy();
  t.verdict_src = [99];
  const text = JSON.stringify(t);
  const cut = text.indexOf('"branches"');
  assert.throws(() => readyNodes(parsePartial(text.slice(0, cut)), N), /verdict_src\[0\] is 99/);
  t.branches[0].children = [t.branches[0].children[0]];
  t.verdict_src = [3];
  const one = JSON.stringify(t);
  assert.throws(() => readyNodes(parsePartial(one.slice(0, one.indexOf('"title"', one.indexOf('"children"')))), N),
    /branches\[0\]\.children has 1 item;/);
});
