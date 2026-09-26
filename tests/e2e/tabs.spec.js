// A panel belongs to the page it was clicked open on (docs/DESIGN.md "One panel per tab"): the
// toolbar icon opens the tab's own panel, which Chrome shows only while that tab is in front, and
// which closes when the tab leaves the page, on the URL alone: the next page is read only from its
// own icon click. A reload or a # change keeps it; a pushState to another URL is leaving too. The
// demo page follows the URL rule where Chrome shows its URL (154) and is asked itself once its tab
// has loaded where Chrome withholds it (153).
import { test, expect } from './fixtures.js';
import { BUILT, configure, MODEL, openArticle, readings, savedStatus } from './setup.js';
import { attachSidePanel, clickToolbarIcon, panelCount, sleep } from './side-panel.js';
import { panelPath } from '../../src/lib/tab-panel.js';
import { MSG } from '../../src/panel/messages.js';
import { ARTICLE_TREE } from '../fixtures/trees/article.js';
import { DEMO_META } from '../../src/demo/demo-tree.js';

const TEXT = JSON.stringify(ARTICLE_TREE);
const TITLES = ARTICLE_TREE.branches.map((b) => b.title);
const titles = (panel) => panel.texts('.claim > .node > .title');
const visibility = (panel) => panel.evaluate(() => document.visibilityState);
const savedEntries = (serviceWorker) => serviceWorker.evaluate(async () =>
  Object.entries(await chrome.storage.local.get(null)).filter(([k]) => k.startsWith('tree:')).map(([, v]) => v));
// The page's reading count once no read is in flight: a read is milliseconds, so half a second is
// past any the last event set off.
const settledReadings = async (serviceWorker) => { await sleep(500); return readings(serviceWorker); };

// Builds ARTICLE_TREE on article.html?<query> and returns the panel and the saved-tree status line.
async function built({ page, server, cdp, extensionId, serviceWorker, provider }, query) {
  await configure(serviceWorker, provider);
  provider.answer(TEXT);
  const panel = await openArticle({ page, server, cdp, extensionId }, query);
  await panel.click('#build');
  await expect.poll(() => panel.text('#status')).toMatch(BUILT);
  const [entry] = await savedEntries(serviceWorker);
  return { panel, saved: await savedStatus(panel, MODEL, entry.savedAt) };
}

test('each tab has its own panel: a second tab opens a second one, the first keeps its tree behind, a tab never clicked has none', async ({ context, page, server, cdp, extensionId, serviceWorker, provider }) => {
  const { panel: first } = await built({ page, server, cdp, extensionId, serviceWorker, provider }, 'tabs-first');

  // A second tab, never clicked: no panel of its own; the first's is hidden with its tab, kept.
  const second = await context.newPage();
  await second.goto(server.url('article.html?tabs-second'));
  await second.bringToFront();
  await expect.poll(() => visibility(first)).toBe('hidden');
  expect(await panelCount(cdp, extensionId)).toBe(1);
  expect(await titles(first)).toEqual(TITLES);

  // The icon on the second tab: its own panel, on its own page, with nothing drawn.
  await clickToolbarIcon(cdp, extensionId, second);
  const other = await attachSidePanel(cdp, extensionId);
  expect(other.targetId).not.toBe(first.targetId);
  await expect.poll(() => other.text('#status')).toBe(MSG.buildThisPage);
  expect(await titles(other)).toEqual([]);
  expect(await panelCount(cdp, extensionId)).toBe(2);

  // Back to the first tab: the same panel, the same tree.
  await page.bringToFront();
  await expect.poll(() => visibility(first)).toBe('visible');
  expect(await titles(first)).toEqual(TITLES);
  expect(provider.requests).toHaveLength(1);
});

