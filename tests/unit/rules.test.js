// AGENTS.md rules that hold for every file in src/, checked as a lint rather than per feature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const files = readdirSync(SRC, { recursive: true }).filter((f) => /\.(js|html)$/.test(f));

const offending = (pattern) => files.flatMap((f) => readFileSync(path.join(SRC, f), 'utf8').split('\n')
  .map((line, i) => (pattern.test(line) ? `src/${f}:${i + 1}: ${line.trim()}` : null)).filter(Boolean));

test('the lint sees the panel sources', () => {
  assert.ok(files.some((f) => f.endsWith('panel.js')) && files.some((f) => f.endsWith('dom.js')), files.join(', '));
});

test('no HTML parsing sinks: page and model text reach the DOM as text only', () => {
  assert.deepEqual(offending(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|DOMParser|srcdoc/), []);
});

test('nothing is stored in chrome.storage.sync (keys stay on this machine)', () => {
  assert.deepEqual(offending(/storage\.sync/), []);
});

test('nothing is written to the console, where a key or article text could end up', () => {
  assert.deepEqual(offending(/console\.(log|info|debug|warn)/), []);
});

// SPEC §4.4 / §9.4, as a lint beside the E2E network test: the one place that can open a
// connection is the provider transport's shared POST, so a new call elsewhere fails here.
test('the one network call in src/ is providers/http.js', () => {
  const calls = offending(/\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|new Image\b/);
  assert.deepEqual(calls.filter((line) => !line.startsWith(`src/${path.join('lib', 'providers', 'http.js')}:`)), []);
  assert.equal(calls.length, 1, calls.join('\n'));
});

test('extension pages load nothing from the web: scripts, styles, images and frames are the extension\'s own', () => {
  assert.deepEqual(offending(/<(script|link|img|iframe|frame|source|video|audio|object|embed)\b[^>]*\b(src|href|data)=["']?(https?:)?\/\/|url\(\s*["']?(https?:)?\/\/|@import|window\.open\(|\bimport\(\s*["'`]?(https?:)?\/\//i), []);
});
