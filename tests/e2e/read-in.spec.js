// The tree in a second language (panel/translate.js): offered only to a reader who reads another
// language than the article's, translated on the computer by Chrome's Translator (a fake here,
// setup.js withTranslator), and read in the original, both, or the reader's language.
import { test, expect } from './fixtures.js';
import { BUILT, configure, openArticle, shown, withTranslator } from './setup.js';
import { highlighted } from './page-checks.js';
import { MSG } from '../../src/panel/messages.js';
import { LANGUAGES } from '../../src/panel/translate.js';
import { ARTICLE_TREE } from '../fixtures/trees/article.js';

const TEXT = JSON.stringify(ARTICLE_TREE);
const { branches } = ARTICLE_TREE;
// The verdict, each title and each body: the lines a tree translates.
const LINES = [ARTICLE_TREE.verdict, ...branches.map((b) => b.title), ...branches.map((b) => b.body)];
const pressed = (panel) => panel.evaluate(() => document.querySelector('#read-mode [aria-pressed="true"]')?.dataset.read);
const translated = (panel) => panel.evaluate(() => ({
  verdict: document.querySelector('.verdict .title .tr').textContent,
  titles: [...document.querySelectorAll('.claim > .node > .title .tr')].map((e) => e.textContent),
  bodies: [...document.querySelectorAll('.claim .body .tr')].map((e) => e.textContent),
}));
const IN_ZH = {
  verdict: `[zh] ${ARTICLE_TREE.verdict}`,
  titles: branches.map((b) => `[zh] ${b.title}`),
  bodies: branches.map((b) => `[zh] ${b.body}`),
};

async function build({ page, server, cdp, extensionId, serviceWorker, provider }, query, translator) {
  await configure(serviceWorker, provider);
  provider.answer(TEXT);
  const panel = await openArticle({ page, server, cdp, extensionId }, query);
  if (translator) await withTranslator(panel, translator);
  await panel.click('#build');
  await expect.poll(() => panel.text('#status')).toMatch(BUILT);
  return panel;
}

test('a reader whose only language is the article\'s is offered no translation', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  const fx = { page, server, cdp, extensionId, serviceWorker, provider };
  const panel = await build(fx, 'read-one', { languages: ['en-US', 'en'] });
  expect(await shown(panel, '#read-in')).toEqual([false]);
  expect(await panel.evaluate(() => window.__translator)).toEqual({ created: [], translated: [] });
  await panel.click('#settings summary');
  expect(await panel.text('#translation-note')).toBe(MSG.translationFrom('English'));
  // Chrome's languages are changed where Chrome keeps them.
  await panel.click('#chrome-languages');
  await expect.poll(async () => (await cdp.send('Target.getTargets')).targetInfos.map((t) => t.url)
    .filter((u) => u.startsWith('chrome://settings'))).toEqual(['chrome://settings/languages']);
});

test('a Chinese reader with Chrome in English is offered 中文: the original first, then both, then 中文 alone', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  const fx = { page, server, cdp, extensionId, serviceWorker, provider };
  const panel = await build(fx, 'read-zh', { languages: ['en-US', 'zh-CN'] });
  expect(await panel.texts('#read-mode button')).toEqual(['English', MSG.readBoth, '中文']);
  // They read English, so the tree starts as the article wrote it.
  expect(await pressed(panel)).toBe('original');
  expect(await shown(panel, '.tr')).toEqual(Array(LINES.length).fill(false));

  // Both: each line's translation under it, tagged, as text; quotes stay the page's words.
  await panel.click('#read-mode [data-read="both"]');
  await expect.poll(() => translated(panel)).toEqual(IN_ZH);
  await panel.click('.expand-all');
  expect(await shown(panel, '.verdict .title > *')).toEqual([true, true]);
  expect(await panel.evaluate(() => [document.querySelector('.verdict .title .tr').lang, document.querySelector('.verdict .title .tr').dataset.tag]))
    .toEqual(['zh', '中文']);
  expect(await panel.evaluate(() => document.querySelectorAll('.evidence .tr, .flags .tr, .quote span').length)).toBe(0);
  expect(await panel.evaluate(() => document.querySelectorAll('#tree *:not(section, div, p, span, ol, ul, li, button)').length)).toBe(0);

  // 中文: the translation in the original's place. Hovering shows the original, then its source
  // sentence, and a click still shows that sentence on the page.
  await panel.click('#read-mode [data-read="mine"]');
  expect(await shown(panel, '.verdict .title > *')).toEqual([false, true]);
  expect(await shown(panel, '.claim[data-id="b0"] .body > *')).toEqual([false, true]);
  expect(await panel.evaluate(() => document.querySelector('.verdict .title').title))
    .toBe(`${ARTICLE_TREE.verdict}\n\n${ARTICLE_TREE.verdict_basis}`);
  expect(await panel.evaluate(() => document.querySelector('.claim[data-id="b0"] .body').title)).toBe(branches[0].body);
  await panel.click('.verdict .title');
  await expect.poll(() => highlighted(fx.page)).toEqual([ARTICLE_TREE.verdict_basis]);

  // The choice is kept; each line was translated once, by one translator.
  await expect.poll(() => fx.serviceWorker.evaluate(() => chrome.storage.local.get('read').then((s) => s.read))).toBe('mine');
  const log = await panel.evaluate(() => window.__translator);
  expect(log.created).toEqual(['en>zh']);
  expect(log.translated.toSorted()).toEqual(LINES.toSorted());
  await panel.click('#read-mode [data-read="original"]');
  expect(await shown(panel, '.verdict .title > *')).toEqual([true, false]);
});

