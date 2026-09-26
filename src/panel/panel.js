// Side panel entry point. The panel is one page's (lib/tab-panel.js): its tab id rides in its URL,
// Chrome shows it only while that tab is in front, and it closes when the tab leaves the page
// (closePanel). Build reads the tab's visible paragraphs (SPEC §4.5) and shows the page's tree: the one saved on this machine for that text, or else a new one streamed from
// the reader's own provider, each node drawn as soon as it is complete and checked (lib/verify),
// then saved. Rebuild asks the provider again. On the demo page the tree is the demo's own; with
// no provider set up Build lists the paragraphs a tree would be built from. A node's text scrolls
// the page to its source sentence and highlights it, a ¶ button does the same for the whole
// paragraph. A click on a claim's row opens it
// (body, sources, evidence) or folds it again. A whole tree is also painted on its page
// (paint.js), and the page tells the panel what the reader points at, clicks and scrolls to. A
// tree in another language than the reader's can be read in theirs too (translate.js), on this
// computer. The panel runs the whole build, so closing it ends the request. Page and model text
// reach the DOM only through el() and textContent.
import { DEMO_META, DEMO_TREE } from '../demo/demo-tree.js';
import { buildTree } from '../lib/build.js';
import { dropTree, loadTree, saveTree, treeKey } from '../lib/cache.js';
import { treePrompt } from '../lib/prompt.js';
import { closeTabPanel, openTabPanel, pageOf } from '../lib/tab-panel.js';
import { ProviderError } from '../lib/providers/http.js';
import { providerConfig } from '../lib/providers/index.js';
import { readyNodes, SchemaError } from '../lib/tree.js';
import { verifier } from '../lib/verify/index.js';
import { el } from './dom.js';
import { MSG } from './messages.js';
import { demoAnswers, readTab } from './page-link.js';
import { PAINT_MODES, paintPlan } from './paint.js';
import { chooseLanguage, initSettings, languageOptions, openSettings, readSettings } from './settings.js';
import { languageName, readsLanguage, sameLanguage, secondLanguage, translations, translatorCode } from './translate.js';
import { drawNode, drawSummary, setOpen } from './tree-view.js';

const $ = (id) => document.getElementById(id);
const store = chrome.storage.local;
const params = new URLSearchParams(location.search); // lib/tab-panel.js panelPath
const tabId = Number(params.get('tab')); // the panel's tab, for life
// The page the panel was opened on, for life: the tab's URL at the click, without its #fragment,
// where Chrome showed the opener one (a web page; the demo page from Chrome 154); undefined where
// it did not (chrome://, the demo page through 153). tabs.onUpdated compares the tab against it,
// never reading a page to decide, and readPage reads no other.
const here = params.get('page') ?? undefined;

// The page on screen: {tabId, url, key, demo, documentId, agent, title, paragraphs, skipped}
// (page-link.js readTab()); key is its saved tree's key; agent(req) runs the page agent on it.
let page = null;
const nodes = new Map(); // the tree on screen: node id -> the node as drawn, checks included
let waitingForClick = false; // the page is unreadable without the toolbar click, which resumes the build
let building = false; // a build or rebuild is running; a peek never blocks one
let followUp = false; // the page loaded again during a build: peek again once it ends
let latest = 0; // counts peeks and builds: a peek still reading gives way to a later one
let stopping = null; // the AbortController of the request streaming now
let complete = false; // the tree on screen is whole: saved, the demo's, or streamed to its end
let paintMode = 'all'; // paint.js PAINT_MODES, the reader's choice
let focus = null; // the claim last picked, in the panel or on the page: 'verdict' or a claim id
let painted = { marks: [] }; // what the page shows now (paint.js paintPlan)
let view = { first: null, last: null }; // the paragraphs on screen in the page, from its watcher
let paints = 0; // numbers each paint; the page keeps the one on screen
let paintPort = null; // held while the page shows this tree's paint; closing it clears the paint
const requests = new Map(); // tab id -> the last paint request sent to it
const READ_MODES = ['original', 'both', 'mine'];
let readChoice = null; // READ_MODES: how the reader chose to read a translated tree; null until they do
let translateTo = null; // the language the reader chose in Settings over the browser's
let treeLang = null; // the language the tree on screen is written in, when it says
// The tree on screen's second language, as translatorCode()s {source, target} and whether the
// reader reads the source too (readsIt); null when it has none, and the Read-in switch is hidden.
let reading = null;
const translation = translations();

