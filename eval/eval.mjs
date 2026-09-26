// The eval (SPEC §8): how the tested-models table gets its numbers, and how a prompt or model
// change is judged. Dev tooling, never shipped. Each step reads and writes eval/results/<run>/:
//
//   node eval/eval.mjs extract [--run R]
//     Reads every page in eval/pages.txt with the shipped page agent into local/pages/.
//   node eval/eval.mjs run --models all|<id,...> [--pages all|every:K|ids:<id,...>] [--cap USD]
//                          [--concurrency N] [--redo | --retry-crashes] [--run R]
//     Builds a tree per model and page not built yet, into local/trees/<model>/, and logs each
//     build's cost to spend.jsonl. A build starts only when its worst case fits under the cap,
//     which counts the whole ledger; one run at a time holds the run's lock. A model that cannot
//     be reached prints SKIPPED, and skipped.json keeps the reason for the summary.
//   node eval/eval.mjs score [--run R]
//     Offline: checks every stored tree again, and writes results.json and summary.md.
//   node eval/eval.mjs tested [--run R]
//     Writes a row for each model with a tree built into src/lib/tested-models.js.
//   node eval/eval.mjs check [--run R]
//     Checks the run's committed files, and the tested-models table, for page text.
//
// Page text, raw answers and trees stay in local/, which git ignores (AGENTS.md: never commit
// article text). score and tested refuse to write a file that repeats a run of page text, and
// they and check read every committed file again for one (spend.jsonl and skipped.json hold only
// ids, reasons and numbers, and are written unchecked).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leaks, pageRuns } from './lib/leak.js';
import { connect, MODELS } from './lib/models.js';
import { KINDS, launchReader, readPage, readPageList } from './lib/pages.js';
import { summaryMarkdown, testedRows } from './lib/report.js';
import { Budget, runOne, worstCase } from './lib/run.js';
import { commonPages, scoreRun } from './lib/score.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE_LIST = path.join(HERE, 'pages.txt');
const TESTED = path.resolve(HERE, '../src/lib/tested-models.js');
// A page with fewer paragraphs than this was not read as an article (a consent wall, a bot check).
const MIN_PARAGRAPHS = 5;
// claude -p runs on the dev machine's plan: stop before it uses up the week's allowance.
const MAX_PLAN_UTILIZATION = 0.9;
// The CLI itself died before any answer: the machine's failure, not the model's, which
// --retry-crashes builds again. Its estimated cost stays in the ledger.
const CRASH = /^ProviderError: claude -p ended without an answer \(exit SIG/;

function args(argv) {
  const [step, ...rest] = argv;
  const opts = { step };
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i].replace(/^--/, '');
    opts[k] = rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? true : rest[++i];
  }
  return opts;
}

const opts = args(process.argv.slice(2));
const run = opts.run ?? new Date().toLocaleDateString('sv-SE');
const DIR = path.join(HERE, 'results', run);
const LOCAL = path.join(DIR, 'local');
const pagesDir = path.join(LOCAL, 'pages');
const treesDir = (model) => path.join(LOCAL, 'trees', model);

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
// The run's files that git tracks: every file in its directory (local/ is a directory) but the
// lock, dotfiles and a write in progress.
const committedFiles = () => (fs.existsSync(DIR) ? fs.readdirSync(DIR, { withFileTypes: true }) : [])
  .filter((f) => f.isFile() && f.name !== 'run.lock' && !f.name.startsWith('.') && !f.name.endsWith('.tmp'))
  .map((f) => f.name);
const SKIPPED_FILE = () => path.join(DIR, 'skipped.json');
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** The run's pages as extracted, by id, each with its kind from pages.txt. */
function loadPages() {
  const pages = new Map();
  for (const p of readPageList(PAGE_LIST)) {
    const read = readJson(path.join(pagesDir, `${p.id}.json`), null);
    if (read) pages.set(p.id, { ...read, ...p });
  }
  return pages;
}

