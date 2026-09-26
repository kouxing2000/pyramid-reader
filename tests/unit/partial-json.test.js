import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPEN, parsePartial } from '../../src/lib/partial-json.js';
import { ARTICLE_TREE } from '../fixtures/trees/article.js';

// Deep copy without the OPEN marks, for comparing with JSON.parse output.
const plain = (v) => JSON.parse(JSON.stringify(v));

// Every complete value in `partial` equals the value at the same place in `full`, and only an
// OPEN container may be shorter than its counterpart.
function assertPrefixOf(partial, full, path = '$') {
  if (typeof partial !== 'object' || partial === null) return assert.equal(partial, full, path);
  assert.equal(Array.isArray(partial), Array.isArray(full), path);
  const keys = Object.keys(partial);
  if (!partial[OPEN]) assert.deepEqual(keys, Object.keys(full), `${path} is closed but incomplete`);
  for (const k of keys) {
    assert.ok(k in full, `${path}.${k} is not in the full value`);
    assertPrefixOf(partial[k], full[k], `${path}.${k}`);
  }
  for (const [i, k] of keys.entries()) {
    // Only the last member of an open container may itself be open.
    if (i < keys.length - 1 && typeof partial[k] === 'object' && partial[k] !== null) {
      assert.ok(!partial[k][OPEN], `${path}.${k} is open but not last`);
    }
  }
}

const SAMPLE = JSON.stringify({
  s: 'quote "q" back\\slash \n tab\t é 中文   😀', n: -12.5e3, z: 0, big: 1234567,
  t: true, f: false, nil: null, arr: [1, [2, 3], {}, []], obj: { deep: { x: 'y' } }, empty: '',
});

for (const [name, text] of [['a sample of every JSON type', SAMPLE],
  ['the fixture tree, spaced', JSON.stringify(ARTICLE_TREE, null, 2)],
  ['a sample with \\u escapes', JSON.stringify({ s: 'é中😀' }).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)]]) {
  test(`every prefix of ${name} parses to a consistent partial value`, () => {
    const full = JSON.parse(text);
    for (let k = 1; k < text.length; k++) {
      const partial = parsePartial(text.slice(0, k));
      assert.ok(partial[OPEN], `prefix ${k} is marked open`);
      assertPrefixOf(partial, full);
    }
    const whole = parsePartial(text);
    assert.equal(whole[OPEN], undefined);
    assert.deepEqual(plain(whole), full);
  });
}

test('values that may still grow are left out until they end', () => {
  assert.deepEqual(plain(parsePartial('{"a": "unfinish')), {});
  assert.deepEqual(plain(parsePartial('{"a": "x\\')), {});
  assert.deepEqual(plain(parsePartial('{"a": "x\\u00')), {});
  assert.deepEqual(plain(parsePartial('{"n": 12')), {});
  assert.deepEqual(plain(parsePartial('{"n": 1.5e')), {});
  assert.deepEqual(plain(parsePartial('{"n": 12 ')), { n: 12 });
  assert.deepEqual(plain(parsePartial('{"b": tr')), {});
  assert.deepEqual(plain(parsePartial('{"b": true')), { b: true });
  assert.deepEqual(plain(parsePartial('{"a": [1, 2')), { a: [1] });
  assert.deepEqual(plain(parsePartial('{"a": [1, 2,')), { a: [1, 2] });
  assert.deepEqual(plain(parsePartial('{"key')), {});
  assert.deepEqual(plain(parsePartial('{"key":')), {});
  const nested = parsePartial('{"a": {"b": [');
  assert.ok(nested[OPEN] && nested.a[OPEN] && nested.a.b[OPEN]);
});

test('text before the object is skipped and text after it ignored; no object yet is undefined', () => {
  assert.equal(parsePartial(''), undefined);
  assert.equal(parsePartial('```json\n'), undefined);
  assert.deepEqual(plain(parsePartial('```json\n{"a": 1}\n```')), { a: 1 });
  assert.equal(parsePartial('Here it is: {"a": 1}')[OPEN], undefined);
});

test('text that can never be JSON is a SyntaxError', () => {
  for (const bad of ['{"a" 1}', '{"a": x}', '{"a": 01}', '{"a": "b"]', '{a: 1}', '{"a": [1 2]}',
    '{"a": "\\q"}', '{"a": "\\u12G4"}', '{"a": "line\nbreak"}', '{"a": -}', '{"a": trux}']) {
    assert.throws(() => parsePartial(bad), SyntaxError, bad);
  }
});

test('"__proto__" is an ordinary key, as with JSON.parse', () => {
  const v = parsePartial('{"__proto__": {"polluted": 1}}');
  assert.deepEqual(Object.keys(v), ['__proto__']);
  assert.equal(Object.getPrototypeOf(v), Object.prototype);
  assert.equal({}.polluted, undefined);
});
