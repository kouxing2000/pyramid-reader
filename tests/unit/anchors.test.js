import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifier } from '../../src/lib/verify/index.js';
import { sentences } from '../../src/lib/verify/text.js';

// Paragraphs written for these tests.
const PAGE = [
  'The pier was rebuilt in 1998. Mr. Hale, the harbour master, said the “new” deck would last – with care – fifty years.',
  'Storms in 2021 lifted two sections of the deck. Repairs cost the town £40,000.',
  'The pier was rebuilt in 1998 by a local firm.',
  'Inspectors found rot in the foot\u00adbridges below the pier.',
  'Ticket prices rose 110% after the storms. Were the repairs worth it?',
].map((text, i) => ({ n: i + 1, text }));
const verify = verifier(PAGE);
const evidence = (quote, src, derived = false) => verify({ id: 'b0.0', type: 'evidence', parent: 'b0', quote, src, derived });
const claim = (basis, src) => verify({ id: 'b0', type: 'claim', title: 'The pier', src, basis, body: '' });
const slice = ({ anchor: { n, start, end } }) => PAGE[n - 1].text.slice(start, end);

test('a quote in a cited paragraph is anchored at its exact characters, with its sentence', () => {
  const node = evidence('the harbour master, said', [1]);
  assert.equal(node.anchor.status, 'anchored');
  assert.equal(slice(node), 'the harbour master, said');
  assert.equal(node.anchor.sentence, 'Mr. Hale, the harbour master, said the “new” deck would last – with care – fifty years.');
  assert.deepEqual(node.src, [1]);
});

test('quote marks, dashes, case, spacing and edge punctuation do not stop a match; the page\'s own characters are highlighted', () => {
  for (const quote of [
    'said the "new" deck would last - with care - fifty years.',
    '“Said the “new”  deck would last — with care — fifty years”',
    'SAID THE "NEW" DECK',
  ]) {
    const node = evidence(quote, [1]);
    assert.equal(node.anchor.status, 'anchored', quote);
    assert.ok(PAGE[0].text.includes(slice(node)), quote);
    assert.match(slice(node), /^said the “new” deck/, quote);
  }
});

test('text the reader cannot see (a soft hyphen) sits inside the highlighted range', () => {
  const node = evidence('rot in the footbridges', [4]);
  assert.equal(node.anchor.status, 'anchored');
  assert.equal(slice(node), 'rot in the foot\u00adbridges');
});

test('the cited paragraphs are searched first, in citation order', () => {
  assert.equal(evidence('The pier was rebuilt in 1998', [3]).anchor.n, 3);
  assert.equal(evidence('The pier was rebuilt in 1998', [3, 1]).anchor.n, 3);
  assert.equal(evidence('The pier was rebuilt in 1998', [2, 1, 3]).anchor.n, 1);
});

test('found elsewhere: evidence moves its citation there, a claim adds it', () => {
  const quote = evidence('Repairs cost the town £40,000', [1]);
  assert.deepEqual([quote.anchor.status, quote.anchor.n, quote.anchor.from, quote.src], ['repaired', 2, [1], [2]]);
  const basis = claim('Storms in 2021 lifted two sections of the deck.', [1]);
  assert.deepEqual([basis.anchor.status, basis.anchor.n, basis.src], ['repaired', 2, [1, 2]]);
  assert.equal(slice(basis), 'Storms in 2021 lifted two sections of the deck.');
});

test('a match is whole words and numbers, and keeps the stop the passage ends with', () => {
  assert.deepEqual(evidence('10%', [5]).anchor, { status: 'unanchored' });
  assert.deepEqual(evidence('rate', [1, 2, 3, 4, 5]).anchor, { status: 'unanchored' });
  assert.equal(slice(evidence('Were the repairs worth it?', [5])), 'Were the repairs worth it?');
  assert.equal(slice(evidence('Were the repairs worth it', [5])), 'Were the repairs worth it');
  assert.equal(slice(evidence('"prices rose 110%."', [5])), 'prices rose 110%');
});

test('text that is not on the page is unanchored and keeps its citations', () => {
  for (const node of [evidence('the deck will last a century', [1]), claim('The town paid for the storm repairs.', [2]), evidence('"…"', [1])]) {
    assert.deepEqual(node.anchor, { status: 'unanchored' });
  }
  assert.deepEqual(claim('The town paid for the storm repairs.', [2]).src, [2]);
});

test('a declared value is taken as computed only when it states a number; otherwise it is located like a quote', () => {
  assert.deepEqual(evidence('About 26 years between rebuild and storm', [1, 2], true).anchor, { status: 'derived' });
  assert.equal(evidence('Storms in 2021 lifted two sections', [2], true).anchor.status, 'derived');
  assert.equal(evidence('the harbour master', [1], true).anchor.status, 'anchored');
  assert.deepEqual(evidence('the deck is in poor shape', [1], true).anchor, { status: 'unanchored' });
});

test('sentences: a title or an initial does not end a sentence', () => {
  const text = 'Mrs. Hale met Dr. Ng in the U.S. Senate. B. Raymond Hoobler came too. It rained.';
  assert.deepEqual(sentences(text).map(({ start, end }) => text.slice(start, end)),
    ['Mrs. Hale met Dr. Ng in the U.S. Senate.', 'B. Raymond Hoobler came too.', 'It rained.']);
  const pronoun = 'Neither did I. Then we left.';
  assert.deepEqual(sentences(pronoun).map(({ start, end }) => pronoun.slice(start, end)), ['Neither did I.', 'Then we left.']);
});
