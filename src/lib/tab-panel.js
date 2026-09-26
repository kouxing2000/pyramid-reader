// The side panel belongs to the page it was clicked open on (docs/DESIGN.md "One panel per tab"):
// the panel opened for a tab carries the tab's id and that page in its URL, which is the panel's
// only way to learn either, and the default panel is disabled (background.js), so a tab the icon
// was never clicked on shows none. Chrome hides a tab's panel while another tab is in front and
// shows the same document again on return, and loads the panel afresh when its path changes, so a
// click on another page in the same tab gives that page a panel of its own; the panel closes
// itself when its tab leaves the page (panel/panel.js), and dies with its tab.

export const PANEL_PATH = 'panel/panel.html';

/** A page is its URL without the #fragment; undefined for a URL Chrome withholds. */
export const pageOf = (url) => url?.split('#')[0];

/**
 * The panel page for tab `tabId` on `page` (pageOf the tab's URL, when Chrome showed it), as
 * sidePanel options name it and as the panel's URL ends.
 */
export const panelPath = (tabId, page) => `${PANEL_PATH}?tab=${tabId}${page ? `&page=${encodeURIComponent(page)}` : ''}`;

/**
 * Opens the tab's own panel on the page at `url`, the tab's URL as Chrome shows it to the caller,
 * passed on as is: shown for a web page the click granted; for the extension's own pages withheld
 * through Chrome 153 and shown from 154 (the panel takes either); never for chrome://. sidePanel.open
 * needs the user gesture of a click: in the service worker that gesture does not survive an await,
 * even of setOptions, so the two calls are made in the same tick, and Chrome applies them in order;
 * in an extension page the click's activation lasts a few seconds, an awaited tabs.create included.
 * @param {number} tabId
 * @param {string} [url]
 * @returns {Promise<void>} sidePanel.open's
 */
export function openTabPanel(tabId, url) {
  chrome.sidePanel.setOptions({ tabId, path: panelPath(tabId, pageOf(url)), enabled: true })
    .catch((e) => console.error('setOptions failed:', e));
  return chrome.sidePanel.open({ tabId });
}

/**
 * Closes the tab's panel, at once and for good: disabling the tab's panel destroys its document in
 * the same turn, from the panel itself or the worker, whether the tab is in front or behind
 * another, on any Chrome with a side panel. (sidePanel.close needs Chrome 141, takes ~400 ms, and
 * does nothing while the tab is behind another.) The next openTabPanel enables it again.
 * @param {number} tabId
 * @returns {Promise<void>} setOptions's
 */
export const closeTabPanel = (tabId) => chrome.sidePanel.setOptions({ tabId, enabled: false });