test('a navigation closes the panel; the next page is read only from its own icon click, which finds its saved tree; a reload keeps it and redraws', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  const { saved } = await built({ page, server, cdp, extensionId, serviceWorker, provider }, 'nav-a');

  // A page with no tree: the panel goes, and the page is not read until its icon is clicked.
  await page.goto(server.url('article.html?nav-b'));
  await expect.poll(() => panelCount(cdp, extensionId)).toBe(0);
  expect(await settledReadings(serviceWorker)).toBe(0);
  await clickToolbarIcon(cdp, extensionId, page);
  const next = await attachSidePanel(cdp, extensionId);
  await expect.poll(() => next.text('#status')).toBe(MSG.buildThisPage);
  expect(await titles(next)).toEqual([]);
  expect(await next.text('#source')).toBe('The Ledger of Small Bridges');
  expect(await next.evaluate(() => document.getElementById('rebuild').hidden)).toBe(true);

  // Back to the page with a tree: its own click, then the tree from the store, no request.
  await page.goto(server.url('article.html?nav-a'));
  await expect.poll(() => panelCount(cdp, extensionId)).toBe(0);
  await clickToolbarIcon(cdp, extensionId, page);
  const again = await attachSidePanel(cdp, extensionId);
  await expect.poll(() => again.text('#status')).toBe(saved);
  expect(await titles(again)).toEqual(TITLES);

  // A reload is the same page, a new document: the panel stays and draws the tree for it again.
  await again.evaluate(() => { document.querySelector('.verdict').dataset.before = 'reload'; });
  await page.reload();
  await expect.poll(() => again.evaluate(() => document.querySelector('.verdict')?.dataset.before ?? 'redrawn')).toBe('redrawn');
  await expect.poll(() => again.text('#status')).toBe(saved);
  expect(await titles(again)).toEqual(TITLES);
  expect(await panelCount(cdp, extensionId)).toBe(1);
  expect(provider.requests).toHaveLength(1);
});

test('a # change keeps the tree on screen; a pushState to another URL is leaving, and reads nothing', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  const { panel } = await built({ page, server, cdp, extensionId, serviceWorker, provider }, 'nav-same');
  const before = await settledReadings(serviceWorker);

  // Chrome reports a # change like a navigation (tabs.onUpdated: loading, complete); the panel
  // reads the page, finds the document on screen, and leaves it.
  await page.evaluate(() => { location.hash = 'h'; });
  await expect.poll(() => readings(serviceWorker)).toBeGreaterThanOrEqual(before + 1);
  expect(await panel.text('#status')).toMatch(BUILT);
  expect(await titles(panel)).toEqual(TITLES);
  expect(await panelCount(cdp, extensionId)).toBe(1);

  // The same document at another path: the panel closes on the URL alone, with no read.
  const read = await settledReadings(serviceWorker);
  await page.evaluate(() => history.pushState({}, '', '/text.html?nav-same-pushed'));
  await expect.poll(() => panelCount(cdp, extensionId)).toBe(0);
  expect(await settledReadings(serviceWorker)).toBe(read);
  expect(provider.requests).toHaveLength(1);
});

test('a cross-origin navigation closes the panel too: Chrome withholds the URL, and the new page gets one from its own click', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await built({ page, server, cdp, extensionId, serviceWorker, provider }, 'nav-cross');

  // localhost is another origin than 127.0.0.1: Chrome revokes the click's access on the way and
  // hides the tab's URL from the panel, which is enough to know the tab left.
  await page.goto(server.url('article.html?nav-cross-other').replace('127.0.0.1', 'localhost'));
  await expect.poll(() => panelCount(cdp, extensionId)).toBe(0);
  await expect(page.locator('h1')).toHaveText('The Ledger of Small Bridges');
  await clickToolbarIcon(cdp, extensionId, page);
  const next = await attachSidePanel(cdp, extensionId);
  await expect.poll(() => next.text('#status')).toBe(MSG.buildThisPage);
  expect(await next.text('#source')).toBe('The Ledger of Small Bridges');
  expect(provider.requests).toHaveLength(1);
});

test('a navigation during a build stops it and closes the panel; nothing is saved', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await configure(serviceWorker, provider);
  provider.answer(TEXT, { holdAt: TEXT.indexOf('"branches"') });
  const panel = await openArticle({ page, server, cdp, extensionId }, 'nav-mid');
  await panel.click('#build');
  await expect.poll(() => panel.text('.verdict .title')).toBe(ARTICLE_TREE.verdict);

  await page.goto(server.url('article.html?nav-mid-next'));
  await expect.poll(() => panelCount(cdp, extensionId)).toBe(0);
  // Chrome drops the request's socket a few seconds after the document is gone.
  await expect.poll(() => provider.requests[0].closed, { timeout: 15_000 }).toBe(true);
  provider.release();
  expect(await savedEntries(serviceWorker)).toEqual([]);
  expect(await settledReadings(serviceWorker)).toBe(0);
});

