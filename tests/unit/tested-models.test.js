// The tested-models table (SPEC §5.4): the rows the eval writes into src/lib/tested-models.js, how
// the settings look a model up in it, and how a measured rate is shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS } from '../../src/lib/providers/index.js';
import { percent } from '../../src/panel/messages.js';
import { TESTED_MODELS, testedModel } from '../../src/lib/tested-models.js';

test('the tested-models table: a listed model has its row; any other is unmeasured', () => {
  const rows = [{ provider: 'gemini', model: 'gemini-3.8-flash', anchored: 0.98, verdictSeconds: 1.2, totalSeconds: 3.3, measured: '2026-09-24' }];
  assert.equal(testedModel('gemini', ' gemini-3.8-flash ', rows), rows[0]);
  assert.equal(testedModel('openai', 'gemini-3.8-flash', rows), null);
  assert.equal(testedModel('gemini', 'gemini-3.5-flash', rows), null);
});

test('a measured rate is shown rounded down to a tenth, so short of 100% never reads as 100%', () => {
  assert.equal(percent(1), '100%');
  assert.equal(percent(0.9996), '99.9%');
  assert.equal(percent(0.989), '98.9%');
  assert.equal(percent(0.75), '75%');
  assert.equal(percent(0), '0%');
});

test('the shipped tested-models rows, written by the eval, are well formed', () => {
  assert.ok(TESTED_MODELS.length > 0);
  for (const r of TESTED_MODELS) {
    assert.ok(PROVIDERS[r.provider], r.provider);
    assert.ok(r.model && r.model === r.model.trim(), r.model);
    assert.ok(r.anchored >= 0 && r.anchored <= 1, `${r.model}: ${r.anchored}`);
    assert.ok(r.verdictSeconds > 0 && r.totalSeconds >= r.verdictSeconds, r.model);
    assert.ok(Number.isInteger(r.pages) && r.pages > 0, r.model);
    assert.match(r.measured, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(testedModel(r.provider, r.model), TESTED_MODELS.find((x) => x.provider === r.provider && x.model === r.model));
  }
});