test('an article in a language the reader does not read opens in both', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  const fx = { page, server, cdp, extensionId, serviceWorker, provider };
  const panel = await build(fx, 'read-foreign', { languages: ['zh-CN'] });
  expect(await pressed(panel)).toBe('both');
  await expect.poll(() => translated(panel)).toEqual(IN_ZH);
  // The saved tree, drawn again node by node, asks for every line again: each still reaches the
  // translator once.
  await panel.click('#build');
  await expect.poll(() => panel.text('#status')).toMatch(/^Saved tree/);
  await expect.poll(() => translated(panel)).toEqual(IN_ZH);
  expect((await panel.evaluate(() => window.__translator)).translated.toSorted()).toEqual(LINES.toSorted());
});

test('a tree shown before any click in the panel offers Chrome\'s one-time download; that click translates', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  const fx = { page, server, cdp, extensionId, serviceWorker, provider };
  const panel = await build(fx, 'read-click', { languages: ['zh-CN'] });
  // Opened again, the panel shows the saved tree with no click of the reader's in it yet.
  await panel.send('Page.reload');
  await expect.poll(() => panel.text('.verdict .title .orig').catch(() => null)).toBe(ARTICLE_TREE.verdict);
  await expect.poll(() => panel.text('#read-note-text')).toBe(MSG.translateOfferNote);
  expect(await panel.text('#read-action')).toBe(MSG.translateOffer('中文'));
  expect((await translated(panel)).titles).toEqual(['', '', '']);
  await panel.click('#read-action');
  await expect.poll(() => translated(panel)).toEqual(IN_ZH);
  expect(await shown(panel, '#read-note')).toEqual([false]);
});

test('Settings: a language chosen there replaces Chrome\'s, and Automatic goes back to Chrome\'s', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  const fx = { page, server, cdp, extensionId, serviceWorker, provider };
  const panel = await build(fx, 'read-other', { languages: ['en'] });
  expect(await shown(panel, '#read-in')).toEqual([false]);
  await panel.click('#settings summary');
  // Automatic, then the browser's languages, then all the Translator's.
  expect(await panel.evaluate(() => [...document.getElementById('translate-to').children]
    .map((e) => (e.tagName === 'OPTGROUP' ? [e.label, e.children.length, e.children[0].textContent] : [e.value, e.textContent]))))
    .toEqual([['', MSG.translateAuto], [MSG.chromesLanguages, 1, 'English'], [MSG.allLanguages, LANGUAGES.length, 'العربية']]);
  const choose = (code) => panel.evaluate((v) => {
    const select = document.getElementById('translate-to');
    select.value = v;
    select.dispatchEvent(new Event('change'));
  }, code);
  await choose('ja');
  await expect.poll(() => shown(panel, '#read-in')).toEqual([true]);
  expect(await panel.texts('#read-mode button')).toEqual(['English', MSG.readBoth, '日本語']);
  expect(await panel.text('#translation-note')).toBe(MSG.translationChosen('日本語'));
  expect(await fx.serviceWorker.evaluate(() => chrome.storage.local.get('translateTo'))).toEqual({ translateTo: 'ja' });
  await panel.click('#read-mode [data-read="both"]');
  await expect.poll(() => panel.text('.verdict .title .tr')).toBe(`[ja] ${ARTICLE_TREE.verdict}`);

  await choose('');
  await expect.poll(() => shown(panel, '#read-in')).toEqual([false]);
  expect(await fx.serviceWorker.evaluate(() => chrome.storage.local.get('translateTo'))).toEqual({});
  expect(await panel.text('#translation-note')).toBe(MSG.translationFrom('English'));
});

