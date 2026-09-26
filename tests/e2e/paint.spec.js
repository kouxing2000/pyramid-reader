// The painted page: a whole tree is painted on its article (each claim's sentences in its colour,
// the verdict's in grey), and the page tells the panel what the reader
// points at, clicks and scrolls to. The page's DOM is never modified.
import { test, expect } from './fixtures.js';
import { BUILT, configure, openArticle } from './setup.js';
import { closePanel, openPanel } from './side-panel.js';
import { highlighted, painted } from './page-checks.js';
import { MSG } from '../../src/panel/messages.js';
import { ARTICLE_TREE, FLAWED_TREE } from '../fixtures/trees/article.js';

const [b0, b1, b2] = ARTICLE_TREE.branches;
// What ARTICLE_TREE paints: every node found on the page, the computed value (b2.1) excepted.
const PAINTED = {
  'pr-v': [ARTICLE_TREE.verdict_basis],
  'pr-c1': [b0.basis, b0.children[0].quote, b0.children[1].quote],
  'pr-c2': [b1.basis],
  'pr-c3': [b2.basis, b2.children[0].quote],
};

// A point inside the first line of a painted range, scrolled into view: `at` is how far along it.
const pointIn = (page, name, { range = 0, at = 0.5 } = {}) => page.evaluate(({ name, range, at }) => {
  const r = [...CSS.highlights.get(name)][range];
  r.startContainer.parentElement.scrollIntoView({ block: 'center' });
  const box = r.getClientRects()[0];
  return { x: box.left + box.width * at, y: box.top + box.height / 2 };
}, { name, range, at });
const withClass = (panel, cls) => panel.evaluate((c) => [...document.querySelectorAll(`#tree .${c}`)].map((e) => e.dataset.id), cls);

async function build({ page, server, cdp, extensionId, serviceWorker, provider }, tree, query) {
  await configure(serviceWorker, provider);
  provider.answer(JSON.stringify(tree));
  const panel = await openArticle({ page, server, cdp, extensionId }, query);
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  await panel.click('#build');
  await expect.poll(() => panel.text('#status')).toMatch(BUILT);
  return { panel, html };
}

test('a built tree is painted on its page, claim by claim, without DOM changes; Off and Focus change the paint', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  const { panel, html } = await build({ page, server, cdp, extensionId, serviceWorker, provider }, ARTICLE_TREE, 'paint');
  await expect.poll(() => painted(page)).toEqual(PAINTED);
  expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(html);
  // The article map marks each painted paragraph once, in its claim's colour.
  expect(await panel.evaluate(() => [...document.querySelectorAll('#map .tick')].map((t) => t.dataset.h))).toEqual(['v', 'c1', 'c2', 'c3']);

  const mode = (m) => panel.click(`#paint-mode [data-mode="${m}"]`);
  const stored = () => serviceWorker.evaluate(() => chrome.storage.local.get('paint').then((s) => s.paint));
  await mode('off');
  await expect.poll(() => painted(page)).toEqual({});
  expect(await panel.evaluate(() => document.getElementById('map').hidden)).toBe(true);
  expect(await stored()).toBe('off');

  // Focus paints the claim the reader picks, and nothing before that.
  await mode('focus');
  await expect.poll(stored).toBe('focus');
  expect(await painted(page)).toEqual({});
  await panel.click('.claim[data-id="b1"] .title');
  await expect.poll(() => painted(page)).toEqual({ 'pr-c2': PAINTED['pr-c2'] });

  await mode('all');
  await expect.poll(() => painted(page)).toEqual(PAINTED);
  expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(html);
});