// Paint requests reach a page in the order they were made; one tab's never wait on another's.
function toPage(target, req) {
  const next = (requests.get(target.tabId) ?? Promise.resolve()).catch(() => {}).then(() => target.agent(req));
  requests.set(target.tabId, next);
  return next;
}

const setStatus = (text) => { $('status').textContent = text; };

/**
 * Build and Rebuild: the active tab's tree. Build shows the tree the page already has (the demo's
 * on the demo page, else the one saved for its text) and otherwise asks the provider; Rebuild asks
 * the provider whatever is saved. The new tree is saved.
 */
async function build({ rebuild = false, resumed = false } = {}) {
  if (building) return;
  building = true;
  latest++; // a peek still reading gives way
  $('build').disabled = true;
  try {
    const read = await readPage({ resumed });
    if (!read) return;
    const key = await pageKey(read);
    const kept = read.demo || !rebuild ? await keptTree(read, key) : null;
    enter({ ...read, key });
    if (!page.paragraphs.length) return setStatus(MSG.noText(page.skipped));
    if (kept) return drawTree(kept);
    if (read.demo) return setStatus(MSG.demoMismatch);

    const { settings, keys } = await readSettings(); // fresh: another window may have saved
    const cfg = providerConfig(settings, keys);
    if (!cfg) {
      setStatus(MSG.needsSettings);
      openSettings();
      return listParagraphs();
    }
    const built = await streamTree(cfg);
    if (built && key) await saveTree(store, key, { url: page.url, model: cfg.model, label: cfg.label, tree: built.tree });
    // Said once the tree is saved, so that Build then shows it.
    if (built) setStatus(built.status);
  } finally {
    building = false;
    $('build').disabled = false;
    if (followUp) {
      followUp = false;
      peek();
    }
  }
}

/**
 * The panel opening, the toolbar icon clicked on its tab, the page loading again, the demo page
 * asking: shows the tab's page when it is not the one on screen: its title and paragraph count,
 * and its tree when it has one (the demo's on the demo page, else the one saved for its text),
 * otherwise that Build reads it. It has no path to the network, so it can never send the page
 * anywhere. The document on screen it leaves as it is, tree included (a page changed in place is
 * read again by Build), unless its changed text has a saved tree. It gives way to a build, and
 * runs again after it. It only ever reads the page the panel was opened on: a tab that left it
 * closes the panel instead (closePanel).
 */
async function peek() {
  if (building) {
    followUp = true;
    return;
  }
  const call = ++latest;
  const read = await readPage({ quiet: true });
  if (call !== latest || !read) return;
  const key = await pageKey(read);
  const same = page !== null && page.documentId === read.documentId;
  if (same && page.key === key) return;
  const kept = await keptTree(read, key);
  if (call !== latest) return;
  // The same document, its text changed in place (a live page, or a single-page site moving to
  // another article): only a saved tree for the new text replaces what is shown, else Build reads
  // it. A same-document change with no saved tree is left as it is.
  if (same && !kept && nodes.size) return;
  enter({ ...read, key });
  if (!page.paragraphs.length) return setStatus(MSG.noText(page.skipped));
  if (kept) return drawTree(kept);
  return setStatus(read.demo ? MSG.demoMismatch : MSG.buildThisPage);
}

// Where the page's tree is saved: its URL and the text the model is sent. The demo has none.
const pageKey = (read) => (read.url && read.paragraphs.length && !read.demo
  ? treeKey(read.url, treePrompt(read).user) : null);

// The tree the page has without asking the provider, as {nodes, status, rebuild}, or null: the
// demo's on the demo page, else the one saved under key. A saved tree the validator now rejects
// was saved by a version with another schema, and is dropped; so is one saved before trees named
// their language, which could never be read in the reader's.
async function keptTree(read, key) {
  if (read.demo) {
    // The demo's article is English Wikipedia's; a tree built before trees named their language
    // does not say so.
    const nodes = readyTree({ lang: 'en', ...DEMO_TREE }, read.paragraphs);
    return nodes && { nodes, status: MSG.demoTree(DEMO_META), rebuild: false };
  }
  const saved = key && (await loadTree(store, key));
  if (!saved) return null;
  const nodes = saved.tree.lang ? readyTree(saved.tree, read.paragraphs) : null;
  if (!nodes) await dropTree(store, key);
  return nodes && { nodes, status: MSG.savedTree(saved.model, new Date(saved.savedAt).toLocaleDateString()), rebuild: true };
}

