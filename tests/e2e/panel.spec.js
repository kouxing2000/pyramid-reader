// Chrome's real side panel, opened by a toolbar-icon click on a fixture page, before any provider
// is set up: Build lists the page's visible paragraphs; clicking one scrolls the page to it and
// highlights it. Page access comes from the toolbar click only: a page the click cannot open up
// asks for it once and is then reported unreadable.
import { test, expect } from './fixtures.js';
import { MSG } from '../../src/panel/messages.js';
import { attachSidePanel, clickToolbarIcon, openPanel } from './side-panel.js';
import { colorShare, highlighted } from './page-checks.js';
import { ARTICLE_PARAGRAPHS } from '../fixtures/trees/article.js';

const HIGHLIGHT_RGB = [0xff, 0xd5, 0x4f]; // src/content/page.js HIGHLIGHT_CSS
// Share of the last paragraph's first line painted in the highlight colour.
const highlightPainted = async (page) => {
  const r = await page.evaluate(() => {
    const b = [...document.querySelectorAll('main > article p')].at(-1).getBoundingClientRect();
    return { x: b.left + scrollX, y: b.top + scrollY + 4, width: Math.min(b.width, 400), height: 16 };
  });
  return colorShare(await page.screenshot({ clip: r, fullPage: true }), HIGHLIGHT_RGB);
};

test('Build lists the visible paragraphs; clicking one scrolls to it and highlights it', async ({ page, server, cdp, extensionId }) => {
  const panel = await openPanel({ page, cdp, extensionId }, server.url('article.html'));
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  await panel.click('#build');

  await expect.poll(() => panel.texts('.para .text')).toHaveLength(ARTICLE_PARAGRAPHS);
  const texts = await panel.texts('.para .text');
  expect(texts[2]).toBe('The county surveyed all 214 of its footbridges last spring and found that 61 needed repairs within five years.');
  expect(texts.some((t) => t.includes('paywall'))).toBe(false);
  expect(await panel.texts('#paragraphs h2')).toEqual(['What the survey found', 'Why it matters', 'What happens next']);
  expect(await panel.text('#status')).toBe(MSG.needsSettings);
  expect(await panel.text('#page-note')).toBe('9 paragraphs · skipped 1 behind an overlay');
  expect(await panel.text('#source')).toBe('The Ledger of Small Bridges');

  const last = await page.evaluate(() => [...document.querySelectorAll('main > article p')].at(-1).getBoundingClientRect().top);
  expect(last).toBeGreaterThan(await page.evaluate(() => innerHeight)); // below the fold

  expect(await highlightPainted(page)).toBe(0);
  await panel.click(`.para[data-n="${ARTICLE_PARAGRAPHS}"]`);
  await expect.poll(() => highlighted(page)).toEqual([texts.at(-1)]);
  // Registered is not painted: the highlight colour must be on screen behind the text.
  await expect.poll(() => highlightPainted(page)).toBeGreaterThan(0.3);
  await expect.poll(() => page.evaluate(() => {
    const r = [...document.querySelectorAll('main > article p')].at(-1).getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight;
  })).toBe(true);
  expect(await panel.evaluate(() => document.querySelector('.para[aria-current="true"]')?.dataset.n)).toBe('9');
  // The highlight lives in CSS.highlights and an extension stylesheet: the page's DOM is untouched.
  expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(html);
});

test('a page the toolbar click cannot open up (chrome://) is reported unreadable, not asked for again', async ({ page, cdp, extensionId }) => {
  const panel = await openPanel({ page, cdp, extensionId }, 'chrome://version/');
  await panel.click('#build');
  await expect.poll(() => panel.text('#status')).toBe(MSG.needsClick);
  await clickToolbarIcon(cdp, extensionId, page);
  await expect.poll(() => panel.text('#status')).toMatch(new RegExp(`^${MSG.unreadable('')}`));
});

test('clicking a paragraph the page has since changed clears the old highlight and says so', async ({ page, server, cdp, extensionId }) => {
  const panel = await openPanel({ page, cdp, extensionId }, server.url('article.html?stale'));
  await panel.click('#build');
  await expect.poll(() => panel.texts('.para')).toHaveLength(ARTICLE_PARAGRAPHS);
  await panel.click('.para[data-n="1"]');
  await expect.poll(() => highlighted(page)).toHaveLength(1);

  await page.evaluate(() => document.querySelectorAll('main > article p')[2].remove()); // paragraph 3
  await panel.click('.para[data-n="3"]');
  await expect.poll(() => panel.text('#status')).toBe(MSG.pageChanged);
  await expect.poll(() => highlighted(page)).toBeNull();
});

// Why background.js opens the panel from action.onClicked: with openPanelOnActionClick Chrome
// opens the panel from the toolbar click without granting activeTab (Chromium's
// ExtensionActionRunner::RunAction returns before GrantTabPermissions when the action opens a
// side panel). If this starts failing, Chrome grants it now and background.js can simplify. The
// tab's panel is set up here as background.js would on the click, which now opens it instead.
test('Chrome constraint: openPanelOnActionClick opens the panel without page access', async ({ page, server, cdp, extensionId, serviceWorker }) => {
  await page.goto(server.url('article.html?behavior=panel'));
  await serviceWorker.evaluate(async () => {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await chrome.sidePanel.setOptions({ tabId: tab.id, path: `panel/panel.html?tab=${tab.id}`, enabled: true });
  });
  await clickToolbarIcon(cdp, extensionId, page);
  const panel = await attachSidePanel(cdp, extensionId);
  await panel.click('#build');
  await expect.poll(() => panel.text('#status')).toBe(MSG.needsClick);
});
