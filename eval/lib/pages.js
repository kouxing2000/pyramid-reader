// The eval's pages (SPEC §8): the list in eval/pages.txt, and each page read as the extension reads
// it. Chromium opens the URL and runs the shipped page agent (src/content/page.js) on it, so the
// paragraphs the models get, and the anchor rate measured on them, are what a reader's build would
// send (design decision 9). The text is kept only in the run's gitignored local/pages/.
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pageAgent } from '../../src/content/page.js';

export const KINDS = ['analysis', 'reference', 'narrative'];

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** A page's file name in a run: the URL's hash, so no title or text is in a path. */
const pageId = (url) => sha256(url).slice(0, 12);

/** The extracted text's hash, as scripts/build-demo.mjs pins the demo's. */
const textHash = (paragraphs) => sha256(JSON.stringify(paragraphs.map((p) => [p.heading, p.text])));

/**
 * eval/pages.txt: one `<kind> <url>` per line, kind one of KINDS; blank lines and `#` comments
 * are skipped.
 * @returns {{kind: string, url: string, id: string}[]}
 * @throws Error naming the first malformed line or repeated URL
 */
export function readPageList(file) {
  const pages = [];
  for (const [i, raw] of fs.readFileSync(file, 'utf8').split('\n').entries()) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [kind, url, ...rest] = line.split(/\s+/);
    if (!KINDS.includes(kind) || rest.length || !/^https?:\/\//.test(url ?? '')) {
      throw new Error(`${file}:${i + 1}: expected "<${KINDS.join('|')}> <url>", got "${raw}"`);
    }
    if (pages.some((p) => p.url === url)) throw new Error(`${file}:${i + 1}: ${url} is listed twice`);
    pages.push({ kind, url, id: pageId(url) });
  }
  return pages;
}

/** A Chromium to read pages with: the full build, as the extension's E2E uses, with a desktop user agent. */
export async function launchReader() {
  const browser = await chromium.launch({ channel: 'chromium' });
  const version = browser.version();
  const userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
  return { browser, newPage: () => browser.newPage({ viewport: { width: 1280, height: 900 }, userAgent }) };
}

// A reader presses Build on a page that is drawn, whether or not its ads have finished loading:
// the page is read once `load` fires or LOAD_MS after the document is parsed, whichever is first,
// and SETTLE_MS later, for a page that draws its article from script.
const LOAD_MS = 20_000;
const SETTLE_MS = 2000;

/**
 * Opens the URL and reads it with the page agent.
 * @returns {Promise<{url, title, paragraphs: {n, text, heading}[], skipped, sha256, chars, status,
 *   loaded}>}  status: the HTTP status of the document; loaded: whether `load` fired
 */
export async function readPage(reader, url) {
  const page = await reader.newPage();
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const loaded = await page.waitForLoadState('load', { timeout: LOAD_MS }).then(() => true, () => false);
    await page.waitForTimeout(SETTLE_MS);
    const { title, paragraphs, skipped } = await page.evaluate(pageAgent, { op: 'extract' });
    return {
      url, title, paragraphs, skipped, status: res?.status() ?? null, loaded,
      sha256: textHash(paragraphs), chars: paragraphs.reduce((t, p) => t + p.text.length, 0),
    };
  } finally {
    await page.close();
  }
}
