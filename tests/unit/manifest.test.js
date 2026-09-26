import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../../src/manifest.json', import.meta.url), 'utf8'));

test('install-time permissions are exactly the four in SPEC §6', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'scripting', 'sidePanel', 'storage']);
});

test('no host access, content script or optional API permission beyond SPEC §6', () => {
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.optional_permissions, undefined);
});

test('optional host permissions are specific provider origins, never a wildcard host', () => {
  assert.ok(manifest.optional_host_permissions.length > 0);
  for (const origin of manifest.optional_host_permissions) {
    assert.match(origin, /^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1))\/\*$/, origin);
  }
});

test('no mainland-China provider endpoints (mainland edition is out of scope, SPEC §9.2)', () => {
  for (const origin of ['https://dashscope.aliyuncs.com/*', 'https://api.moonshot.cn/*']) {
    assert.ok(!manifest.optional_host_permissions.includes(origin), origin);
  }
});

// The keyboard shortcut is the toolbar click by another route: _execute_action fires
// action.onClicked (there is no popup) and grants activeTab like the click does.
test('a keyboard shortcut runs the toolbar action, and no other command exists', () => {
  assert.deepEqual(Object.keys(manifest.commands), ['_execute_action']);
  assert.equal(manifest.commands._execute_action.suggested_key.default, 'Alt+Shift+P');
  assert.equal(manifest.action.default_popup, undefined);
});
