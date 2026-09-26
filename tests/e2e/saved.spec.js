// Trees are kept on this machine per URL and page text (SPEC §5.1): reopening the page shows its
// tree at once, with no request; Rebuild asks the provider again; changed text is a new page.
import { test, expect } from './fixtures.js';
import { BUILT, configure, MODEL, openArticle, readings, savedStatus } from './setup.js';
import { attachSidePanel, clickToolbarIcon, closePanel, panelCount } from './side-panel.js';
import { highlighted } from './page-checks.js';
import { MSG } from '../../src/panel/messages.js';
import { ARTICLE_TREE } from '../fixtures/trees/article.js';

const TEXT = JSON.stringify(ARTICLE_TREE);
const savedTrees = (serviceWorker) => serviceWorker.evaluate(async () =>
  Object.entries(await chrome.storage.local.get(null)).filter(([k]) => k.startsWith('tree:')).map(([, v]) => v));

test('a built tree is saved; reopening the panel on the page shows it at once, with no request; Rebuild asks again', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await configure(serviceWorker, provider);
  provider.answer(TEXT);
  const panel = await openArticle({ page, server, cdp, extensionId }, 'saved');
  await panel.click('#build');
  await expect.poll(() => panel.text('#status')).toMatch(BUILT);
  expect(await panel.evaluate(() => document.getElementById('rebuild').hidden)).toBe(false);
  const [entry] = await savedTrees(serviceWorker);
  expect(entry).toMatchObject({ url: page.url(), model: MODEL, label: 'OpenAI-compatible', tree: ARTICLE_TREE });

  // Close the panel and open it again from the toolbar: a fresh panel, which finds the saved tree.
  await closePanel(cdp, extensionId, serviceWorker);
  await page.reload();
  await clickToolbarIcon(cdp, extensionId, page);
  const reopened = await attachSidePanel(cdp, extensionId);
  const status = await savedStatus(reopened, MODEL, entry.savedAt);
  await expect.poll(() => reopened.text('#status')).toBe(status);
  expect(await reopened.texts('.claim > .node > .title')).toEqual(ARTICLE_TREE.branches.map((b) => b.title));
  expect(await reopened.texts('.check')).toEqual(Array(7).fill(MSG.anchored));
  expect(provider.requests).toHaveLength(1);
  // Its anchors work on the reloaded page.
  await reopened.click('.claim[data-id="b2"] .title');
  await expect.poll(() => highlighted(page)).toEqual([ARTICLE_TREE.branches[2].basis]);

  // Build shows the saved tree too; Rebuild asks the provider and saves the new answer.
  await reopened.click('#build');
  await expect.poll(() => reopened.text('#status')).toBe(status);
  expect(provider.requests).toHaveLength(1);
  const rebuilt = structuredClone(ARTICLE_TREE);
  rebuilt.branches.reverse();
  provider.answer(JSON.stringify(rebuilt));
  await reopened.click('#rebuild');
  await expect.poll(() => reopened.text('#status')).toMatch(BUILT);
  expect(provider.requests).toHaveLength(2);
  expect(await reopened.texts('.claim > .node > .title')).toEqual(rebuilt.branches.map((b) => b.title));
  expect((await savedTrees(serviceWorker)).map((e) => e.tree)).toEqual([rebuilt]);
});

test('a page whose text changed, or another URL, has no saved tree; a saved tree that no longer validates is dropped', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await configure(serviceWorker, provider);
  provider.answer(TEXT);
  const panel = await openArticle({ page, server, cdp, extensionId }, 'changed');
  await panel.click('#build');
  await expect.poll(() => panel.text('#status')).toMatch(BUILT);

  await page.evaluate(() => { document.querySelector('article p:last-of-type').append(' Updated.'); });
  provider.answer(TEXT);
  await panel.click('#build');
  await expect.poll(() => provider.requests.length).toBe(2);
  await expect.poll(() => panel.text('#status')).toMatch(BUILT);
  expect(await savedTrees(serviceWorker)).toHaveLength(2);

  // Another URL with the same text is another page: the panel closes, and the page's own click
  // opens one with nothing drawn until Build.
  await page.goto(server.url('article.html?changed-elsewhere'));
  await expect.poll(() => panelCount(cdp, extensionId)).toBe(0);
  await clickToolbarIcon(cdp, extensionId, page);
  const other = await attachSidePanel(cdp, extensionId);
  await expect.poll(() => other.text('#status')).toBe(MSG.buildThisPage);
  expect(await other.texts('#tree *')).toEqual([]);
  provider.answer(TEXT);
  await other.click('#build');
  await expect.poll(() => provider.requests.length).toBe(3);
  await expect.poll(() => other.text('#status')).toMatch(BUILT);
  expect(await savedTrees(serviceWorker)).toHaveLength(3);

  // A saved tree the validator now rejects (stored by an older version) is rebuilt and replaced.
  await serviceWorker.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    for (const [k, v] of Object.entries(all)) if (k.startsWith('tree:')) await chrome.storage.local.set({ [k]: { ...v, tree: { ...v.tree, branches: [] } } });
  });
  provider.answer(TEXT);
  await other.click('#build');
  await expect.poll(() => provider.requests.length).toBe(4);
  await expect.poll(() => other.text('#status')).toMatch(BUILT);
  expect((await savedTrees(serviceWorker)).filter((e) => e.tree.branches.length === 3)).toHaveLength(1);
});