// The tab's visible paragraphs, or null with the reason in the status line; quiet, null with
// nothing said.
async function readPage({ quiet = false, resumed = false }) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) {
    if (!quiet) setStatus(MSG.noTab);
    return null;
  }
  // Never a page the panel was not opened on: the tab may have moved on in the moment before its
  // update closes the panel.
  if (here !== undefined && pageOf(tab.url) !== here) return null;
  if (!quiet) setStatus(MSG.reading);
  try {
    const read = await readTab(tab, here);
    if (!quiet) waitingForClick = false;
    return { tabId: tab.id, url: tab.url, ...read };
  } catch (e) {
    if (quiet) return null;
    // Without access Chrome withholds even the tab's URL. The toolbar click grants access to
    // ordinary pages only, so a page still unreadable after one (chrome://, the Web Store) is
    // off limits rather than waiting for another click.
    const noAccess = tab.url === undefined;
    if (noAccess && !resumed) {
      waitingForClick = true;
      setStatus(MSG.needsClick);
    } else {
      waitingForClick = false;
      setStatus(MSG.unreadable(e.message));
    }
    return null;
  }
}

// Takes the page on screen off it, tree included, and clears the status line.
function leave() {
  paintPort?.disconnect(); // its page clears its paint
  paintPort = null;
  page = null;
  complete = false;
  focus = null;
  painted = { marks: [] };
  view = { first: null, last: null };
  waitingForClick = false; // its prompt is no longer on screen
  nodes.clear();
  $('source').textContent = '';
  $('source').hidden = true;
  $('page-note').textContent = '';
  $('paragraphs').replaceChildren();
  $('tree').replaceChildren();
  $('rebuild').hidden = true;
  treeLang = null;
  reading = null;
  showReadIn();
  drawMap();
  setStatus('');
  // offerDemo() reads `page`, so enter() runs it once `page` is the new page.
}

// The tab left the page: the panel is done. A build under way stops, and nothing is saved; the
// document is gone before anything else runs.
function closePanel() {
  stopping?.abort();
  closeTabPanel(tabId).catch((e) => console.error('setOptions failed:', e));
}

// Makes `read` the page on screen, with nothing drawn for it yet.
function enter(read) {
  leave();
  page = read;
  $('source').textContent = page.title;
  $('source').hidden = !page.title;
  $('source').title = page.title; // the whole title, when the header line cuts it short
  $('page-note').textContent = page.paragraphs.length ? MSG.paragraphs(page.paragraphs.length, page.skipped) : '';
  offerDemo().catch(() => {});
}

const draw = (node) => {
  nodes.set(node.id, node);
  drawNode($('tree'), node);
  drawSummary($('tree'), nodes.values());
  if (node.type === 'verdict') setupReadIn(node.lang);
  else applyRead();
};

// Why this Chrome cannot translate source into target, or null when it can.
async function cannotRead(source, target) {
  if (!translation.supported) return MSG.translateNeedsChrome(languageName(target));
  const available = await translation.availability(source, target).catch((e) => e);
  if (['available', 'downloadable', 'downloading'].includes(available)) return null;
  return MSG.cannotTranslate(languageName(source), languageName(target), available?.message);
}

let settingUp = 0; // counts setupReadIn calls: only the latest one's answer is shown

// Whether the tree on screen, written in `lang`, gets a second language, and which (translate.js).
// A reader with no other language is shown nothing. One who has one but cannot have the tree in
// it (no Translator in this Chrome, or none for the pair) is told why, in the switch's place.
async function setupReadIn(lang) {
  const ticket = ++settingUp;
  treeLang = lang ?? null;
  const source = lang ? translatorCode(lang) : null;
  const target = source ? secondLanguage(lang, { languages: navigator.languages, chosen: translateTo }) : null;
  const why = target ? await cannotRead(source, target) : null;
  if (ticket !== settingUp) return;
  reading = target && !why ? { source, target, readsIt: readsLanguage(lang, navigator.languages) } : null;
  for (const e of $('tree').querySelectorAll('.tr')) {
    e.textContent = ''; // another language's, if any
    delete e.dataset.for;
  }
  showReadIn(why);
}