test('a reload during a build lets it finish and save; the reloaded page then shows its tree', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await configure(serviceWorker, provider);
  provider.answer(TEXT, { holdAt: TEXT.indexOf('"branches"') });
  const panel = await openArticle({ page, server, cdp, extensionId }, 'reload-mid');
  await panel.click('#build');
  await expect.poll(() => panel.text('.verdict .title')).toBe(ARTICLE_TREE.verdict);

  await page.reload();
  await expect(page.locator('h1')).toHaveText('The Ledger of Small Bridges');
  expect(await panel.text('#status')).toBe(MSG.asking(MODEL)); // still streaming, still shown
  provider.release();
  await expect.poll(() => savedEntries(serviceWorker)).toHaveLength(1);
  const [entry] = await savedEntries(serviceWorker);
  expect(entry.tree).toEqual(ARTICLE_TREE);
  await expect.poll(() => panel.text('#status')).toBe(await savedStatus(panel, MODEL, entry.savedAt)); // the reloaded document, entered
  expect(await titles(panel)).toEqual(TITLES);
  expect(await panelCount(cdp, extensionId)).toBe(1);
});

test('the demo tab: a reload keeps its panel and redraws; leaving the demo closes it', async ({ page, server, cdp, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/demo/demo.html`);
  await page.click('#open-tree'); // a trusted click: sidePanel.open needs the gesture
  const panel = await attachSidePanel(cdp, extensionId);
  await expect.poll(() => panel.text('#status')).toBe(MSG.demoTree(DEMO_META));

  await panel.evaluate(() => { document.querySelector('.verdict').dataset.before = 'reload'; });
  await page.reload();
  await expect.poll(() => panel.evaluate(() => document.querySelector('.verdict')?.dataset.before ?? 'redrawn')).toBe('redrawn');
  await expect.poll(() => panel.text('#status')).toBe(MSG.demoTree(DEMO_META));
  expect(await panelCount(cdp, extensionId)).toBe(1);

  // Where Chrome withholds the demo tab's URL (153) the panel asks the demo once the new page has
  // loaded, and closes on silence; where it shows it (154) the URL rule closes it as the tab
  // leaves. Either way the panel goes, and the page's own click opens its own.
  await page.goto(server.url('article.html?from-demo'));
  await expect.poll(() => panelCount(cdp, extensionId)).toBe(0);
  await clickToolbarIcon(cdp, extensionId, page);
  const next = await attachSidePanel(cdp, extensionId);
  await expect.poll(() => next.text('#status')).toBe(MSG.buildThisPage);
  expect(await next.text('#source')).toBe('The Ledger of Small Bridges');
});

// Why a click on another page in the same tab gives that page a panel of its own (only a tab whose
// panel was opened where Chrome shows no URL can still be on one): Chrome loads the panel afresh
// when its path changes (src/lib/tab-panel.js), and leaves it when the path is the same, which is
// what lets a click resume a waiting Build. If this starts failing, the old panel would read the
// clicked page and close at that page's load's end.
test('Chrome constraint: a new path on an open panel loads it afresh, the same path leaves it', async ({ page, server, cdp, extensionId, serviceWorker }) => {
  const panel = await openArticle({ page, server, cdp, extensionId }, 'path-a');
  await expect.poll(() => panel.text('#status')).toBe(MSG.buildThisPage);
  const tabId = await serviceWorker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  const setPath = (path) => serviceWorker.evaluate((o) => chrome.sidePanel.setOptions({ ...o, enabled: true }), { tabId, path });

  const other = server.url('article.html?path-b');
  await setPath(panelPath(tabId, other));
  await expect.poll(async () => (await attachSidePanel(cdp, extensionId)).evaluate(() => new URLSearchParams(location.search).get('page'))).toBe(other);
  expect(await panelCount(cdp, extensionId)).toBe(1);

  const fresh = await attachSidePanel(cdp, extensionId);
  await fresh.evaluate(() => { document.body.dataset.mark = 'kept'; });
  await setPath(panelPath(tabId, other));
  await sleep(500);
  expect(await fresh.evaluate(() => document.body.dataset.mark)).toBe('kept');
});

test('closing the tab closes its panel', async ({ context, page, server, cdp, extensionId }) => {
  const panel = await openArticle({ page, server, cdp, extensionId }, 'tabs-close');
  await expect.poll(() => panel.text('#status')).toBe(MSG.buildThisPage);
  const second = await context.newPage(); // keeps the window open
  await second.goto(server.url('article.html?tabs-close-other'));
  expect(await panelCount(cdp, extensionId)).toBe(1);

  await page.close();
  await expect.poll(() => panelCount(cdp, extensionId)).toBe(0);
});
