#!/usr/bin/env node
// Zips src/, the unpacked extension and the only directory that ships, into
// dist/pyramid-reader-v<version>.zip with manifest.json at the zip's root, as the Chrome Web
// Store requires. No build step: the source files are the artifact.
//
//   node scripts/package.mjs              -> dist/pyramid-reader-v<version>.zip
//   node scripts/package.mjs --out <dir>  -> <dir>/pyramid-reader-v<version>.zip
//
// Before zipping, every file the manifest names (the worker, the panel, the icons) must exist:
// Chrome rejects a package that names a missing file, and it rejects it after the upload.
// tests/unit/package.test.js runs this script and checks the zip holds exactly src/.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outDir = path.resolve(outFlag === -1 ? path.join(ROOT, 'dist') : args[outFlag + 1] ?? '');
if (outFlag !== -1 && !args[outFlag + 1]) fail('--out needs a directory');

const manifest = JSON.parse(readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) fail(`manifest_version is ${manifest.manifest_version}, not 3`);
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) fail(`version "${manifest.version}" is not 1-4 dot-separated integers`);

// Every file the manifest points at, wherever it points: a missing one is a broken package.
const named = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
].filter(Boolean);
const missing = named.filter((f) => !existsSync(path.join(SRC, f)));
if (missing.length) fail(`manifest names files that do not exist in src/: ${missing.join(', ')}`);

const name = `pyramid-reader-v${manifest.version}.zip`;
const zip = path.join(outDir, name);
mkdirSync(outDir, { recursive: true });
rmSync(zip, { force: true }); // zip(1) would otherwise add to an existing archive
// -X: no extra file attributes; -r: recurse; -q: quiet. Finder's .DS_Store never ships.
execFileSync('zip', ['-r', '-X', '-q', zip, '.', '-x', '.DS_Store', '*/.DS_Store'], { cwd: SRC, stdio: 'inherit' });

const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(Boolean);
if (!entries.includes('manifest.json')) fail('manifest.json is not at the zip root');
console.log(`${path.relative(process.cwd(), zip)}: ${manifest.name} v${manifest.version}, ${entries.length} entries, ${(statSync(zip).size / 1024).toFixed(0)} KB`);
console.log(`permissions: ${manifest.permissions.join(', ')}; optional hosts: ${manifest.optional_host_permissions.length}`);

function fail(why) {
  console.error(`package: ${why}`);
  process.exit(1);
}
