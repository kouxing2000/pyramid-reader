// SPEC §9.4: the extension makes no network request except to the configured provider (§4.4: no
// article text, tree or key goes anywhere else). Every request the side panel (from its start-up
// on) and the service worker make is recorded through CDP, and every request the pages make
// through Playwright, while the panel builds, shows sources, reopens a saved tree and
// rebuilds; and while the demo runs with no provider at all. The extension's own files
// (chrome-extension://<id>/) are not network requests.
import { test, expect } from './fixtures.js';
import { attachSidePanel, attachTarget, openPanel } from './side-panel.js';
import { BUILT, configure, openArticle } from './setup.js';
import { MSG } from '../../src/panel/messages.js';
import { DEMO_META } from '../../src/demo/demo-tree.js';
import { ARTICLE_TREE, FLAWED_TREE } from '../fixtures/trees/article.js';

// Records the requests of the panel and the service worker (CDP Network), and of the given pages.
// The panel is reloaded once recording, so its start-up (settings, the peek) is recorded too. Each
// recorder is shown to hear: the panel's reload fetches its own files, and the worker is made to
// fetch one.
async function recordRequests({ cdp, extensionId, panel, serviceWorker, pages }) {
  const seen = [];
  const { targetInfos } = await cdp.send('Target.getTargets');
  const worker = targetInfos.find((t) => t.type === 'service_worker' && t.url === `chrome-extension://${extensionId}/background.js`);
  for (const [who, session] of [['panel', panel], ['worker', await attachTarget(cdp, worker.targetId)]]) {
    session.on('Network.requestWillBeSent', ({ request }) => seen.push({ who, method: request.method, url: request.url }));
    await session.send('Network.enable');
  }
  for (const page of pages) page.on('request', (r) => seen.push({ who: 'page', method: r.method(), url: r.url() }));
  const own = (who, file) => seen.some((r) => r.who === who && r.url === `chrome-extension://${extensionId}/${file}`);
  await serviceWorker.evaluate(() => fetch(chrome.runtime.getURL('manifest.json')));
  await panel.send('Page.reload');
  await expect.poll(() => own('worker', 'manifest.json') && own('panel', 'panel/panel.js')).toBe(true);
  await expect.poll(() => panel.evaluate(() => document.readyState === 'complete' && document.getElementById('provider').options.length > 0)).toBe(true);
  return {
    all: seen,
    // What left the machine: everything but the extension's own files.
    network: () => seen.filter((r) => !r.url.startsWith(`chrome-extension://${extensionId}/`)),
  };
}

test('a build, its checks, a saved tree, a Rebuild and Settings request nothing but the configured provider', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await configure(serviceWorker, provider);
  const panel = await openArticle({ page, server, cdp, extensionId }, 'network');
  const requests = await recordRequests({ cdp, extensionId, panel, serviceWorker, pages: [page] });

  provider.answer(JSON.stringify(FLAWED_TREE));
  await panel.click('#build');
  await expect.poll(() => panel.text('#status')).toMatch(BUILT);
  await panel.click('.expand-all');
  await panel.click('.evidence[data-id="b2.0"] .quote');
  await panel.click('.claim[data-id="b0"] .cite');
  await panel.click('#build'); // the saved tree
  await expect.poll(() => panel.text('#status')).toMatch(/^Saved tree/);
  provider.answer(JSON.stringify(ARTICLE_TREE));
  await panel.click('#rebuild');
  await expect.poll(() => panel.text('#status')).toMatch(BUILT);
  await panel.click('#settings summary'); // which asks the provider about the model
  await expect.poll(() => panel.text('#model-check')).toBe(MSG.modelValid);

  // The recorder saw the calls it should (so it was listening): build, rebuild, and Settings'
  // model check...
  const calls = requests.network().filter((r) => r.method === 'POST');
  expect(calls).toEqual(Array(2).fill({ who: 'panel', method: 'POST', url: `${provider.baseUrl}/chat/completions` }));
  expect(requests.network().filter((r) => r.method === 'GET')).toEqual([{ who: 'panel', method: 'GET', url: `${provider.baseUrl}/models` }]);
  expect(provider.requests.map((r) => r.body.model)).toEqual(['mock-model', 'mock-model']);
  // The panel's own URL names the page it reads (src/lib/tab-panel.js), and Chrome sends no
  // referrer from an extension page. If this starts failing, panel.html needs a no-referrer meta.
  expect(provider.requests.map((r) => r.headers.referer)).toEqual([undefined, undefined]);
  // ...and nothing else left the machine: no other origin, nothing from the worker or the page.
  expect(requests.network().filter((r) => new URL(r.url).origin !== provider.origin)).toEqual([]);
  expect(requests.network().filter((r) => r.who !== 'panel')).toEqual([]);
});

test('the demo requests nothing at all', async ({ context, page, server, cdp, extensionId, serviceWorker }) => {
  const article = await openPanel({ page, cdp, extensionId }, server.url('article.html?network-demo'));
  const requests = await recordRequests({ cdp, extensionId, panel: article, serviceWorker, pages: [page] });
  const demoOpened = context.waitForEvent('page'); // the tab opens on about:blank, then loads the demo
  context.on('page', (p) => p.on('request', (r) => requests.all.push({ who: 'demo', method: r.method(), url: r.url() })));

  // The demo opens in a tab of its own, with its own panel (src/lib/tab-panel.js): record that
  // panel's requests too, so a provider call from it would be caught.
  await expect.poll(() => article.evaluate(() => !document.getElementById('demo-offer').hidden)).toBe(true);
  await article.click('#open-demo');
  const demo = await demoOpened;
  await demo.waitForURL(`chrome-extension://${extensionId}/demo/demo.html`);
  const panel = await attachSidePanel(cdp, extensionId);
  panel.on('Network.requestWillBeSent', ({ request }) => requests.all.push({ who: 'demo-panel', method: request.method, url: request.url }));
  await panel.send('Network.enable');
  await panel.send('Page.reload'); // its own start-up, recorded: silence is not deafness
  await expect.poll(() => panel.evaluate(() => document.readyState === 'complete')).toBe(true);
  await expect.poll(() => panel.text('#status')).toBe(MSG.demoTree(DEMO_META));
  await panel.click('.claim[data-id="b0"] .title');
  await panel.click('.evidence[data-id="b0.0"] .quote');
  await panel.click('#build');
  await expect.poll(() => panel.text('#status')).toBe(MSG.demoTree(DEMO_META));
  await demo.reload(); // the demo page loading again, recorded from its start

  // The recorder hears the demo page and the demo panel (their own files), so silence is not deafness.
  expect(requests.all.some((r) => r.who === 'demo' && r.url.endsWith('/demo/demo.js'))).toBe(true);
  expect(requests.all.some((r) => r.who === 'demo-panel' && r.url.endsWith('/panel/panel.js'))).toBe(true);
  expect(requests.network()).toEqual([]);
});