// The Read-in switch, naming both languages, with a ▾ to read in another; in its place, why the
// tree cannot be read in the reader's language; or nothing, when they have no other.
function showReadIn(why = null) {
  $('read-in').hidden = !reading && !why;
  $('read-mode').hidden = !reading;
  $('read-in-label').hidden = !reading;
  readNote(why);
  if (reading) {
    const [from, to] = [languageName(reading.source), languageName(reading.target)];
    const [original, both, mine] = $('read-mode').querySelectorAll('button');
    Object.assign(original, { textContent: from, title: MSG.readOriginalTip(from) });
    both.title = MSG.readBothTip(from, to);
    Object.assign(mine, { textContent: to, title: MSG.readMineTip(to) });
    // The article's own language is no choice here: it would leave no switch to choose again from.
    const pick = $('read-lang');
    pick.value = translateTo ?? '';
    for (const o of pick.options) o.disabled = sameLanguage(o.value, reading.source);
  }
  applyRead();
}

// Shows the tree as the reader reads it: the reader's choice, else the original when they read the
// article's language and both when they do not. Hovering a line shows its source sentence, and in
// the reader's language its original first.
function applyRead() {
  const mode = !reading ? 'original' : readChoice ?? (reading.readsIt ? 'original' : 'both');
  document.body.dataset.read = mode;
  for (const b of $('read-mode').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.read === mode));
  for (const e of $('tree').querySelectorAll('[data-tip]')) {
    const original = e.querySelector(':scope > .orig')?.textContent;
    e.title = mode === 'mine' && original ? [original, e.dataset.tip].filter(Boolean).join('\n\n') : e.dataset.tip;
  }
  if (mode !== 'original') translateShown();
}

// Puts each line's translation in its place, once per line, saying so while it works: the first
// use of a language downloads and loads its model, which takes seconds. Chrome starts that
// download only after a click in the panel: until there has been one, or when Chrome refuses one
// it had, the switch offers that click instead of failing. A failure is shown, with Retry.
async function translateShown({ clicked = false } = {}) {
  const shown = reading;
  if (!shown) return;
  const { source, target } = shown;
  const todo = [...$('tree').querySelectorAll('.tr')].filter((e) => e.dataset.for !== target);
  if (!todo.length) return;
  const name = languageName(target);
  if (!clicked && !navigator.userActivation.hasBeenActive && (await translation.availability(source, target)) !== 'available') {
    if (reading === shown) readNote(MSG.translateOfferNote, { action: MSG.translateOffer(name) });
    return;
  }
  const progress = (share) => { if (reading === shown && share < 1) readNote(MSG.downloading(name, share), { busy: true }); };
  readNote(MSG.translating(name), { busy: true });
  try {
    await Promise.all(todo.map(async (e) => {
      const text = await translation.translate(e.previousElementSibling.textContent, source, target, { onProgress: progress });
      if (reading !== shown || !e.isConnected) return;
      Object.assign(e, { textContent: text, lang: target });
      Object.assign(e.dataset, { for: target, tag: name });
    }));
    if (reading === shown) readNote(null);
  } catch (err) {
    if (reading !== shown) return;
    if (err.name === 'NotAllowedError') readNote(MSG.translateOfferNote, { action: MSG.translateOffer(name) });
    else readNote(MSG.translateFailed(name, err.message), { action: MSG.retry, failed: true });
  }
}

// The line under the Read-in switch: translation under way, a failure, the click Chrome needs,
// or why the tree cannot be read in the reader's language.
function readNote(text, { action = null, failed = false, busy = false } = {}) {
  $('read-note').hidden = !text;
  $('read-note').classList.toggle('failed', failed);
  $('read-note').classList.toggle('busy', busy);
  $('read-note-text').textContent = text ?? '';
  $('read-action').hidden = !action;
  $('read-action').textContent = action ?? '';
}

// A complete tree from earlier (saved, or the demo's) as nodes checked against the paragraphs as
// they read now, as a streamed tree's are; null when it no longer validates.
function readyTree(tree, paragraphs) {
  let nodes;
  try {
    nodes = readyNodes(tree, paragraphs.length, true);
  } catch (e) {
    if (e instanceof SchemaError) return null;
    throw e;
  }
  const verify = verifier(paragraphs);
  return nodes.map(verify);
}

function drawTree({ nodes: checked, status, rebuild }) {
  for (const node of checked) draw(node);
  setStatus(status);
  $('rebuild').hidden = !rebuild;
  complete = true;
  paint();
}

