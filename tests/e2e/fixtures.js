// Playwright fixtures that load src/ as an unpacked MV3 extension and serve the HTML fixtures.
//
// Extensions need a persistent context and the full Chromium build (channel 'chromium'): the
// default headless shell cannot load them. `--headed` / `--debug` show the browser.
// PR_CHROME=<path to a Chromium or Chrome for Testing executable> runs the suite on that build
// instead, for a bug seen in one version and not another. Not branded Chrome: from 137 it ignores
// --load-extension, and the service worker never registers.

import { test as base, chromium, expect } from '@playwright/test';
import { startMockProvider } from './mock-provider.js';
import { forgetPanels, panelLogs } from './side-panel.js';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(HERE, '../../src');
const PAGES = path.resolve(HERE, '../fixtures/pages');

export const test = base.extend({
  // tests/fixtures/pages over http: an unpacked extension gets no file:// access by default.
  // `server.url('article.html')` -> http://127.0.0.1:<port>/article.html
  server: [async ({}, use) => {
    const srv = http.createServer((req, res) => {
      const file = path.join(PAGES, path.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)));
      if (!file.startsWith(PAGES + path.sep)) return res.writeHead(403).end();
      fs.readFile(file, (err, data) => {
        if (err) return res.writeHead(404).end();
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(data);
      });
    });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    await use({ url: (p) => `http://127.0.0.1:${srv.address().port}/${p}` });
    await new Promise((ok) => srv.close(ok));
  }, { scope: 'worker' }],

  // A fresh profile per test, so storage never leaks between tests. viewport is the project's
  // (playwright.config.js): null in the headed project, so the page follows the window.
  context: async ({ headless, viewport }, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      ...(process.env.PR_CHROME ? { executablePath: process.env.PR_CHROME } : { channel: 'chromium' }),
      headless,
      viewport,
      // --enable-unsafe-extension-debugging lets CDP click the toolbar icon (side-panel.js).
      args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`,
        '--enable-unsafe-extension-debugging',
        // The browser's languages: English only, so the English fixtures offer no second language
        // unless a test gives the panel others (setup.js withTranslator).
        '--lang=en-US'],
    });
    await use(context);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  },

  // Our service worker: a registered worker proves Chrome accepted the manifest and ran
  // background.js. Chrome rejects a bad manifest silently (e.g. a side_panel path that
  // does not exist), so name that cause instead of letting the test die on a bare timeout.
  serviceWorker: async ({ context }, use) => {
    const ours = (w) => w.url().endsWith('/background.js');
    let worker = context.serviceWorkers().find(ours);
    if (!worker) {
      worker = await context.waitForEvent('serviceworker', { predicate: ours, timeout: 15_000 }).catch((e) => {
        throw new Error(`extension did not load from ${EXT_PATH}: no service worker registered. ` +
          'Chrome rejected the manifest or background.js failed; run `npm run test:headed` ' +
          `and check chrome://extensions for the error. (${e.message.split('\n')[0]})`);
      });
    }
    // Chrome drops a toolbar click that lands before background.js has registered its
    // listener, which a test can do within ~100ms of launching a fresh profile.
    await expect.poll(() => worker.evaluate(() => chrome.action.onClicked.hasListeners())).toBe(true);
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },

  // A browser-level CDP session, for the toolbar icon and the side panel (side-panel.js).
  cdp: async ({ context }, use) => {
    await use(await context.browser().newBrowserCDPSession());
  },

  // A mock OpenAI-compatible endpoint (mock-provider.js), fresh per test.
  provider: async ({}, use) => {
    const provider = await startMockProvider();
    await use(provider);
    await provider.close();
  },

  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()));
  },

  // A failed test prints what its side panels did (side-panel.js recordPanel). It depends on the
  // context so that it runs while the panels are still open.
  panelLog: [async ({ context }, use, testInfo) => {
    forgetPanels();
    await use();
    if (testInfo.status !== testInfo.expectedStatus) console.error(`side panel log:\n${await panelLogs()}`);
  }, { auto: true }],
});

export { expect };
