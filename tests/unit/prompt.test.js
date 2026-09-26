import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryPrompt, RULES, treePrompt } from '../../src/lib/prompt.js';
import { TREE_SCHEMA } from '../../src/lib/tree.js';

const PAGE = {
  title: 'The Ledger',
  paragraphs: [
    { n: 1, text: 'Intro.', heading: null },
    { n: 2, text: 'First.', heading: 'Found' },
    { n: 3, text: 'Second.', heading: 'Found' },
    { n: 4, text: 'Third.', heading: 'Next' },
  ],
};

test('the article goes in the user message: title, headings once each, numbered paragraphs', () => {
  const { user } = treePrompt(PAGE);
  assert.equal(user, '# The Ledger\n[1] Intro.\n## Found\n[2] First.\n[3] Second.\n## Next\n[4] Third.');
  assert.equal(treePrompt({ ...PAGE, title: '' }).user.split('\n')[0], '[1] Intro.');
});

test('the system message is the rules, with the hedge rule, then the schema', () => {
  const { system, schema } = treePrompt(PAGE);
  assert.ok(system.startsWith(RULES));
  assert.match(RULES, /Keep the article's certainty/);
  assert.match(RULES, /Never turn\s+"unclear" into "unlikely"/);
  assert.deepEqual(JSON.parse(system.slice(system.indexOf('{'))), TREE_SCHEMA);
  assert.equal(schema, TREE_SCHEMA);
});

test('a retry carries the error text after the article', () => {
  const p = treePrompt(PAGE);
  const r = retryPrompt(p, 'branches has 2 items; it must have 3-5');
  assert.equal(r.system, p.system);
  assert.ok(r.user.startsWith(p.user));
  assert.match(r.user, /rejected: branches has 2 items; it must have 3-5\. Answer again/);
});

// OpenAI strict mode rejects a schema whose objects allow extra keys or leave any key optional.
test('the schema is valid for OpenAI strict structured outputs', () => {
  let objects = 0;
  const walk = (s, path) => {
    if (s.anyOf) return s.anyOf.forEach((alt, i) => walk(alt, `${path}|${i}`));
    if (s.type === 'object') {
      objects++;
      assert.equal(s.additionalProperties, false, path);
      assert.deepEqual(s.required, Object.keys(s.properties), path);
      for (const [k, v] of Object.entries(s.properties)) walk(v, `${path}.${k}`);
    }
    if (s.type === 'array') walk(s.items, `${path}[]`);
  };
  walk(TREE_SCHEMA, '$');
  assert.equal(objects, 4); // root, branch, and evidence under each of children's two forms
});

test('the schema itself allows 3-5 branches and two or no children', () => {
  const { branches } = TREE_SCHEMA.properties;
  assert.deepEqual([branches.minItems, branches.maxItems], [3, 5]);
  assert.deepEqual(branches.items.properties.children.anyOf.map((a) => [a.minItems, a.maxItems]), [[0, 0], [2, 2]]);
});

test('the language and the verdict\'s source fields come before the branches (generation order)', () => {
  assert.deepEqual(Object.keys(TREE_SCHEMA.properties), ['lang', 'kind', 'verdict', 'verdict_src', 'verdict_basis', 'branches']);
  const branch = TREE_SCHEMA.properties.branches.items.properties;
  assert.deepEqual(Object.keys(branch), ['title', 'src', 'basis', 'body', 'children']);
  assert.deepEqual(Object.keys(branch.children.anyOf[1].items.properties), ['quote', 'src', 'derived']);
});