// Paints the tree on screen onto its page, in the paint mode: only a whole one, never a tree still
// streaming or one cut short. The panel then holds a port for that paint, so that the page clears
// it when the panel closes or moves on.
function paint() {
  if (!page || !complete) return;
  const shown = page;
  const gen = ++paints;
  painted = paintPlan(nodes.values(), { mode: paintMode, focus });
  drawMap();
  toPage(shown, { op: 'paint', gen, ...painted }).then((result) => {
    // Another page came on screen while this paint was on its way: nobody holds it, so clear it.
    if (page !== shown) return toPage(shown, { op: 'clear', paint: true });
    if (gen !== paints) return undefined; // a newer paint follows, and holds its own port
    const held = paintPort;
    paintPort = chrome.tabs.connect(shown.tabId, { name: `pr-paint:${gen}`, ...(shown.demo ? { frameId: 0 } : { documentId: shown.documentId }) });
    held?.disconnect();
    if (result?.stale) setStatus(MSG.paintStale(result.stale));
    return undefined;
  }).catch(() => {}); // the tab navigated or closed
}

// The part of the tree an id names: the verdict's section or a claim's li.
const treeItem = (id) => [...$('tree').querySelectorAll('section.verdict, li.claim')].find((e) => e.dataset.id === id);

// Puts class cls on the item id names, and on no other.
function markItem(cls, id) {
  for (const e of $('tree').querySelectorAll(`.${cls}`)) e.classList.remove(cls);
  if (id) treeItem(id)?.classList.add(cls);
}

// The reader picked a claim (or the verdict): in the panel, or by clicking its paint on the page,
// which also opens it and brings it into the panel's view. Focus mode paints it alone.
function select(id, { reveal = false } = {}) {
  const item = treeItem(id);
  if (!item) return;
  markItem('selected', id);
  if (reveal) {
    if (item.matches('li.claim')) setOpen(item, true);
    item.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  if (focus === id) return;
  focus = id;
  if (paintMode === 'focus') paint();
}

// What the page's watcher saw (content/page.js), for the tree on screen only: another tab, another
// document in this one (readings restart per document), or an older reading is not this tree's.
function onPageEvent(msg, sender) {
  if (!page || sender.tab?.id !== page.tabId || msg.reading !== page.reading) return;
  if (!page.demo && sender.documentId !== page.documentId) return;
  if (msg.event === 'point') return markItem('pointed', msg.id);
  if (msg.event === 'pick') return select(msg.id, { reveal: true });
  if (msg.event !== 'view') return;
  view = { first: msg.first, last: msg.last };
  // Every node found on the page counts, whatever the paint mode shows.
  const inView = new Set(paintPlan(nodes.values()).marks
    .filter((m) => view.first !== null && m.n >= view.first && m.n <= view.last).map((m) => m.id));
  for (const e of $('tree').querySelectorAll('section.verdict, li.claim')) e.classList.toggle('in-view', inView.has(e.dataset.id));
  drawMap();
}

// The article map, beside the page's scrollbar: a tick for each painted paragraph in its claim's
// colour, and the part of the article on screen.
function drawMap() {
  const count = page?.paragraphs.length ?? 0;
  const ticks = new Map(painted.marks.map((m) => [`${m.h}:${m.n}`, m]));
  $('map').hidden = !count || !ticks.size;
  if ($('map').hidden) return;
  const share = (k) => `${(k / count) * 100}%`;
  $('map').replaceChildren(...[
    view.first !== null && el('span', { class: 'window', style: `top:${share(view.first - 1)};height:${share(view.last - view.first + 1)}` }),
    ...[...ticks.values()].map((m) => el('span', { class: 'tick', 'data-h': m.h, style: `top:${share(m.n - 1)};height:max(3px, ${share(1)})` })),
  ].filter(Boolean));
}

// The paint mode, shown on its switch.
function setPaintMode(mode) {
  paintMode = PAINT_MODES.includes(mode) ? mode : 'all';
  document.body.dataset.paint = paintMode;
  for (const b of $('paint-mode').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.mode === paintMode));
}

