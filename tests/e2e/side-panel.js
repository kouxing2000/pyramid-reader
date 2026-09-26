// Drives the extension's real side panel. Playwright exposes no Page for it (not even through
// connectOverCDP), so this talks CDP to the panel target directly; Input.dispatchMouseEvent
// clicks are trusted input, the same as a person's.

import { PANEL_PATH, panelPath } from '../../src/lib/tab-panel.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Calls fn until it returns a truthy value, every 50ms, or throws after timeout naming `what`. */
export async function poll(fn, { timeout = 10_000, what }) {
  const until = Date.now() + timeout;
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value) return value;
    if (Date.now() > until) throw new Error(`timed out after ${timeout}ms waiting for ${what}`);
    await sleep(50);
  }
}

// The toolbar icon click, through the same code path as a real one (needs the browser launched
// with --enable-unsafe-extension-debugging). Matches the tab by URL, so keep test URLs unique.
export async function clickToolbarIcon(cdp, extensionId, page) {
  const tab = await poll(async () => (await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] }))
    .targetInfos.find((t) => t.url === page.url()), { what: `a tab target for ${page.url()}` });
  await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: tab.targetId });
}

// Loads url in page, clicks the toolbar icon on it, and attaches to the side panel that opens.
// Reduced motion makes the page's scrolling instant.
export async function openPanel({ page, cdp, extensionId }, url) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url);
  await clickToolbarIcon(cdp, extensionId, page);
  return attachSidePanel(cdp, extensionId);
}

// Every open panel document: each tab has its own, at panel.html?tab=<id>[&page=…] (src/lib/tab-panel.js),
// and Chrome keeps a tab's alive, hidden, while another tab is in front.
export async function openSidePanels(cdp, extensionId) {
  const prefix = `chrome-extension://${extensionId}/${PANEL_PATH}`;
  return (await cdp.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page' && t.url.startsWith(prefix));
}

/** How many panel documents are open, hidden ones included. */
export const panelCount = async (cdp, extensionId) => (await openSidePanels(cdp, extensionId)).length;

// Attaches to the side panel on screen, the front tab's, once it has loaded. Every panel document
// is looked at, and the sessions on the hidden ones are let go.
export async function attachSidePanel(cdp, extensionId) {
  const looked = new Map(); // target id -> its session
  let panel;
  try {
    panel = await poll(async () => {
      for (const t of await openSidePanels(cdp, extensionId)) {
        if (!looked.has(t.targetId)) looked.set(t.targetId, await attachTarget(cdp, t.targetId));
        const session = looked.get(t.targetId);
        if (await session.evaluate(() => document.visibilityState === 'visible').catch(() => false)) return session;
      }
      return null;
    }, { what: 'the side panel to open' });
  } finally {
    for (const session of looked.values()) if (session !== panel) await session.detach().catch(() => {});
  }
  await poll(() => panel.evaluate(() => document.readyState === 'complete'), { what: 'the side panel to load' });
  await panel.evaluate(recordPanel);
  attached.add(panel);
  return panel;
}

// What each panel a test attached to did, for a failed test's report (fixtures.js): a flake on a
// slower machine is read from this, since it rarely happens where it can be watched.
const attached = new Set();

// Runs in the panel: keeps its status line, the clicks it received and its errors, timed from the
// panel's start, in window.__panelLog.
function recordPanel() {
  const log = (window.__panelLog = []);
  const note = (what) => log.push(`${Math.round(performance.now())}ms ${what}`);
  const status = document.getElementById('status');
  note(`attached; status: ${JSON.stringify(status.textContent)}`);
  new MutationObserver(() => note(`status: ${JSON.stringify(status.textContent)}`))
    .observe(status, { childList: true, characterData: true, subtree: true });
  document.addEventListener('click', (e) => note(`click on ${e.target.closest('[id]')?.id ?? e.target.tagName}` +
    `${e.target.closest('button')?.disabled ? ' (disabled)' : ''}`), true);
  addEventListener('error', (e) => note(`error: ${e.message}`));
  addEventListener('unhandledrejection', (e) => note(`unhandled rejection: ${e.reason?.message ?? e.reason}`));
  const error = console.error.bind(console);
  console.error = (...args) => { note(`console.error: ${args.map(String).join(' ')}`); error(...args); };
}

/** Forgets the panels attached so far: each test's report names its own. */
export const forgetPanels = () => attached.clear();

/** The log of every panel attached since forgetPanels, one block per panel; a closed one says so. */
export async function panelLogs() {
  const blocks = [];
  for (const panel of attached) {
    const log = await panel.evaluate(() => window.__panelLog).catch((e) => [`(unreadable: ${e.message.split('\n')[0]})`]);
    blocks.push(`panel ${panel.targetId}:\n  ${log.join('\n  ')}`);
  }
  return blocks.join('\n');
}

// Closes the front tab's panel and waits until its document is gone. A panel is closed by its tab:
// close({windowId}) finds no window-wide panel to close.
export async function closePanel(cdp, extensionId, serviceWorker) {
  const tabId = await serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await chrome.sidePanel.close({ tabId: tab.id });
    return tab.id;
  });
  const url = `chrome-extension://${extensionId}/${panelPath(tabId)}`;
  const own = (t) => t.url === url || t.url.startsWith(`${url}&`);
  await poll(async () => !(await openSidePanels(cdp, extensionId)).some(own), { what: 'the side panel to close' });
}