test('the page tells the panel what the reader points at, clicks and scrolls to; a link in painted text is still a link', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  const { panel } = await build({ page, server, cdp, extensionId, serviceWorker, provider }, ARTICLE_TREE, 'watch');
  await expect.poll(() => painted(page)).toEqual(PAINTED);

  // Pointing at a claim's paint marks the claim in the panel.
  const b0Point = await pointIn(page, 'pr-c1');
  await page.mouse.move(b0Point.x, b0Point.y);
  await expect.poll(() => withClass(panel, 'pointed')).toEqual(['b0']);

  // A link inside b1's painted sentence follows its link and picks nothing, and a page script's
  // synthetic click is not the reader's. The pointer then moving onto b2 is the landmark that the
  // page's messages up to here have all arrived.
  const b1Word = await pointIn(page, 'pr-c2', { at: 0.02 });
  await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)
    .dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y, button: 0 })), b1Word);
  await page.click('a[href="#clinic"]');
  await expect(page).toHaveURL(/#clinic$/);
  const b2Point = await pointIn(page, 'pr-c3');
  await page.mouse.move(b2Point.x, b2Point.y);
  await expect.poll(() => withClass(panel, 'pointed')).toEqual(['b2']);
  expect(await withClass(panel, 'selected')).toEqual([]);
  expect(await withClass(panel, 'open')).toEqual([]);

  // A click on b1's painted text (its first word, not the link) picks b1: selected and opened.
  const b1Again = await pointIn(page, 'pr-c2', { at: 0.02 });
  await page.mouse.click(b1Again.x, b1Again.y);
  await expect.poll(() => withClass(panel, 'selected')).toEqual(['b1']);
  expect(await withClass(panel, 'open')).toEqual(['b1']);

  // Scrolling marks the claims whose sentences are on screen: here ¶6 (b1) and the next, not ¶3-¶4.
  await page.setViewportSize({ width: 1000, height: 240 });
  await page.evaluate(() => [...document.querySelectorAll('article p')].find((p) => p.textContent.startsWith('Residents'))
    .scrollIntoView({ block: 'start' }));
  // Everything was on screen before the scroll, so the change to wait for is b0 leaving.
  await expect.poll(() => withClass(panel, 'in-view')).not.toContain('b0');
  const inView = await withClass(panel, 'in-view');
  expect(inView).toContain('b1');
  expect(inView).not.toContain('verdict');
  expect(await panel.evaluate(() => document.querySelectorAll('#map .window').length)).toBe(1);
});

test('a claim not on the page has no paint on it', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await build({ page, server, cdp, extensionId, serviceWorker, provider }, FLAWED_TREE, 'paint-unanchored');
  // b1 is not on the page; b0 and b2 are.
  await expect.poll(() => painted(page).then((p) => Object.keys(p).sort())).toEqual(['pr-c1', 'pr-c3', 'pr-v']);
});

test('a tree is painted only when whole: not while it streams, not after Stop', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await configure(serviceWorker, provider);
  const text = JSON.stringify(ARTICLE_TREE);
  provider.answer(text, { holdAt: text.indexOf('"branches"') });
  const panel = await openArticle({ page, server, cdp, extensionId }, 'paint-stream');
  await panel.click('#build');
  await expect.poll(() => panel.text('.verdict .title')).toBe(ARTICLE_TREE.verdict);
  // Changing the paint mode mid-stream paints nothing. Showing a source afterwards is the landmark
  // that the page has heard every request made before it.
  await panel.click('#paint-mode [data-mode="off"]');
  await panel.click('#paint-mode [data-mode="all"]');
  await panel.click('.verdict .cite[data-n="3"]');
  await expect.poll(() => highlighted(page)).not.toBeNull();
  expect(await painted(page)).toEqual({});
  await panel.click('#stop');
  await expect.poll(() => panel.text('#status')).toBe(MSG.stopped);
  await panel.click('.verdict .cite[data-n="5"]');
  await expect.poll(() => highlighted(page)).toHaveLength(1);
  expect(await painted(page)).toEqual({});
  provider.release();
});

test('closing the panel clears its paint from the page', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await build({ page, server, cdp, extensionId, serviceWorker, provider }, ARTICLE_TREE, 'paint-close');
  await expect.poll(() => painted(page)).toEqual(PAINTED);
  await closePanel(cdp, extensionId, serviceWorker);
  await expect.poll(() => painted(page)).toEqual({});
});

test('the demo page is painted, and cleared when the panel closes, like any page', async ({ context, page, server, cdp, extensionId, serviceWorker }) => {
  const panel = await openPanel({ page, cdp, extensionId }, server.url('article.html?paint-demo'));
  await expect.poll(() => panel.evaluate(() => !document.getElementById('demo-offer').hidden)).toBe(true);
  const opened = context.waitForEvent('page');
  await panel.click('#open-demo');
  const demo = await opened;
  await demo.waitForURL(`chrome-extension://${extensionId}/demo/demo.html`);
  await expect.poll(() => painted(demo).then((p) => Object.keys(p).length)).toBeGreaterThan(0);
  await closePanel(cdp, extensionId, serviceWorker); // the demo tab's own panel, the one in front
  await expect.poll(() => painted(demo)).toEqual({});
});