// Streams a new tree onto the screen. Returns it when complete, with the status that says how long
// it took, else null with the reason shown.
async function streamTree(cfg) {
  const started = performance.now();
  let verdictAt;
  setStatus(MSG.asking(cfg.model));
  stopping = new AbortController();
  $('stop').hidden = false;
  try {
    const tree = await buildTree({
      prompt: treePrompt(page),
      stream: (prompt, signal) => cfg.transport.stream(cfg, prompt, signal),
      signal: stopping.signal,
      count: page.paragraphs.length,
      verify: verifier(page.paragraphs),
      onNode: (node) => {
        if (node.type === 'verdict') verdictAt ??= performance.now();
        draw(node);
      },
      onRetry: (error) => {
        $('tree').replaceChildren();
        nodes.clear();
        focus = null;
        verdictAt = undefined;
        setStatus(MSG.retrying(error));
      },
    });
    const status = MSG.built(cfg.model, verdictAt - started, performance.now() - started);
    $('rebuild').hidden = false;
    complete = true;
    paint();
    // A model that named the language after the verdict: the verdict was drawn without it.
    if (!treeLang && tree.lang) setupReadIn(tree.lang);
    return { tree, status };
  } catch (e) {
    if (e.name === 'AbortError') setStatus(MSG.stopped);
    else if (e instanceof SchemaError) setStatus(MSG.brokeTwice(e.message));
    else if (e instanceof ProviderError) setStatus(MSG.providerFailed(cfg.label, e.message));
    else setStatus(MSG.failed(e.message));
    return null;
  } finally {
    stopping = null;
    $('stop').hidden = true;
  }
}

// Without a provider: the paragraphs a tree would be built from, under their headings.
function listParagraphs() {
  const list = $('paragraphs');
  let ol = null;
  let heading;
  for (const p of page.paragraphs) {
    if (!ol || p.heading !== heading) {
      heading = p.heading;
      if (heading) list.append(el('h2', {}, heading));
      ol = list.appendChild(el('ol'));
    }
    ol.append(el('li', {}, el('button', { type: 'button', class: 'para', 'data-n': p.n },
      el('span', { class: 'n' }, `¶${p.n}`), el('span', { class: 'text' }, p.text))));
  }
}

// Highlights characters [start, end) of paragraph n on the page, the whole paragraph without them.
async function showSource(button) {
  const shown = page;
  const [n, start, end] = ['n', 'start', 'end'].map((k) => (button.dataset[k] === undefined ? undefined : Number(button.dataset[k])));
  let result;
  try {
    result = await shown.agent({ op: 'show', n, start, end });
  } catch {
    result = { ok: false, reason: 'stale' }; // the tab navigated or closed
  }
  if (page !== shown) return; // a build replaced the page meanwhile; its state wins
  for (const b of document.querySelectorAll('[aria-current]')) b.removeAttribute('aria-current');
  if (result?.ok) {
    button.setAttribute('aria-current', 'true');
  } else {
    setStatus(MSG.pageChanged);
    // A highlight from an earlier click would otherwise stay on a paragraph the panel no longer
    // matches. Nothing to clear if the document is gone.
    shown.agent({ op: 'clear' }).catch(() => {});
  }
}

// Opens every claim, or folds them all again but those holding a quote not on the page: a
// failure is never folded away (tree-view.js).
function expandAll(button) {
  const open = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(open));
  button.textContent = open ? MSG.collapseAll : MSG.expandAll;
  for (const claim of $('tree').querySelectorAll('li.claim')) {
    setOpen(claim, open || Boolean(claim.querySelector('.evidence .check[data-status="unanchored"]')));
  }
}

// First run (SPEC §5.5): until a provider is set up, the panel offers the demo, unless the demo
// is what it shows.
async function offerDemo() {
  const { settings, keys } = await readSettings();
  $('demo-offer-text').textContent = MSG.demoOffer;
  $('demo-offer').hidden = providerConfig(settings, keys) !== null || Boolean(page?.demo);
}

