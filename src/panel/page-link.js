// How the panel reaches the page in a tab. A web page gets the page agent (content/page.js)
// injected with chrome.scripting. The demo page is an extension page, which Chrome lets no
// extension script, activeTab or not (and whose URL it withholds through Chrome 153); it runs the
// same agent itself and answers over messaging, which is also how the panel tells it apart.
import { HIGHLIGHT_CSS, pageAgent } from '../content/page.js';

const styled = new Set(); // web documents that already have HIGHLIGHT_CSS

/** Whether the tab shows the demo page, which alone answers the panel's messages: nothing is injected. */
export const demoAnswers = (tabId) => chrome.tabs.sendMessage(tabId, { demo: { op: 'extract' } }).then(Boolean, () => false);

/**
 * Reads the tab's visible paragraphs (SPEC §4.5).
 * @param {chrome.tabs.Tab} tab
 * @param {string} [page] the panel's page (its URL sans #fragment): a web document that is not it
 *   is not read
 * @returns {Promise<{demo: boolean, documentId?: string, agent: (req: object) => Promise<object>,
 *   title: string, paragraphs: {n: number, text: string, heading: string | null}[], skipped: object}>}
 *   agent(req) runs one more page-agent request ({op: 'show' | 'clear', ...}) on this reading of
 *   the document, whatever reads the page after it; documentId names that document (the demo page
 *   names its own)
 * @throws when the page cannot be read: no access to it, a page no extension may script, or a
 *   document that is not `page`
 */
export async function readTab(tab, page) {
  const demo = await chrome.tabs.sendMessage(tab.id, { demo: { op: 'extract' } }).catch(() => undefined);
  if (demo) return { demo: true, agent: (req) => chrome.tabs.sendMessage(tab.id, { demo: { ...req, reading: demo.reading } }), ...demo };

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, func: pageAgent, args: [{ op: 'extract', page }],
  });
  if (injection.result === null) throw new Error('the tab has left the page');
  const target = { tabId: tab.id, documentIds: [injection.documentId] };
  if (!styled.has(injection.documentId)) {
    await chrome.scripting.insertCSS({ target, css: HIGHLIGHT_CSS });
    styled.add(injection.documentId);
  }
  const { reading } = injection.result;
  const agent = async (req) => (await chrome.scripting.executeScript({ target, func: pageAgent, args: [{ ...req, reading }] }))[0].result;
  return { demo: false, documentId: injection.documentId, agent, ...injection.result };
}
