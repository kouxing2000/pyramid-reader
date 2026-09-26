// Shared set-up for the E2E tests that build trees: settings as the form stores them, pointing at
// the mock OpenAI-compatible endpoint (mock-provider.js), and the panel opened on the article page.
import { expect } from './fixtures.js';
import { openPanel } from './side-panel.js';
import { MSG } from '../../src/panel/messages.js';

export const KEY = 'sk-e2e-not-a-real-key';
export const MODEL = 'mock-model';
export const BUILT = new RegExp(`^${MODEL}: verdict in \\d+\\.\\d s, whole tree in \\d+\\.\\d s\\.$`);

// Saved settings, as the form stores them, for tests that start past the form.
export const configure = (serviceWorker, provider) => serviceWorker.evaluate(
  ({ baseUrl, origin, model, key }) => chrome.storage.local.set({
    settings: { provider: 'compatible', providers: { compatible: { baseUrl, model } } },
    keys: { [origin]: key },
  }), { baseUrl: provider.baseUrl, origin: provider.origin, model: MODEL, key: KEY });

// How many times the page agent has read the active tab's page (its isolated-world counter): a
// landmark that a silent peek has run.
export const readings = (serviceWorker) => serviceWorker.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.__pyramidReadings ?? 0 });
  return result;
});

// The saved-tree status line, dated as the panel's locale writes the date.
export const savedStatus = async (panel, model, savedAt) =>
  MSG.savedTree(model, await panel.evaluate((at) => new Date(at).toLocaleDateString(), savedAt));

// The panel on tests/fixtures/pages/article.html; the query keeps each test's tab URL unique.
export const openArticle = ({ page, server, cdp, extensionId }, query) =>
  openPanel({ page, cdp, extensionId }, server.url(`article.html?${query}`));

// Whether each element matching selector in the panel is rendered.
export const shown = (panel, selector) => panel.evaluate((sel) =>
  [...document.querySelectorAll(sel)].map((e) => e.checkVisibility()), selector);

// Chrome's on-device Translator as a fake in the panel, with the browser's languages set: the panel
// reloads with both in place before its own script runs. Playwright's Chromium has the real one in
// extension pages, and a test must never make it download a model. Like Chrome's, the fake needs a
// click in the panel before it creates a translator for a pair not yet downloaded, and reports the
// download. It translates "text" as "[zh] text". availability maps a target language to Chrome's
// answer for it ('downloadable' when not given); delay is how long a pair's model takes to download
// and load (ms), reporting download progress only when there is a download; recentClick refuses a download unless the reader clicked in the last few seconds
// (Chrome's transient activation), not merely once; fail makes every create fail; missing removes the Translator, as in a Chrome
// before 138. window.__translator counts what the panel asked for.
export async function withTranslator(panel, { languages = ['en-US', 'en'], availability = {}, delay = 0, recentClick = false, fail = null, missing = false }) {
  const install = ({ languages, availability, delay, recentClick, fail, missing }) => {
    Object.defineProperty(Navigator.prototype, 'languages', { get: () => languages });
    Object.defineProperty(Navigator.prototype, 'language', { get: () => languages[0] });
    if (missing) {
      delete window.Translator;
      window.__translator = { missing };
      return;
    }
    const ready = new Set();
    const log = { created: [], translated: [] };
    window.__translator = log;
    window.Translator = {
      availability: async ({ sourceLanguage, targetLanguage }) =>
        (ready.has(`${sourceLanguage}>${targetLanguage}`) ? 'available' : availability[targetLanguage] ?? 'downloadable'),
      create: async ({ sourceLanguage, targetLanguage, monitor }) => {
        const pair = `${sourceLanguage}>${targetLanguage}`;
        if (fail) throw new DOMException(fail, 'OperationError');
        if (!ready.has(pair) && !(recentClick ? navigator.userActivation.isActive : navigator.userActivation.hasBeenActive)) {
          throw new DOMException('Requires a user gesture when availability is "downloadable".', 'NotAllowedError');
        }
        const events = new EventTarget();
        monitor?.(events);
        const downloads = (availability[targetLanguage] ?? 'downloadable') !== 'available';
        for (const loaded of [0, 0.5, 1]) {
          if (downloads) events.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded }));
          await new Promise((r) => setTimeout(r, delay / 2));
        }
        ready.add(pair);
        log.created.push(pair);
        return { translate: async (text) => { log.translated.push(text); return `[${targetLanguage}] ${text}`; } };
      },
    };
  };
  await panel.send('Page.enable'); // without it, the script below is registered but never runs
  await panel.send('Page.addScriptToEvaluateOnNewDocument',
    { source: `(${install})(${JSON.stringify({ languages, availability, delay, recentClick, fail, missing })})` });
  await panel.send('Page.reload');
  await expect.poll(() => panel.evaluate(() => document.readyState === 'complete' && Boolean(window.__translator)).catch(() => false))
    .toBe(true);
}
