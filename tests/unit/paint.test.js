import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paintPlan } from '../../src/panel/paint.js';
import { readyNodes } from '../../src/lib/tree.js';
import { verifier } from '../../src/lib/verify/index.js';
import { ARTICLE_PAGE, ARTICLE_TREE, FLAWED_TREE } from '../fixtures/trees/article.js';

const checked = (tree) => readyNodes(tree, ARTICLE_PAGE.length, true).map(verifier(ARTICLE_PAGE));
const text = ({ n, start, end }) => ARTICLE_PAGE[n - 1].text.slice(start, end);
// A plan as [highlight, claim, painted text] rows, readable in a failure.
const rows = ({ marks }) => marks.map((m) => [m.h, m.id, text(m)]);

test('each claim is painted in its own colour with its evidence; the verdict in grey; a computed value not at all', () => {
  const [b0, b1, b2] = ARTICLE_TREE.branches;
  assert.deepEqual(rows(paintPlan(checked(ARTICLE_TREE))), [
    ['v', 'verdict', ARTICLE_TREE.verdict_basis],
    ['c1', 'b0', b0.basis],
    ['c1', 'b0', b0.children[0].quote],
    ['c1', 'b0', b0.children[1].quote],
    ['c2', 'b1', b1.basis],
    ['c3', 'b2', b2.basis],
    ['c3', 'b2', b2.children[0].quote], // b2.children[1] is derived: no sentence of its own
  ]);
});

test('only what was found is painted: an unanchored claim has no paint, a repaired quote is painted where it was found', () => {
  const plan = paintPlan(checked(FLAWED_TREE));
  assert.equal(plan.marks.some((m) => m.id === 'b1'), false);
  const repaired = plan.marks.find((m) => m.id === 'b0' && text(m) === FLAWED_TREE.branches[0].children[0].quote);
  assert.equal(repaired.n, 4); // cited ¶5, found in ¶4
});

test('off paints nothing', () => {
  assert.deepEqual(paintPlan(checked(ARTICLE_TREE), { mode: 'off' }), { marks: [] });
});

test('focus mode paints the picked claim alone, and nothing until one is picked', () => {
  const nodes = checked(ARTICLE_TREE);
  assert.deepEqual(paintPlan(nodes, { mode: 'focus', focus: 'b1' }).marks.map((m) => m.id), ['b1']);
  assert.deepEqual(paintPlan(nodes, { mode: 'focus', focus: 'verdict' }).marks.map((m) => m.id), ['verdict']);
  assert.deepEqual(paintPlan(nodes, { mode: 'focus' }).marks, []);
});

test('claims past the fifth colour start the colours again', () => {
  const claim = (i) => ({ id: `b${i}`, type: 'claim', anchor: { status: 'anchored', n: 1, start: 0, end: 1 } });
  assert.deepEqual(paintPlan([0, 4, 5].map(claim)).marks.map((m) => m.h), ['c1', 'c5', 'c1']);
});