$('build').addEventListener('click', () => build());
$('rebuild').addEventListener('click', () => build({ rebuild: true }));
$('stop').addEventListener('click', () => stopping?.abort());
// The demo opens in a tab of its own, with its own panel: a click's activation outlasts the tab's
// creation here, where a service worker's gesture would not (lib/tab-panel.js).
$('open-demo').addEventListener('click', async () => {
  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('demo/demo.html') });
  // On the page as Chrome names it: the demo's URL, pending, from Chrome 154; nothing before.
  openTabPanel(tab.id, tab.pendingUrl ?? tab.url).catch(() => {});
});
$('read-mode').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-read]');
  if (!button) return;
  readChoice = button.dataset.read;
  chrome.storage.local.set({ read: readChoice });
  applyRead();
});
// Another language from the switch is the one Settings holds. Chosen while the tree shows the
// original, it is shown in that language, not left unseen. One this Chrome cannot translate into
// is refused, with why, and the switch stays: it would otherwise give way to the reason alone,
// leaving nothing here to choose again from.
$('read-lang').addEventListener('change', async () => {
  const to = $('read-lang').value || null;
  const target = secondLanguage(treeLang, { languages: navigator.languages, chosen: to });
  const why = target && reading ? await cannotRead(reading.source, target) : null;
  if (why) {
    $('read-lang').value = translateTo ?? '';
    return readNote(why);
  }
  if (document.body.dataset.read === 'original') {
    readChoice = 'mine';
    chrome.storage.local.set({ read: readChoice });
  }
  return chooseLanguage(to);
});
$('read-action').addEventListener('click', () => translateShown({ clicked: true }));
$('paint-mode').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-mode]');
  if (!button) return;
  setPaintMode(button.dataset.mode);
  chrome.storage.local.set({ paint: paintMode });
  paint();
});
document.addEventListener('click', (e) => {
  const all = e.target.closest('.expand-all');
  if (all) return expandAll(all);
  // A claim's row (number, title, gloss, check, chevron) opens and folds it, and its title also
  // shows its sentence on the page. What opening shows, and the flags, keep their own clicks; a
  // click that ends a text selection folds nothing.
  const row = e.target.closest('li.claim > .node');
  if (row && !e.target.closest('.more, .flags') && getSelection().isCollapsed) {
    setOpen(row.parentElement, !row.parentElement.classList.contains('open'));
  }
  const button = e.target.closest('.para, .cite, .go');
  if (button && page) {
    const item = button.closest('li.claim, section.verdict');
    if (item) select(item.dataset.id);
    showSource(button);
  }
  return undefined;
});
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'pr-page') {
    onPageEvent(msg, sender);
    return undefined;
  }
  // The toolbar click names its tab, the demo page's messages come from theirs: another tab's are
  // for its own panel.
  if ((msg?.tabId ?? sender.tab?.id) !== tabId) return undefined;
  if (msg?.type === 'toolbar-click') onToolbarClick();
  else if (['demo-open', 'demo-ready'].includes(msg?.type)) peek();
  return undefined;
});
// The toolbar icon clicked on the tab: a Build waiting for the click goes ahead, else the page is
// looked at again. A panel opened where Chrome showed no URL, on a tab that now shows one, is
// being replaced: the click gives that page a panel of its own (lib/tab-panel.js), and this one
// does nothing more.
async function onToolbarClick() {
  if (here === undefined && (await chrome.tabs.get(tabId).catch(() => ({}))).url !== undefined) return;
  if (waitingForClick) build({ resumed: true });
  else peek();
}
// The tab loading: told apart by URL alone, so that no page the icon was not clicked on is ever
// read. The same page (a reload, a # change) is looked at again, and the read tells a new document
// from the same one; another URL (a navigation, a pushState to another path or query) closes the
// panel, and so does a URL Chrome now withholds, which means the tab left the click's origin.
// While the grant holds Chrome shows the URL from the `loading` status on, in changeInfo when it
// changed and on the tab always. A panel opened where Chrome shows no URL (chrome://, and the
// demo page through Chrome 153) sees none on a reload either, so once the tab has loaded it asks
// the demo page itself, which alone answers: a tab that stopped answering has left it.
chrome.tabs.onUpdated.addListener(async (id, info) => {
  if (id !== tabId || !info.status) return;
  const url = info.url ?? (await chrome.tabs.get(tabId).catch(() => ({}))).url;
  if (here !== undefined || url !== undefined) {
    if (pageOf(url) === here) peek();
    else closePanel();
  } else if (info.status === 'complete') {
    if (await demoAnswers(tabId)) peek();
    else closePanel();
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.settings || changes.keys)) offerDemo();
});
setPaintMode('all');
$('read-lang').append(...languageOptions());
Object.assign($('read-pick'), { title: MSG.readPickTip });
$('read-lang').setAttribute('aria-label', MSG.readPickTip);
initSettings({
  onTranslateTo: (to) => {
    translateTo = to;
    if (treeLang) setupReadIn(treeLang);
  },
}).then(({ paint: mode, read, translateTo: to }) => {
  setPaintMode(mode);
  readChoice = READ_MODES.includes(read) ? read : null;
  translateTo = to;
  offerDemo();
  peek();
});
