import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree } from '../../src/lib/build.js';
import { treePrompt } from '../../src/lib/prompt.js';
import { readyNodes } from '../../src/lib/tree.js';
import { verifier } from '../../src/lib/verify/index.js';
import { ARTICLE_PAGE, ARTICLE_TREE, FLAWED_TREE } from '../fixtures/trees/article.js';

const checked = (tree) => readyNodes(tree, ARTICLE_PAGE.length, true).map(verifier(ARTICLE_PAGE));
const at = ({ anchor: { n, start, end } }) => ARTICLE_PAGE[n - 1].text.slice(start, end);

test('the fixture tree: every source found where it is cited, no flags', () => {
  const nodes = checked(ARTICLE_TREE);
  for (const node of nodes) {
    assert.deepEqual(node.flags, [], node.id);
    if (node.derived) {
      assert.deepEqual(node.anchor, { status: 'derived' }, node.id);
      continue;
    }
    assert.equal(node.anchor.status, 'anchored', node.id);
    assert.equal(at(node), node.type === 'evidence' ? node.quote : node.basis, node.id);
  }
  assert.equal(nodes.length, 8);
});

test('the flawed tree: each planted flaw shows on its node, and only there', () => {
  const byId = Object.fromEntries(checked(FLAWED_TREE).map((n) => [n.id, n]));
  const { b1, b2 } = byId;
  assert.deepEqual([byId['b0.0'].anchor.status, byId['b0.0'].anchor.from, byId['b0.0'].src], ['repaired', [5], [4]]);
  assert.deepEqual([b1.anchor, b1.src], [{ status: 'unanchored' }, [6]]);
  assert.deepEqual(b2.flags, [{ type: 'number', value: '4.5 million', foundIn: null }]);
  for (const node of Object.values(byId)) {
    if (node.id !== 'b2') assert.deepEqual(node.flags, [], node.id); // no check reads the verdict's lost "may"
    if (!['b0.0', 'b1', 'b2.1'].includes(node.id)) assert.equal(node.anchor.status, 'anchored', node.id);
  }
});

test('verify refuses a paragraph number the page does not have, naming it', () => {
  const verify = verifier(ARTICLE_PAGE);
  for (const n of [0, ARTICLE_PAGE.length + 1, 2.5, undefined]) {
    assert.throws(() => verify({ id: 'b1', type: 'claim', title: 'A title', body: '', basis: 'A basis.', src: [6, n] }),
      { name: 'RangeError', message: `b1 cites ¶${n}; the page has ¶1-¶9` });
  }
});

test('in a build, each node is shown once, checked', async () => {
  const text = JSON.stringify(FLAWED_TREE);
  const shown = [];
  await buildTree({
    prompt: treePrompt({ title: 'T', paragraphs: ARTICLE_PAGE }),
    count: ARTICLE_PAGE.length,
    verify: verifier(ARTICLE_PAGE),
    onNode: (node) => shown.push(node),
    stream: async function* () {
      for (let i = 0; i < text.length; i += 40) yield text.slice(i, i + 40);
    },
  });
  assert.equal(shown.filter((n) => n.id === 'verdict').length, 1);
  assert.deepEqual(shown.find((n) => n.id === 'b2').flags.map((f) => f.type), ['number']);
  assert.ok(shown.every((n) => n.anchor && Array.isArray(n.flags)));
});
