import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// AGENTS.md: only entry points touch chrome.* or the DOM at module top level, so every other
// src module imports in Node, where unit tests and the eval reuse it.
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const ENTRY_POINTS = new Set(['background.js', 'panel/panel.js', 'demo/demo.js']);

const modules = readdirSync(SRC, { recursive: true })
  .filter((f) => f.endsWith('.js'))
  .map((f) => f.split(path.sep).join('/'))
  .filter((f) => !ENTRY_POINTS.has(f));

test('there are non-entry modules to check', () => {
  assert.ok(modules.includes('content/page.js'), modules.join(', '));
});

for (const f of modules) {
  test(`src/${f} imports cleanly in Node`, async () => {
    await import(pathToFileURL(path.join(SRC, f)).href);
  });
}

test('the page agent is a plain function, injectable with executeScript({ func })', async () => {
  const { pageAgent } = await import(pathToFileURL(path.join(SRC, 'content/page.js')).href);
  assert.equal(typeof pageAgent, 'function');
  assert.match(pageAgent.toString(), /^function pageAgent\(/);
});
