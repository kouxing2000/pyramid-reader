// Service worker entry point. The toolbar icon opens the side panel (SPEC §5.1) from
// action.onClicked, because that click is also what grants activeTab on the page. With
// setPanelBehavior({openPanelOnActionClick: true}) Chrome opens the panel without the grant, and
// a click inside the panel never grants it, so the panel could not read any page. The behavior
// is set explicitly because Chrome keeps it in the profile across extension reloads.
//
// The panel it opens is the tab's own, on the page the click shows (lib/tab-panel.js), and the
// default panel is disabled, so a tab the icon was never clicked on shows none: a panel belongs
// to its page.
import { openTabPanel } from './lib/tab-panel.js';

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch((e) => console.error('setPanelBehavior failed:', e));
chrome.sidePanel.setOptions({ enabled: false }).catch((e) => console.error('setOptions failed:', e));

chrome.action.onClicked.addListener((tab) => {
  openTabPanel(tab.id, tab.url).catch((e) => console.error('sidePanel.open failed:', e));
  // The tab's panel, if open and waiting for access to its page, can go ahead now. No panel open:
  // nobody listens.
  chrome.runtime.sendMessage({ type: 'toolbar-click', tabId: tab.id }).catch(() => {});
});
