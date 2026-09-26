// The demo page's own script (SPEC §5.5). An extension page cannot be scripted, so it runs the
// page agent itself and answers the panel's requests for it ({demo: req}, over tabs.sendMessage).
// "Open the tree" opens this tab's side panel, which then finds this page and draws the demo's tree.
import { HIGHLIGHT_CSS, pageAgent } from '../content/page.js';
import { openTabPanel } from '../lib/tab-panel.js';

document.head.append(Object.assign(document.createElement('style'), { textContent: HIGHLIGHT_CSS }));

// Names this load of the page, as Chrome's documentId names a web page's document: the panel
// tells a reloaded demo from the one it drew by it.
const documentId = crypto.randomUUID();

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg?.demo) return undefined;
  const result = pageAgent(msg.demo);
  respond(msg.demo.op === 'extract' ? { ...result, documentId } : result);
  return undefined;
});

// An open panel draws the demo's tree as soon as this page can answer it (the panel opened the
// page, or the page was reloaded).
chrome.runtime.sendMessage({ type: 'demo-ready' }).catch(() => {});

// The panel it opens is this tab's own, on this page as Chrome names it to the extension (through
// Chrome 153 it withholds an extension page's URL, from 154 it shows it; lib/tab-panel.js).
// sidePanel.open needs the click's user gesture, so the tab is looked up beforehand, and the
// button works once it is known.
const button = document.getElementById('open-tree');
let tab;
button.disabled = true;
chrome.tabs.getCurrent().then((current) => {
  tab = current;
  button.disabled = false;
});
button.addEventListener('click', () => {
  openTabPanel(tab.id, tab.url).catch(() => {});
  // An open panel draws the tree now; one opening now finds this page as it starts.
  chrome.runtime.sendMessage({ type: 'demo-open' }).catch(() => {});
});
