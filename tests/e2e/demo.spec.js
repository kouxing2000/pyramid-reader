// The first-run demo (SPEC §5.5, §4.7): before any key, the panel offers a Wikipedia snapshot
// served from the extension with its prebuilt tree, fully interactive.
import { createHash } from 'node:crypto';
import { test, expect } from './fixtures.js';
import { attachSidePanel, clickToolbarIcon, openPanel } from './side-panel.js';
import { highlighted, painted } from './page-checks.js';
import { shown } from './setup.js';
import { pageAgent } from '../../src/content/page.js';
import { MSG } from '../../src/panel/messages.js';
import { DEMO_META, DEMO_TREE } from '../../src/demo/demo-tree.js';

const NODES = 1 + DEMO_TREE.branches.reduce((k, b) => k + 1 + b.children.length, 0);
const demoUrl = (extensionId) => `chrome-extension://${extensionId}/demo/demo.html`;

test('with no key the panel offers the demo, which opens in a tab of its own, with its tree: anchored and clickable', async ({ context, page, server, cdp, extensionId }) => {
  const article = await openPanel({ page, cdp, extensionId }, server.url('article.html?demo'));
  await expect.poll(() => shown(article, '#demo-offer')).toEqual([true]);
  expect(await article.text('#demo-offer-text')).toBe(MSG.demoOffer);

  const opened = context.waitForEvent('page'); // the tab opens on about:blank, then loads the demo
  await article.click('#open-demo');
  const demo = await opened;
  await demo.waitForURL(demoUrl(extensionId));
  // The demo tab's own panel; the article's stays behind with its tab, as it was.
  const panel = await attachSidePanel(cdp, extensionId);
  expect(panel.targetId).not.toBe(article.targetId);
  await expect.poll(() => panel.text('#status')).toBe(MSG.demoTree(DEMO_META));
  expect(await article.texts('#tree *')).toEqual([]);
  expect(await panel.text('.verdict .title')).toBe(DEMO_TREE.verdict);
  expect(await panel.texts('.claim > .node > .title')).toEqual(DEMO_TREE.branches.map((b) => b.title));
  expect(await panel.text('#page-note')).toBe(MSG.paragraphs(DEMO_META.paragraphs, { hidden: 0, clipped: 0, covered: 0 }));
  expect(await panel.texts('.check')).toEqual(Array(NODES).fill(MSG.anchored));
  expect(await panel.texts('.flag')).toEqual([]);
  expect(await shown(panel, '#rebuild')).toEqual([false]);

  // The demo page is painted like any page, and pointing at a claim's paint marks the claim: the
  // demo runs the watcher itself, as it runs the page agent.
  await expect.poll(() => painted(demo).then((p) => Object.keys(p).sort()))
    .toEqual(['pr-v', ...DEMO_TREE.branches.map((_, i) => `pr-c${i + 1}`)].sort());
  const point = await demo.evaluate(() => {
    const r = [...CSS.highlights.get('pr-c2')][0];
    r.startContainer.parentElement.scrollIntoView({ block: 'center' });
    const box = r.getClientRects()[0];
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  await demo.mouse.move(point.x, point.y);
  await expect.poll(() => panel.evaluate(() => [...document.querySelectorAll('#tree .pointed')].map((e) => e.dataset.id))).toEqual(['b1']);
  await expect.poll(() => shown(panel, '#demo-offer')).toEqual([false]); // the demo is on screen

  // A claim shows its sentence on the demo page, and names it on hover.
  const b1 = DEMO_TREE.branches[1];
  await demo.emulateMedia({ reducedMotion: 'reduce' });
  await panel.click('.claim[data-id="b1"] .title');
  await expect.poll(() => highlighted(demo)).toEqual([b1.basis]);
  expect(await panel.evaluate(() => document.querySelector('.claim[data-id="b1"] .title').title)).toBe(b1.basis);
  await panel.click('.evidence[data-id="b1.0"] .quote');
  await expect.poll(() => highlighted(demo)).toEqual([b1.children[0].quote]);

  // Build on the demo page is the demo too: no key needed.
  await panel.click('#build');
  await expect.poll(() => panel.text('#status')).toBe(MSG.demoTree(DEMO_META));

  // A reloaded demo page is a new document: the panel draws the tree for it again, and its
  // sources still show.
  await panel.evaluate(() => { document.querySelector('.verdict').dataset.before = 'reload'; });
  await demo.reload();
  await expect.poll(() => panel.evaluate(() => document.querySelector('.verdict')?.dataset.before ?? 'redrawn')).toBe('redrawn');
  await panel.click('.claim[data-id="b1"] .title');
  await expect.poll(() => highlighted(demo)).toEqual([b1.basis]);
  expect(await panel.text('#status')).toBe(MSG.demoTree(DEMO_META));
});

test('the demo page reads as exactly the text its tree was built from, credits its source, and opens the panel itself', async ({ page, cdp, extensionId }) => {
  await page.goto(demoUrl(extensionId));
  const { paragraphs, skipped } = await page.evaluate(pageAgent, { op: 'extract' });
  expect(paragraphs).toHaveLength(DEMO_META.paragraphs);
  expect(skipped).toEqual({ hidden: 0, clipped: 0, covered: 0 });
  const hash = createHash('sha256').update(JSON.stringify(paragraphs.map((p) => [p.heading, p.text]))).digest('hex');
  expect(hash).toBe(DEMO_META.textSha256);

  const links = await page.evaluate(() => [...document.querySelectorAll('footer a')].map((a) => a.href));
  expect(links).toEqual([DEMO_META.url, 'https://en.wikipedia.org/w/index.php?title=Mary_Mallon&action=history',
    'https://creativecommons.org/licenses/by-sa/4.0/']);
  expect(await page.textContent('footer')).toContain(`revision ${DEMO_META.revision}`);

  await page.click('#open-tree'); // a trusted click: sidePanel.open needs the gesture
  const panel = await attachSidePanel(cdp, extensionId);
  await expect.poll(() => panel.text('#status')).toBe(MSG.demoTree(DEMO_META));
  expect(await panel.texts('.check')).toEqual(Array(NODES).fill(MSG.anchored));
});

// Why the demo page runs the page agent itself (src/panel/page-link.js): Chrome lets no extension
// script an extension page, a toolbar click (activeTab) included. Its URL it withholds through
// Chrome 153 and shows from 154, which the demo's openers pass on (src/demo/demo.js). If the
// scripting starts failing, the demo could be read like any other page.
test('Chrome constraint: an extension page cannot be scripted, even after the toolbar click', async ({ context, page, cdp, extensionId, serviceWorker }) => {
  await page.goto(demoUrl(extensionId));
  await clickToolbarIcon(cdp, extensionId, page);
  const result = await serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.title });
      return { url: tab.url ?? null, scripted: true };
    } catch (e) {
      return { url: tab.url ?? null, scripted: false, error: e.message };
    }
  });
  expect(result.scripted).toBe(false);
  expect(result.error).toMatch(/Cannot access/);
  // The URL: withheld through Chromium 153, shown from Chrome 154 (both measured), tied to the
  // browser's version so that a Playwright bump across that line shows up here, where the demo's
  // openers then take the other path (src/demo/demo.js).
  const major = Number(context.browser().version().split('.')[0]);
  expect(result.url).toBe(major >= 154 ? demoUrl(extensionId) : null);
});