test('the switch\'s ▾ reads the tree in another language, which Settings then holds; Automatic goes back to Chrome\'s', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  const fx = { page, server, cdp, extensionId, serviceWorker, provider };
  const panel = await build(fx, 'read-pick', { languages: ['en-US', 'zh-CN'] });
  expect(await pressed(panel)).toBe('original');
  // The native select Chrome opens; the article's own language is not a choice.
  const pick = (code) => panel.evaluate((v) => {
    const select = document.getElementById('read-lang');
    select.value = v;
    select.dispatchEvent(new Event('change'));
  }, code);
  expect(await panel.evaluate(() => [...document.querySelectorAll('#read-lang option:disabled')].map((o) => o.value)))
    .toEqual(['en', 'en']);
  expect(await panel.evaluate(() => document.getElementById('read-lang').value)).toBe('');

  // Chosen while the tree shows the original, the language is shown, alone.
  await pick('ja');
  await expect.poll(() => panel.texts('#read-mode button')).toEqual(['English', MSG.readBoth, '日本語']);
  expect(await pressed(panel)).toBe('mine');
  await expect.poll(() => panel.text('.verdict .title .tr')).toBe(`[ja] ${ARTICLE_TREE.verdict}`);
  expect(await shown(panel, '.verdict .title > *')).toEqual([false, true]);
  expect(await fx.serviceWorker.evaluate(() => chrome.storage.local.get(['translateTo', 'read'])))
    .toEqual({ translateTo: 'ja', read: 'mine' });
  expect(await panel.evaluate(() => document.getElementById('translate-to').value)).toBe('ja');
  expect(await panel.text('#translation-note')).toBe(MSG.translationChosen('日本語'));

  await pick('');
  await expect.poll(() => panel.text('.verdict .title .tr')).toBe(`[zh] ${ARTICLE_TREE.verdict}`);
  expect(await panel.texts('#read-mode button')).toEqual(['English', MSG.readBoth, '中文']);
  expect(await fx.serviceWorker.evaluate(() => chrome.storage.local.get('translateTo'))).toEqual({});
  expect(await panel.evaluate(() => document.getElementById('translate-to').value)).toBe('');
  expect((await panel.evaluate(() => window.__translator)).created).toEqual(['en>ja', 'en>zh']);
});

test('a language the ▾ offers that Chrome cannot translate into is refused, with why, and the switch stays', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  const fx = { page, server, cdp, extensionId, serviceWorker, provider };
  const panel = await build(fx, 'read-pick-unavailable', { languages: ['en-US', 'zh-CN'], availability: { ja: 'unavailable' } });
  await panel.evaluate(() => {
    const select = document.getElementById('read-lang');
    select.value = 'ja';
    select.dispatchEvent(new Event('change'));
  });
  await expect.poll(() => panel.text('#read-note-text')).toBe(MSG.cannotTranslate('English', '日本語'));
  expect(await shown(panel, '#read-mode, #read-pick')).toEqual([true, true]);
  expect(await panel.texts('#read-mode button')).toEqual(['English', MSG.readBoth, '中文']);
  expect(await panel.evaluate(() => document.getElementById('read-lang').value)).toBe('');
  expect(await fx.serviceWorker.evaluate(() => chrome.storage.local.get('translateTo'))).toEqual({});
});

test('a pair Chrome cannot translate says so where the switch would be', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  const fx = { page, server, cdp, extensionId, serviceWorker, provider };
  const panel = await build(fx, 'read-unavailable', { languages: ['en', 'zh-CN'], availability: { zh: 'unavailable' } });
  expect(await shown(panel, '#read-in, #read-mode, #read-note')).toEqual([true, false, true]);
  expect(await panel.text('#read-note-text')).toBe(MSG.cannotTranslate('English', '中文'));
  expect(await panel.evaluate(() => window.__translator.created)).toEqual([]);
});