async function extract() {
  const list = readPageList(PAGE_LIST);
  const reader = await launchReader();
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const p = list[next++];
      const file = path.join(pagesDir, `${p.id}.json`);
      if (fs.existsSync(file) && !opts.redo) continue;
      try {
        const page = await readPage(reader, p.url);
        writeAtomic(file, JSON.stringify({ ...page, ...p }));
        const gate = page.paragraphs.length < MIN_PARAGRAPHS ? ` BELOW ${MIN_PARAGRAPHS} PARAGRAPHS` : '';
        console.log(`${p.id} ${p.kind} ${page.paragraphs.length} paragraphs, skipped ${JSON.stringify(page.skipped)}${gate} ${p.url}`);
      } catch (e) {
        console.log(`${p.id} ${p.kind} FAILED ${e.message.split('\n')[0]} ${p.url}`);
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: 4 }, worker));
  } finally {
    await reader.browser.close();
  }
}

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

// One run spends from a ledger at a time: the cap's reservations live in the running process.
function lockRun() {
  const file = path.join(DIR, 'run.lock');
  fs.mkdirSync(DIR, { recursive: true });
  for (;;) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(fs.readFileSync(file, 'utf8'));
      if (pidAlive(pid)) throw new Error(`another run (pid ${pid}) is spending from ${DIR}: one run at a time`);
      fs.rmSync(file, { force: true }); // left by a run that died
    }
  }
  const release = () => {
    try {
      if (fs.readFileSync(file, 'utf8') === String(process.pid)) fs.rmSync(file);
    } catch {
      // already gone
    }
  };
  process.on('exit', release);
}

/** A number option, or its default; a missing or malformed value is refused rather than guessed. */
function numberOpt(name, fallback, valid) {
  const raw = opts[name] ?? String(fallback);
  const n = typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  if (!valid(n)) throw new Error(`--${name} ${raw === true ? 'needs a value' : `${raw} is not valid`}`);
  return n;
}

/**
 * Refuses page text in the run's committed files and the tested-models table, as on disk or as
 * about to be written.
 * @param {Record<string, string>} pending  file name -> text not yet written
 * @returns {string[]} the names of the files checked
 */
