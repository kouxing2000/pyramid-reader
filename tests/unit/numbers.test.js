import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numbersIn } from '../../src/lib/verify/numbers.js';
import { verifier } from '../../src/lib/verify/index.js';

const values = (text) => numbersIn(text).map((x) => x.value);

test('numbers are read as values, whatever the notation', () => {
  assert.deepEqual(values('3.2 million, £3.2m and 3,200,000'), [3.2e6, 3.2e6, 3.2e6]);
  assert.deepEqual(values('fifty-seven, fifty seven and 57'), [57, 57, 57]);
  assert.deepEqual(values('2.7% of 1,000 in 1907–1938'), [2.7, 1000, 1907, 1938]);
  assert.deepEqual(values('two million robots, four hundred carriers, three hundred thousand homes'), [2e6, 400, 3e5]);
  assert.deepEqual(values('seventeen cases, the 21st case'), [17, 21]);
});

test('no number is read inside a word, nor from a lone "one" or "two"', () => {
  assert.deepEqual(values('one of the two sides, a tenant, often, Kimi K3'), []);
});

test('a number in a verdict or claim must be in the paragraphs it cites', () => {
  const verify = verifier([
    { n: 1, text: 'The ferry carried fifty-seven passengers in 1907.' },
    { n: 2, text: 'Its sister ship carried 120.' },
  ]);
  const flags = (node) => verify({ id: 'x', src: [1], basis: '', body: '', ...node }).flags;
  assert.deepEqual(flags({ type: 'verdict', title: 'In 1907 the ferry carried 57 passengers' }), []);
  assert.deepEqual(flags({ type: 'claim', title: 'The ferry was full', body: 'It carried 120 people in 1908.' }), [
    { type: 'number', value: '120', foundIn: 2 },
    { type: 'number', value: '1908', foundIn: null },
  ]);
  // A verdict's own words are its title; a claim's include its body.
  assert.deepEqual(flags({ type: 'verdict', title: 'The ferry was full', body: 'It carried 120.' }), []);
});

test('evidence carries no number flags: a quote is anchored as a whole, a derived value is declared', () => {
  const verify = verifier([{ n: 1, text: 'The ferry carried 57 passengers.' }]);
  for (const derived of [true, false]) {
    assert.deepEqual(verify({ id: 'b0.0', type: 'evidence', parent: 'b0', quote: 'About 60 passengers', src: [1], derived }).flags, []);
  }
});