const note = (panel) => panel.evaluate(() => {
  const n = document.getElementById('read-note');
  return { shown: n.checkVisibility(), busy: n.classList.contains('busy'), text: n.textContent };
});

test('a language whose model is on the computer but still loading says it is translating until its lines arrive', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  const fx = { page, server, cdp, extensionId, serviceWorker, provider };
  const panel = await build(fx, 'read-loading', { languages: ['en-US', 'zh-CN'], availability: { zh: 'available' }, delay: 1500 });
  await panel.click('#read-mode [data-read="mine"]');
  expect(await note(panel)).toEqual({ shown: true, busy: true, text: MSG.translating('中文') });
  expect((await translated(panel)).titles).toEqual(['', '', '']);
  await expect.poll(() => translated(panel), { timeout: 5000 }).toEqual(IN_ZH);
  expect((await note(panel)).shown).toBe(false);
});

test('the first use of a language shows its download until its lines arrive', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  const fx = { page, server, cdp, extensionId, serviceWorker, provider };
  const panel = await build(fx, 'read-slow', { languages: ['en-US', 'zh-CN'], delay: 1500 });
  const note = () => panel.evaluate(() => {
    const n = document.getElementById('read-note');
    return { shown: n.checkVisibility(), busy: n.classList.contains('busy'), text: n.textContent };
  });
  await panel.click('#read-mode [data-read="mine"]');
  // At once, before a line has arrived: the download, then its progress.
  expect(await note()).toEqual({ shown: true, busy: true, text: MSG.downloading('中文', 0) });
  expect((await translated(panel)).titles).toEqual(['', '', '']);
  await expect.poll(note).toEqual({ shown: true, busy: true, text: MSG.downloading('中文', 0.5) });
  await expect.poll(() => translated(panel), { timeout: 5000 }).toEqual(IN_ZH);
  expect((await note()).shown).toBe(false);
});

test('a download Chrome refuses for want of a recent click offers that click, not a failure', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  const fx = { page, server, cdp, extensionId, serviceWorker, provider };
  const panel = await build(fx, 'read-deny', { languages: ['en-US', 'zh-CN'], recentClick: true });
  // The Build click's activation expires (Chromium keeps it 5 s); a script's click is not the reader's.
  await new Promise((r) => setTimeout(r, 5500));
  await panel.evaluate(() => document.querySelector('#read-mode [data-read="both"]').click());
  await expect.poll(() => panel.text('#read-note-text')).toBe(MSG.translateOfferNote);
  expect(await panel.evaluate(() => document.getElementById('read-note').classList.contains('failed'))).toBe(false);
  await panel.click('#read-action');
  await expect.poll(() => translated(panel)).toEqual(IN_ZH);
});

test('a translation that fails says why, and offers Retry', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  const fx = { page, server, cdp, extensionId, serviceWorker, provider };
  const panel = await build(fx, 'read-fail', { languages: ['zh-CN'], fail: 'The translation model could not be downloaded.' });
  const failed = MSG.translateFailed('中文', 'The translation model could not be downloaded.');
  await expect.poll(() => panel.text('#read-note-text')).toBe(failed);
  expect(await panel.evaluate(() => document.getElementById('read-note').classList.contains('failed'))).toBe(true);
  expect(await panel.text('#read-action')).toBe(MSG.retry);
  await panel.click('#read-action');
  await expect.poll(() => panel.text('#read-note-text')).toBe(failed);
});

test('without Chrome\'s Translator a reader with another language is told what it needs, and Settings says so', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  const fx = { page, server, cdp, extensionId, serviceWorker, provider };
  const panel = await build(fx, 'read-none', { languages: ['en', 'zh-CN'], missing: true });
  expect(await shown(panel, '#read-in, #read-mode, #read-note')).toEqual([true, false, true]);
  expect(await panel.text('#read-note-text')).toBe(MSG.translateNeedsChrome('中文'));
  await panel.click('#settings summary');
  expect(await panel.text('#translation-note')).toBe(MSG.translationNone);
  expect(await shown(panel, '#translate-to-row, #chrome-languages')).toEqual([false, false]);
});