function checkCommitted(pages, pending = {}) {
  const runs = pageRuns(pages.values());
  const names = [...committedFiles(), ...Object.keys(pending)];
  const files = { ...Object.fromEntries(names.map((name) => [name, path.join(DIR, name)])), 'tested-models.js': TESTED };
  for (const [name, file] of Object.entries(files)) {
    const text = pending[name] ?? (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
    const found = leaks(text, runs);
    if (found.length) throw new Error(`${name} repeats page text, which is never committed: "${found[0]}" (${found.length} runs)`);
  }
  return Object.keys(files);
}

function selectPages(pages) {
  const spec = opts.pages ?? 'all';
  const all = [...pages.values()];
  if (spec === 'all') return all;
  const [how, arg] = spec.split(':');
  if (how === 'ids') return arg.split(',').map((id) => pages.get(id) ?? (() => { throw new Error(`no extracted page ${id}`); })());
  if (how === 'every') {
    // Every K-th page of each kind, so a subset keeps the list's weighting.
    const k = Number(arg);
    return KINDS.flatMap((kind) => all.filter((p) => p.kind === kind).filter((_, i) => i % k === 0));
  }
  throw new Error(`--pages ${spec}: expected all, every:K or ids:<id,...>`);
}

async function runModels() {
  const pages = loadPages();
  const selected = selectPages(pages).filter((p) => {
    if (p.paragraphs.length >= MIN_PARAGRAPHS) return true;
    console.log(`not built: ${p.id} has ${p.paragraphs.length} paragraphs (${p.url})`);
    return false;
  });
  const want = opts.models === 'all' ? MODELS : String(opts.models ?? '').split(',').map((id) => {
    const m = MODELS.find((x) => x.id === id);
    if (!m) throw new Error(`no model ${id}; known: ${MODELS.map((x) => x.id).join(', ')}`);
    return m;
  });
  if (!want.length) throw new Error('--models all or --models <id,...>');
  const budget = new Budget(numberOpt('cap', 10, (n) => Number.isFinite(n) && n > 0), path.join(DIR, 'spend.jsonl'));
  const concurrency = numberOpt('concurrency', 3, (n) => Number.isInteger(n) && n >= 1);
  lockRun();
  console.log(`cap $${budget.cap}, spent $${budget.spent.toFixed(4)} so far; ${selected.length} pages`);
  const stopped = new Map(); // model id -> why its builds stopped
  const plan = { stopped: null };
  // Ctrl-C stops the builds in flight, as a reader's Stop would, and waits for them to record what
  // they cost before the lock goes; a second Ctrl-C quits at once.
  const stop = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      if (stop.signal.aborted) process.exit(130);
      console.log(`${sig}: stopping the builds in flight and recording their cost (again to quit now)`);
      process.exitCode = 130;
      stop.abort();
    });
  }
  const conns = new Map(want.map((m) => [m, connect(m)]));
  // The reasons are kept for the summary, which must name every skipped model (SPEC §8).
  const skipped = readJson(SKIPPED_FILE(), {});
  for (const [m, conn] of conns) {
    if (conn.skip) skipped[m.id] = conn.skip;
    else delete skipped[m.id];
  }
  writeAtomic(SKIPPED_FILE(), `${JSON.stringify(skipped, null, 1)}\n`);
  await Promise.all(want.map(async (m) => {
    const conn = conns.get(m);
    if (conn.skip) {
      console.log(`SKIPPED ${m.id}: ${conn.skip}`);
      return;
    }
    const todo = selected.filter((p) => {
      const record = readJson(path.join(treesDir(m.id), `${p.id}.json`), null);
      return opts.redo || !record || (opts['retry-crashes'] && CRASH.test(record.error ?? ''));
    });
    let next = 0;
    const built = new Set();
    const halted = () => stop.signal.aborted || (m.transport === 'claude-cli' && plan.stopped) || stopped.has(m.id);
    const worker = async () => {
      while (next < todo.length && !halted()) {
        const page = todo[next++];
        const reserve = worstCase(m, page);
        // Builds still running hold reservations: wait for them to settle before giving up.
        while (!budget.reserve(reserve)) {
          if (halted()) return;
          if (!budget.inFlight) {
            stopped.set(m.id, `by the cap: $${budget.spent.toFixed(4)} spent, ${page.id} could cost $${reserve.toFixed(4)}`);
            return;
          }
          await new Promise((ok) => setTimeout(ok, 1000));
        }
        const record = await runOne(m, conn, page, { signal: stop.signal });
        // A build Ctrl-C stopped is paid for but not kept: the page stays to be built.
        if (!(stop.signal.aborted && record.error)) {
          writeAtomic(path.join(treesDir(m.id), `${page.id}.json`), JSON.stringify(record));
          built.add(page.id);
        }
        budget.settle(reserve, {
          at: record.at, model: m.id, page: page.id, attempts: record.attempts.length,
          tokens: record.attempts.reduce((t, a) => ({ input: t.input + a.tokens.input, output: t.output + a.tokens.output }), { input: 0, output: 0 }),
          costUsd: record.costUsd, estimated: record.estimated,
        });
        const u = record.rateLimit?.unifiedWindows;
        if (record.rateLimit && (record.rateLimit.status !== 'allowed' || (u?.seven_day?.utilization ?? 0) >= MAX_PLAN_UTILIZATION)) {
          plan.stopped = `claude -p plan limit: ${JSON.stringify(record.rateLimit)}`;
        }
        console.log(`${m.id} ${page.id} ${record.error ? `ERROR ${record.error}` : 'ok'} verdict ${record.seconds.verdict}s tree ${record.seconds.total}s ` +
          `retries ${record.retries.length} $${record.costUsd.toFixed(4)}${record.estimated ? ' (estimated)' : ''}` +
          `${u ? ` plan 5h ${u.five_hour?.utilization} 7d ${u.seven_day?.utilization}` : ''} | total $${budget.spent.toFixed(4)}`);
      }
    };
    await Promise.all(Array.from({ length: m.transport === 'claude-cli' ? Math.min(concurrency, 2) : concurrency }, worker));
    const why = stopped.get(m.id) || (m.transport === 'claude-cli' && plan.stopped) || (stop.signal.aborted && 'by Ctrl-C');
    if (why && built.size < todo.length) console.log(`STOPPED ${m.id} ${why}; ${todo.length - built.size} pages not built`);
  }));
  console.log(`spent $${budget.spent.toFixed(4)} of $${budget.cap}`);
}

