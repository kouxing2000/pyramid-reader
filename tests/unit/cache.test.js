import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_CAP, dropTree, loadTree, saveTree, treeKey } from '../../src/lib/cache.js';

// chrome.storage.local's get/set/remove over a Map, values copied as the real one does.
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(structuredClone(initial)));
  return {
    data,
    async get(keys) {
      const list = keys === null ? [...data.keys()] : [keys].flat();
      return Object.fromEntries(list.filter((k) => data.has(k)).map((k) => [k, structuredClone(data.get(k))]));
    },
    async set(items) { for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v)); },
    async remove(keys) { for (const k of [keys].flat()) data.delete(k); },
  };
}

test('the key is the URL without its fragment and the text sent, hashed', async () => {
  const key = await treeKey('https://news.example/a?id=1#section-2', 'TEXT');
  assert.match(key, /^tree:[0-9a-f]{64}$/);
  assert.equal(await treeKey('https://news.example/a?id=1', 'TEXT'), key);
  assert.notEqual(await treeKey('https://news.example/a?id=2', 'TEXT'), key);
  assert.notEqual(await treeKey('https://news.example/a?id=1', 'TEXT, edited'), key);
});

test('a saved tree loads back; an unknown or dropped key loads nothing', async () => {
  const storage = fakeStorage({ settings: { provider: 'openai' }, keys: { 'https://api.openai.com': 'k' } });
  const key = await treeKey('https://news.example/a', 'TEXT');
  assert.equal(await loadTree(storage, key), null);
  const entry = { url: 'https://news.example/a', model: 'm', label: 'L', tree: { verdict: 'V' } };
  await saveTree(storage, key, entry);
  const loaded = await loadTree(storage, key);
  assert.deepEqual({ ...loaded, savedAt: 0, usedAt: 0 }, { ...entry, savedAt: 0, usedAt: 0 });
  assert.ok(Math.abs(loaded.savedAt - Date.now()) < 5000);
  await dropTree(storage, key);
  assert.equal(await loadTree(storage, key), null);
  assert.deepEqual(await storage.get(['settings', 'keys']), { settings: { provider: 'openai' }, keys: { 'https://api.openai.com': 'k' } });
});

test('past the cap the least recently used trees go, and nothing but trees', async () => {
  const old = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`tree:${i}`, { savedAt: 1000 + i, tree: {} }]));
  const storage = fakeStorage({ ...old, settings: { provider: 'gemini' }, keys: { x: 'k' } });
  await loadTree(storage, 'tree:0'); // the oldest saved, but just shown again
  await saveTree(storage, 'tree:new', { tree: {} }, 3);
  assert.deepEqual([...storage.data.keys()].sort(), ['keys', 'settings', 'tree:0', 'tree:3', 'tree:new']);
  assert.equal(CACHE_CAP, 100);
});