test('a tree saved before trees named their language is built afresh, so it can be read in the reader\'s', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await configure(serviceWorker, provider);
  provider.answer(TEXT);
  const panel = await openArticle({ page, server, cdp, extensionId }, 'no-lang');
  await panel.click('#build');
  await expect.poll(() => panel.text('#status')).toMatch(BUILT);
  await serviceWorker.evaluate(async () => {
    for (const [k, v] of Object.entries(await chrome.storage.local.get(null))) {
      if (k.startsWith('tree:')) { const { lang, ...tree } = v.tree; await chrome.storage.local.set({ [k]: { ...v, tree } }); }
    }
  });
  provider.answer(TEXT);
  await panel.click('#build');
  await expect.poll(() => provider.requests.length).toBe(2);
  await expect.poll(() => panel.text('#status')).toMatch(BUILT);
  expect((await savedTrees(serviceWorker)).map((e) => e.tree.lang)).toEqual(['en']);
});

test('opening the panel never builds: a saved tree that no longer validates is dropped, and the page is entered with nothing drawn or sent', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await configure(serviceWorker, provider);
  provider.answer(TEXT);
  const panel = await openArticle({ page, server, cdp, extensionId }, 'peek-invalid');
  await panel.click('#build');
  await expect.poll(() => panel.text('#status')).toMatch(BUILT);
  await serviceWorker.evaluate(async () => {
    for (const [k, v] of Object.entries(await chrome.storage.local.get(null))) {
      if (k.startsWith('tree:')) await chrome.storage.local.set({ [k]: { ...v, tree: { ...v.tree, kind: 'essay' } } });
    }
  });

  await closePanel(cdp, extensionId, serviceWorker);
  await clickToolbarIcon(cdp, extensionId, page);
  const reopened = await attachSidePanel(cdp, extensionId);
  await expect.poll(() => savedTrees(serviceWorker)).toEqual([]); // the peek ran, and dropped it
  await expect.poll(() => reopened.text('#status')).toBe(MSG.buildThisPage); // and entered the page
  expect(await reopened.text('#source')).toBe('The Ledger of Small Bridges');
  expect(await reopened.texts('#tree *')).toEqual([]);
  expect(provider.requests).toHaveLength(1);
});

test('reading a changed page again leaves the tree on screen pointing at the text it was built from', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await configure(serviceWorker, provider);
  provider.answer(TEXT);
  const panel = await openArticle({ page, server, cdp, extensionId }, 'renumbered');
  await expect.poll(() => readings(serviceWorker)).toBe(1); // the panel's peek as it opened
  await panel.click('#build');
  await expect.poll(() => panel.text('#status')).toMatch(BUILT);
  expect(await readings(serviceWorker)).toBe(2); // then Build

  // A paragraph appears above the rest (a live page); the toolbar click reads the page again,
  // finds no tree saved for its new text, and leaves the screen as it is.
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.textContent = 'An update posted above the story, which renumbers every paragraph after it.';
    document.querySelector('article header').after(p);
  });
  await clickToolbarIcon(cdp, extensionId, page);
  await expect.poll(() => readings(serviceWorker)).toBe(3);
  expect(await panel.text('#status')).toMatch(BUILT);

  await panel.click('.claim[data-id="b0"] .fold');
  await panel.click('.evidence[data-id="b0.1"] .quote');
  await expect.poll(() => highlighted(page)).toEqual(['timber decks rot faster than anyone budgets for']);
  expect(provider.requests).toHaveLength(1);
});