function score() {
  const pages = loadPages();
  const records = [];
  const treesRoot = path.join(LOCAL, 'trees');
  for (const model of fs.existsSync(treesRoot) ? fs.readdirSync(treesRoot).sort() : []) {
    for (const f of fs.readdirSync(treesDir(model)).sort()) {
      if (f.endsWith('.json')) records.push(readJson(path.join(treesDir(model), f)));
    }
  }
  const { models, nodes } = scoreRun(pages, records);
  // A like-for-like comparison when some models ran on a subset.
  const byModel = Object.groupBy(records, (r) => r.model);
  const commonIds = commonPages(records);
  const common = commonIds && { pages: commonIds.size, models: scoreRun(pages, records.filter((r) => commonIds.has(r.page.id))).models };
  const ledger = fs.existsSync(path.join(DIR, 'spend.jsonl'))
    ? fs.readFileSync(path.join(DIR, 'spend.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const built = new Set(records.map((r) => r.page.id));
  const results = {
    run, generated: new Date().toISOString(),
    pages: [...pages.values()].filter((p) => built.has(p.id)).map((p) => ({
      id: p.id, kind: p.kind, url: p.url, sha256: p.sha256, paragraphs: p.paragraphs.length, skipped: p.skipped,
    })),
    // As the run step recorded them, not as this shell would: a key present now says nothing of
    // the run. A model skipped once and built later is not skipped.
    skipped: Object.entries(readJson(SKIPPED_FILE(), {})).filter(([id]) => !byModel[id]).map(([id, why]) => `SKIPPED ${id}: ${why}`),
    spend: ledger.reduce((t, e) => t + e.costUsd, 0),
    models, common, nodes,
  };
  const committed = {
    'results.json': `${JSON.stringify(results, null, 1)}\n`,
    'summary.md': summaryMarkdown(results),
  };
  checkCommitted(pages, committed);
  for (const [name, text] of Object.entries(committed)) writeAtomic(path.join(DIR, name), text);
  for (const m of models) {
    console.log(`${m.model}: ${m.built}/${m.attempted} trees, quotes anchored ${m.anchored}, number flags ${m.numberFlaggedNodes}/${m.basis.total} nodes, ` +
      `verdict ${m.seconds.verdict}s, tree ${m.seconds.total}s, $${m.costUsd}`);
  }
}

function tested() {
  const results = readJson(path.join(DIR, 'results.json'), null);
  if (!results) throw new Error(`no results.json in ${DIR}: run score first`);
  const rows = testedRows(results);
  const unbuilt = results.models.filter((m) => !m.built).map((m) => m.model);
  if (unbuilt.length) console.log(`not listed, no tree built: ${unbuilt.join(', ')}`);
  const src = fs.readFileSync(TESTED, 'utf8');
  const at = /^export const TESTED_MODELS = \[(?:\];|[\s\S]*?^\];)$/m; // empty, or one row a line
  if (!at.test(src)) throw new Error(`${TESTED}: no TESTED_MODELS array to replace`);
  const value = (v) => (typeof v === 'string' ? `'${v.replace(/['\\]/g, '\\$&')}'` : String(v));
  const row = (r) => `  { ${Object.entries(r).map(([k, v]) => `${k}: ${value(v)}`).join(', ')} },`;
  const literal = rows.length ? `export const TESTED_MODELS = [\n${rows.map(row).join('\n')}\n];` : 'export const TESTED_MODELS = [];';
  const text = src.replace(at, literal);
  checkCommitted(loadPages(), { 'tested-models.js': text });
  writeAtomic(TESTED, text);
  console.log(`${TESTED}: ${rows.length} rows`);
}

function check() {
  const pages = loadPages();
  if (!pages.size) throw new Error(`no pages in ${pagesDir} to check against: nothing was checked`);
  const checked = checkCommitted(pages);
  console.log(`no page text in ${checked.join(', ')} (${pages.size} pages)`);
}

const steps = { extract, run: runModels, score, tested, check };
if (!steps[opts.step]) {
  console.error('usage: node eval/eval.mjs extract | run --models all|<id,...> [--pages ...] [--cap USD] | score | tested | check  [--run R]');
  process.exit(2);
}
await steps[opts.step]();
