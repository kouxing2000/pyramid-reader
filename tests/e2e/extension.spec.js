import { test, expect } from './fixtures.js';
import { clickToolbarIcon, openSidePanels, panelCount } from './side-panel.js';

const panelUrl = (id) => `chrome-extension://${id}/panel/panel.html`;

test('the unpacked extension loads and its service worker registers', async ({ extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
});

test('the panel page renders without errors', async ({ page, extensionId }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(panelUrl(extensionId));

  await expect(page).toHaveTitle('Pyramid Reader');
  await expect(page.getByRole('button', { name: 'Build tree' })).toBeVisible();
  await expect(page.locator('#settings > summary')).toBeVisible();
  // No brand of its own: Chrome's side panel header already names the extension.
  await expect(page.locator('header')).not.toContainText('Pyramid Reader', { useInnerText: true }); // what shows
  expect(errors).toEqual([]);
});

test('the toolbar icon opens the panel page in Chrome\'s side panel', async ({ page, server, cdp, extensionId }) => {
  await page.goto(server.url('article.html'));
  expect(await openSidePanels(cdp, extensionId)).toEqual([]);

  await clickToolbarIcon(cdp, extensionId, page);

  await expect.poll(() => panelCount(cdp, extensionId)).toBe(1);
});