// A CDP session on any target (the panel, the service worker, a page), for raw commands and events.
export async function attachTarget(cdp, targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  return new SidePanel(cdp, sessionId, targetId);
}

class SidePanel {
  #cdp;
  #sessionId;
  #pending = new Map();
  #listeners = new Map();
  #nextId = 0;

  constructor(cdp, sessionId, targetId) {
    this.#cdp = cdp;
    this.#sessionId = sessionId;
    this.targetId = targetId;
    cdp.on('Target.receivedMessageFromTarget', ({ sessionId: sid, message }) => {
      if (sid !== this.#sessionId) return;
      const msg = JSON.parse(message);
      if (msg.id === undefined) {
        for (const fn of this.#listeners.get(msg.method) ?? []) fn(msg.params);
        return;
      }
      this.#pending.get(msg.id)?.(msg);
      this.#pending.delete(msg.id);
    });
  }

  // Lets the target go; the session answers nothing after.
  detach() {
    return this.#cdp.send('Target.detachFromTarget', { sessionId: this.#sessionId });
  }

  // A CDP event from this target, e.g. on('Network.requestWillBeSent', fn) after Network.enable.
  on(method, fn) {
    this.#listeners.set(method, [...(this.#listeners.get(method) ?? []), fn]);
  }

  async send(method, params = {}, timeout = 10_000) {
    const id = ++this.#nextId;
    let timer;
    const reply = new Promise((resolve, reject) => {
      this.#pending.set(id, resolve);
      timer = setTimeout(() => reject(new Error(`side panel: no reply to ${method} within ${timeout}ms ` +
        '(did the panel close?)')), timeout);
    });
    let msg;
    try {
      await this.#cdp.send('Target.sendMessageToTarget',
        { sessionId: this.#sessionId, message: JSON.stringify({ id, method, params }) });
      msg = await reply;
    } finally { // a send to a gone target (a closed panel) gets no reply: its timer must not reject unheard
      clearTimeout(timer);
      this.#pending.delete(id);
    }
    if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
    return msg.result;
  }

  // Like page.evaluate: runs fn(arg) in the panel and returns its JSON-serializable result.
  async evaluate(fn, arg) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression: `(${fn})(${JSON.stringify(arg)})`, awaitPromise: true, returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  async click(selector) {
    const point = await this.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return r.width || r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { hidden: true };
    }, selector);
    if (!point) throw new Error(`side panel: no element matches ${selector}`);
    // A box with no size would be clicked at (0, 0), on whatever is there.
    if (point.hidden) throw new Error(`side panel: ${selector} is not rendered`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    }
  }

  text(selector) {
    return this.evaluate((sel) => document.querySelector(sel)?.textContent ?? null, selector);
  }

  texts(selector) {
    return this.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent), selector);
  }
}
