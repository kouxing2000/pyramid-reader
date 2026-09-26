// What the window shows, not what the panel document reports: headed, viewport null (the "headed"
// project in playwright.config.js), so a tab's page follows the window and an open side panel takes
// its width from the page. A tab's window.innerWidth against window.outerWidth then says whether a
// panel shows on it, the way a reader sees it. tabs.spec.js pins the same rules through the panel
// document's visibilityState, which is what Chrome reports and which a headless run can check.
import { test, expect } from './fixtures.js';
import { BUILT, configure, openArticle } from './setup.js';
import { sleep } from './side-panel.js';
import { ARTICLE_TREE } from '../fixtures/trees/article.js';

const TITLES = ARTICLE_TREE.branches.map((b) => b.title);
// The window's width the tab's page does not get: nothing with no panel beside it, the panel's
// width (a few hundred px) with one.
const taken = (page) => page.evaluate(() => outerWidth - innerWidth);
const PANEL = 200; // narrower than any side panel, wider than any scrollbar or rounding
// A tab is on screen. Said before any "no panel shows" claim, which a tab behind another would
// satisfy for nothing.
const onScreen = (page) => expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
// Chrome slides a side panel in over ~300 ms: a claim that none shows waits that out.
const SETTLE = 600;

test('a panel shows on the tab it was clicked on, on no other tab, and not once that tab leaves the page', async ({ context, page, server, cdp, extensionId, serviceWorker, provider }) => {
  await configure(serviceWorker, provider);
  provider.answer(JSON.stringify(ARTICLE_TREE));
  await page.goto(server.url('article.html?window-before'));
  await onScreen(page);
  expect(await taken(page)).toBeLessThan(PANEL); // no panel yet: the page has the window

  // The icon on A: the panel takes its width from A's page, and shows the tree built there.
  const panel = await openArticle({ page, server, cdp, extensionId }, 'window-a');
  await expect.poll(() => taken(page)).toBeGreaterThan(PANEL);
  await panel.click('#build');
  await expect.poll(() => panel.text('#status')).toMatch(BUILT);

  // B, never clicked, in front: the whole window is B's page.
  const other = await context.newPage();
  await other.goto(server.url('article.html?window-b'));
  await other.bringToFront();
  await onScreen(other);
  await sleep(SETTLE);
  expect(await taken(other)).toBeLessThan(PANEL);

  // A again: its panel, its tree.
  await page.bringToFront();
  await expect.poll(() => taken(page)).toBeGreaterThan(PANEL);
  expect(await panel.texts('.claim > .node > .title')).toEqual(TITLES);

  // A leaves its page: the panel goes, and A's page has the window.
  await page.goto(server.url('article.html?window-a-next'));
  await expect.poll(() => taken(page)).toBeLessThan(PANEL);
  await sleep(SETTLE);
  expect(await taken(page)).toBeLessThan(PANEL); // and stays so
  expect(provider.requests).toHaveLength(1);
});
