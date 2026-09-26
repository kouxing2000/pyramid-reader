// Builds the first-run demo (SPEC §5.5) in src/demo/. Dev tooling: never shipped, run by hand.
//
//   node scripts/build-demo.mjs page
//     Opens the pinned Wikipedia revision in Chromium, reads it with the extension's own page agent
//     (the paragraphs a reader sees, SPEC §4.5), and writes them to src/demo/demo.html with the
//     attribution and licence CC BY-SA 4.0 asks for.
//   node scripts/build-demo.mjs tree <provider> <model> <KEY_ENV_VAR>
//     Builds the demo's tree through the extension's own prompt, transport, validator and checks,
//     from the paragraphs in demo.html. It writes src/demo/demo-tree.js only when every node is
//     found on the page and none carries a flag (a number its cited paragraphs do not hold), and
//     otherwise exits 1 with the flags, writing nothing.
//
// The demo tree is therefore a selected run, not a typical one. The demo-tree.js committed in M4
// (DEMO_META: gpt-5.5, 2026-09-24) is that model's third run, thinking off. Whoever rebuilds the
// tree rewrites this paragraph.
//
// The demo text is the one article text the repo carries (AGENTS.md).
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pageAgent } from '../src/content/page.js';
import { buildTree } from '../src/lib/build.js';
import { treePrompt } from '../src/lib/prompt.js';
import { endpointOrigin, providerConfig, PROVIDERS } from '../src/lib/providers/index.js';
import { verifier } from '../src/lib/verify/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.resolve(HERE, '../src/demo');

// The snapshot: a fixed revision, so the text and the tree built from it never drift apart.
const SOURCE = {
  title: 'Mary Mallon',
  revision: 1376401637,
  timestamp: '2026-09-24T00:00:05Z',
  url: 'https://en.wikipedia.org/w/index.php?title=Mary_Mallon&oldid=1376401637',
  history: 'https://en.wikipedia.org/w/index.php?title=Mary_Mallon&action=history',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
};

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const textHash = (paragraphs) => createHash('sha256').update(JSON.stringify(paragraphs.map((p) => [p.heading, p.text]))).digest('hex');

async function extract(url) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(url, { waitUntil: 'load' });
    const read = await page.evaluate(pageAgent, { op: 'extract' });
    // Heading levels, which the page agent does not report: h2 or h3, by the heading's text.
    const levels = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('h2, h3')]
      .map((h) => [h.textContent.replace(/\s+/g, ' ').trim(), h.tagName.toLowerCase()])));
    return { ...read, levels };
  } finally {
    await browser.close();
  }
}

async function writePage() {
  const { title, paragraphs, skipped, levels } = await extract(SOURCE.url);
  const body = [];
  let heading = null;
  for (const p of paragraphs) {
    if (p.heading !== heading && p.heading) {
      const tag = levels[p.heading] ?? 'h2';
      body.push(`    <${tag}>${escape(p.heading)}</${tag}>`);
    }
    heading = p.heading;
    body.push(`    <p>${escape(p.text)}</p>`);
  }
  const date = new Date(SOURCE.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  let html = fs.readFileSync(path.join(HERE, 'demo.template.html'), 'utf8');
  for (const [k, v] of Object.entries({ ...SOURCE, date })) html = html.replaceAll(`{{${k}}}`, escape(String(v)));
  html = html.replace('{{ARTICLE}}', body.join('\n'));
  if (/{{\w+}}/.test(html)) throw new Error(`unfilled placeholder: ${html.match(/{{\w+}}/)[0]}`);
  const tmp = path.join(DEMO, `demo.html.${process.pid}.tmp`);
  fs.writeFileSync(tmp, html);
  fs.renameSync(tmp, path.join(DEMO, 'demo.html'));
  console.log(`demo.html: "${title}", ${paragraphs.length} paragraphs (skipped ${JSON.stringify(skipped)}), ` +
    `text sha256 ${textHash(paragraphs)}`);
}

// The paragraphs as the extension reads them from demo.html itself.
async function demoParagraphs() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(pathToFileURL(path.join(DEMO, 'demo.html')).href);
    return await page.evaluate(pageAgent, { op: 'extract' });
  } finally {
    await browser.close();
  }
}

async function writeTree(provider, model, keyVar) {
  const key = process.env[keyVar];
  if (!key) throw new Error(`${keyVar} is not set`);
  const cfg = providerConfig({ provider, providers: { [provider]: { model } } },
    { [endpointOrigin(PROVIDERS[provider].baseUrl)]: key });
  if (!cfg) throw new Error(`no config for ${provider} ${model}`);
  const page = await demoParagraphs();
  const nodes = [];
  const retries = [];
  const started = Date.now();
  const tree = await buildTree({
    prompt: treePrompt(page),
    stream: (p, signal) => cfg.transport.stream(cfg, p, signal),
    count: page.paragraphs.length,
    verify: verifier(page.paragraphs),
    onNode: (n) => nodes.push(n),
    onRetry: (e) => {
      retries.push(e);
      nodes.length = 0; // the rejected answer's nodes are void
    },
  });
  const final = new Map(nodes.map((n) => [n.id, n]));
  let clean = true;
  for (const n of final.values()) {
    const flags = n.flags.map((f) => `${f.type}: ${f.value}`);
    if (flags.length || !['anchored', 'derived'].includes(n.anchor.status)) clean = false;
    console.log(`${n.id} ${n.anchor.status}${flags.length ? ` | ${flags.join(' | ')}` : ''}`);
  }
  console.log(`${cfg.label} ${cfg.model}: ${((Date.now() - started) / 1000).toFixed(1)} s, retries ${JSON.stringify(retries)}`);
  if (!clean) {
    console.error('Not written: the demo shows a tree with every node on the page and no flags. Run it again.');
    process.exit(1);
  }
  const meta = {
    title: SOURCE.title, revision: SOURCE.revision, url: SOURCE.url, license: SOURCE.license,
    provider: cfg.label, model: cfg.model, built: new Date().toISOString().slice(0, 10),
    paragraphs: page.paragraphs.length, textSha256: textHash(page.paragraphs),
  };
  const js = `// The demo's tree (SPEC §5.5), built by scripts/build-demo.mjs through the extension's own
// prompt, transport and checks, from the paragraphs of demo.html: a selected run, the first with
// every node on the page and no flags (the script's header says which run this is). It is an
// adaptation of the Wikipedia text in demo.html and shares its licence, CC BY-SA 4.0 (see
// demo.html). Generated file: rebuild it with the script rather than editing it.

export const DEMO_META = ${JSON.stringify(meta, null, 2)};

export const DEMO_TREE = ${JSON.stringify(tree, null, 2)};
`;
  const tmp = path.join(DEMO, `demo-tree.js.${process.pid}.tmp`);
  fs.writeFileSync(tmp, js);
  fs.renameSync(tmp, path.join(DEMO, 'demo-tree.js'));
}

const [step, ...args] = process.argv.slice(2);
if (step === 'page') await writePage();
else if (step === 'tree') await writeTree(...args);
else {
  console.error('usage: node scripts/build-demo.mjs page | tree <provider> <model> <KEY_ENV_VAR>');
  process.exit(2);
}
