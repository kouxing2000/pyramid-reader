#!/usr/bin/env node
// Chrome Web Store screenshots, 1280x800, from the bundled demo (SPEC §5.5): a CC BY-SA Wikipedia
// article, so no third-party article text lands in a store asset. Loads src/ unpacked in
// Playwright's Chromium, opens the demo page, opens the real side panel from the page's own button
// and captures page and panel over CDP (Playwright has no Page for the side panel), then composes
// the two into one 1280x800 frame: the page on the left, the panel on the right, as a reader sees
// them. Nothing is drawn that a reader would not see: no caption, no key, no fake text.
//
//   node scripts/screenshots.mjs           -> store/screenshots/*.png
//   HEADED=1 node scripts/screenshots.mjs  -> the same, in a visible browser
//
// The tree read in Chinese is not captured here: it needs Chrome's on-device Translator to download
// a language model, which Playwright's Chromium cannot; that shot is taken by hand in real Chrome.
import { chromium } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachSidePanel, poll, sleep } from '../tests/e2e/side-panel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'store', 'screenshots');
const W = 1280, H = 800, PANEL_W = 380, PAGE_W = W - PANEL_W;
const HEADED = process.env.HEADED === '1' || process.env.HEADED === 'true';


// A browser with the extension loaded, its demo page open at PAGE_W x H, and its side panel
// attached at PANEL_W x H. English only, as the E2E runs: the English demo then offers no second
// language, so no Read-in switch shows.
async function open() {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'pr-shots-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium', headless: !HEADED, deviceScaleFactor: 1, viewport: { width: PAGE_W, height: H },
    args: [`--disable-extensions-except=${SRC}`, `--load-extension=${SRC}`, '--enable-unsafe-extension-debugging', '--lang=en-US'],
  });
  const close = async () => { await context.close(); rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); };
  try {
    const ours = (w) => w.url().endsWith('/background.js');
    const worker = context.serviceWorkers().find(ours) ?? await context.waitForEvent('serviceworker', { predicate: ours, timeout: 15_000 });
    const extensionId = new URL(worker.url()).host;
    const cdp = await context.browser().newBrowserCDPSession();
    const page = context.pages()[0] ?? await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
    await page.goto(`chrome-extension://${extensionId}/demo/demo.html`);
    await page.click('#open-tree'); // a trusted click: sidePanel.open needs the gesture
    const panel = await attachSidePanel(cdp, extensionId);
    await panel.send('Emulation.setDeviceMetricsOverride', { width: PANEL_W, height: H, deviceScaleFactor: 1, mobile: false });
    await panel.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    await poll(() => panel.text('#status').then((t) => t?.startsWith('Demo:')), { what: 'the demo tree' });
    await poll(() => page.evaluate(() => CSS.highlights.size > 1), { what: 'the tree painted on the page' });
    return { context, page, panel, close };
  } catch (e) {
    await close();
    throw e;
  }
}

// Page and panel side by side, exactly W x H: a composer page lays the two captures out and is
// itself captured, so no image library is needed.
async function compose(context, page, panel, file) {
  const pageShot = (await page.screenshot()).toString('base64');
  const { data: panelShot } = await panel.send('Page.captureScreenshot', { format: 'png' });
  const composer = await context.newPage();
  await composer.setViewportSize({ width: W, height: H });
  await composer.setContent(`<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; background: #fff; }
    .stage { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; }
    img { position: absolute; top: 0; display: block; }
    .page { left: 0; width: ${PAGE_W}px; height: ${H}px; }
    .panel { left: ${PAGE_W}px; width: ${PANEL_W}px; height: ${H}px; }
    .rule { position: absolute; top: 0; left: ${PAGE_W}px; width: 1px; height: ${H}px; background: #c9ced6; }
  </style><div class="stage"><img class="page" src="data:image/png;base64,${pageShot}">
    <img class="panel" src="data:image/png;base64,${panelShot}"><div class="rule"></div></div>`);
  await composer.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await composer.locator('.stage').screenshot({ path: file });
  await composer.close();
  console.log(`wrote ${path.relative(ROOT, file)}`);
}

const openClaim = (panel, id) => panel.evaluate((id) => {
  const claim = document.querySelector(`.claim[data-id="${id}"]`);
  if (!claim.classList.contains('open')) claim.querySelector('.fold').click();
}, id);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const written = [];
  const shot = async (context, page, panel, name) => { const f = path.join(OUT, name); await compose(context, page, panel, f); written.push(f); };

  const en = await open();
  try {
    // The shots walk the levels in the order a reader opens them.
    // 01: the first screen: the verdict alone, every claim folded to its title, the page painted.
    await en.page.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);
    await shot(en.context, en.page, en.panel, '01-verdict.png');

    // 02: a claim opened, on demand: its summary, its sources, its quotes.
    await openClaim(en.panel, 'b0');
    await sleep(300);
    await shot(en.context, en.page, en.panel, '02-claim.png');

    // 03: a quote clicked: the page scrolled to its sentence, highlighted; the quote marked current.
    await en.panel.evaluate(() => { document.querySelector('.claim[data-id="b0"] .fold').click(); });
    await openClaim(en.panel, 'b1');
    await en.panel.click('.evidence[data-id="b1.0"] .quote');
    await poll(() => en.page.evaluate(() => CSS.highlights.get('pyramid-reader')?.size > 0), { what: 'the quote highlighted on the page' });
    await en.panel.evaluate(() => { document.querySelector('.claims-head').scrollIntoView({ block: 'start' }); });
    await sleep(300);
    await shot(en.context, en.page, en.panel, '03-sentence.png');

    // 04: Settings: provider, model, an empty key field, the tested-models table.
    await en.panel.click('#settings > summary');
    await poll(() => en.panel.evaluate(() => document.querySelector('#tested-models')?.checkVisibility()), { what: 'the tested-models table' });
    await en.panel.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);
    await shot(en.context, en.page, en.panel, '04-settings.png');
  } finally {
    await en.close();
  }
  console.log(`${written.length} screenshot(s) in ${path.relative(ROOT, OUT)}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
