// scripts/package.mjs: the zip the Web Store gets is exactly src/, with manifest.json at its root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'src');
const SCRIPT = path.join(ROOT, 'scripts/package.mjs');

// Every file under src/, as zip entries name them (posix paths relative to src/), Finder's
// .DS_Store aside. Directories are not listed: zip -r adds them, and the store ignores them.
const shipped = () => readdirSync(SRC, { recursive: true })
  .filter((f) => statSync(path.join(SRC, f)).isFile() && path.basename(f) !== '.DS_Store')
  .map((f) => f.split(path.sep).join('/')).sort();

test('the zip holds every file of src/ and nothing else, manifest.json at its root', () => {
  const out = mkdtempSync(path.join(os.tmpdir(), 'pr-package-'));
  try {
    execFileSync(process.execPath, [SCRIPT, '--out', out], { stdio: 'ignore' });
    const { version } = JSON.parse(readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
    const zip = path.join(out, `pyramid-reader-v${version}.zip`);
    assert.ok(statSync(zip).isFile(), `${zip} was written`);

    const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(Boolean)
      .filter((e) => !e.endsWith('/')).sort();
    assert.deepEqual(entries, shipped()); // shipped() names manifest.json at the root, relative to src/
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
