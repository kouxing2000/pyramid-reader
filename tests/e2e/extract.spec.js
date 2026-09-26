// The shipped page agent run straight in a page (no extension), on HTML fixtures written for
// these tests. SPEC §4.5: only text the reader can see is extracted.
import { test, expect } from './fixtures.js';
import { pageAgent } from '../../src/content/page.js';

const extract = (page) => page.evaluate(pageAgent, { op: 'extract' });
// Fixture paragraphs start with a label naming their expected fate (VISIBLE-3, COVERED-1, ...).
const labels = (result) => result.paragraphs.map((p) => p.text.split(' ')[0]);

test('each way of hiding text keeps its paragraph out, and ordinary paragraphs stay in', async ({ page, server }) => {
  await page.goto(server.url('hidden.html'));
  const result = await extract(page);
  expect(labels(result)).toEqual(['VISIBLE-1', 'VISIBLE-2', 'VISIBLE-3', 'VISIBLE-4', 'VISIBLE-5', 'VISIBLE-6',
    'VISIBLE-7']);
  // hidden: display, visibility, opacity, [hidden], closed <details>, screen-reader-only, blur,
  //   transparent colour
  // clipped: off the document's left edge, below a preview's cut (directly, through a clearfix
  //   box, in an unreachable scroll box), by the paragraph's own box, by a line clamp
  // covered: an opaque overlay (two paragraphs), a gradient fade, an overlay over a teaser's
  //   tail, an overlay escaping an empty clipping wrapper, a ::after white-out placed against a
  //   transformed container, a ::after white-out
  expect(result.skipped).toEqual({ hidden: 8, clipped: 7, covered: 7 });
});

test('a paragraph behind a paywall overlay is not extracted; the article around it is', async ({ page, server }) => {
  await page.goto(server.url('article.html'));
  const { paragraphs, skipped } = await extract(page);
  const texts = paragraphs.map((p) => p.text);
  expect(texts.some((t) => t.includes('paywall'))).toBe(false);
  expect(skipped).toEqual({ hidden: 0, clipped: 0, covered: 1 });
  // Only the <article>: not nav, footer, aside (nor an <article> card inside one), figure, nor
  // main's text outside the article.
  expect(texts).toEqual([
    'A county that counts its footbridges discovers that maintenance, not construction, decides their fate.',
    'By Staff.',
    'The county surveyed all 214 of its footbridges last spring and found that 61 needed repairs within five years.',
    'Engineers said the cheapest bridges to build were often the most expensive to keep, because timber decks rot faster than anyone budgets for.',
    'Officials cautioned that the survey may undercount damage, since inspectors could reach only the bridges that were not flooded that season.',
    'Residents in the northern villages rely on the bridges to reach the only clinic, which makes a closed crossing a two-hour detour.',
    'A council report estimated the backlog at 3.2 million, though it remains unclear whether that figure includes the flooded crossings.',
    'Some councillors argue the money would be better spent on a single road bridge; others say that would strand the smallest hamlets entirely.',
    'The council will publish a ranked repair list in the autumn, and residents can comment on it for six weeks after that.',
  ]);
  expect(paragraphs.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(paragraphs.map((p) => p.heading)).toEqual([null, null, 'What the survey found', 'What the survey found',
    'What the survey found', 'Why it matters', 'Why it matters', 'Why it matters', 'What happens next']);
});

test('a fixed backdrop over the whole viewport covers every paragraph at every scroll position', async ({ page, server }) => {
  await page.goto(server.url('gate.html?mode=backdrop'));
  const result = await extract(page);
  expect(result.paragraphs).toEqual([]);
  expect(result.skipped).toEqual({ hidden: 0, clipped: 0, covered: 5 });
});

test('a native modal dialog\'s opaque ::backdrop covers the page even though it still scrolls', async ({ page, server }) => {
  await page.goto(server.url('gate.html?mode=dialog'));
  expect(await page.evaluate(() => document.querySelector('dialog:modal') !== null)).toBe(true);
  const result = await extract(page);
  expect(result.paragraphs).toEqual([]);
  expect(result.skipped).toEqual({ hidden: 0, clipped: 0, covered: 5 });
});

test('a modal backdrop drawn at z-index -1 inside the raised modal still covers the page', async ({ page, server }) => {
  await page.goto(server.url('gate.html?mode=pseudo'));
  const result = await extract(page);
  expect(result.paragraphs).toEqual([]);
  expect(result.skipped).toEqual({ hidden: 0, clipped: 0, covered: 5 });
});

test('a scroll-locked page shows one screen: text below it is cut off, text under the dialog is covered', async ({ page, server }) => {
  await page.goto(server.url('gate.html?mode=locked'));
  const result = await extract(page);
  expect(labels(result)).toEqual(['GATED-1', 'GATED-3']);
  expect(result.skipped).toEqual({ hidden: 0, clipped: 2, covered: 1 });
});

test('pinning <body> with position: fixed locks scrolling just like overflow: hidden', async ({ page, server }) => {
  await page.goto(server.url('gate.html?mode=fixed'));
  const result = await extract(page);
  expect(labels(result)).toEqual(['GATED-1', 'GATED-3']);
  expect(result.skipped).toEqual({ hidden: 0, clipped: 2, covered: 1 });
});

test('the backdrop is found in quirks mode too, where <html> is not the viewport', async ({ page, server }) => {
  await page.goto(server.url('gate-quirks.html'));
  expect(await page.evaluate(() => document.compatMode)).toBe('BackCompat');
  const result = await extract(page);
  expect(result.paragraphs).toEqual([]);
  expect(result.skipped).toEqual({ hidden: 0, clipped: 0, covered: 5 });
});

test('a dialog on a page that still scrolls hides nothing: the text scrolls past it', async ({ page, server }) => {
  await page.goto(server.url('gate.html?mode=open'));
  const result = await extract(page);
  expect(labels(result)).toEqual(['GATED-1', 'GATED-2', 'GATED-3', 'GATED-4', 'GATED-5']);
});

for (const mode of ['shell', 'overlay']) {
  test(`text in a scrolling box (${mode}) is all readable, wherever the box is scrolled to`, async ({ page, server }) => {
    await page.goto(server.url(`shell.html?mode=${mode}`));
    // SCROLL-1 and -2 above the box's view, SCROLL-5 under the fixed cookie bar (y 640-720).
    await page.evaluate(() => { document.getElementById('app').scrollTop = 652; });
    expect(await page.evaluate(() => document.querySelectorAll('p')[4].getBoundingClientRect().top)).toBe(660);
    const result = await extract(page);
    expect(labels(result)).toEqual(['SCROLL-1', 'SCROLL-2', 'SCROLL-3', 'SCROLL-4', 'SCROLL-5', 'SCROLL-6']);
    expect(result.skipped).toEqual({ hidden: 0, clipped: 0, covered: 0 });
  });
}

test('layout that overlaps text without hiding it keeps every paragraph', async ({ page, server }) => {
  await page.goto(server.url('layout.html'));
  // Scrolled, so the sticky masthead and the fixed cookie bar both sit over article text. The
  // page also holds a closed drawer whose menu has a full-viewport ::before backdrop, and a
  // transformed card whose ::after is placed against the card, not the article.
  await page.evaluate(() => scrollTo(0, 200));
  const result = await extract(page);
  expect(labels(result)).toEqual(['KEEP-float', 'KEEP-deco', 'KEEP-share', 'KEEP-raised', 'KEEP-card',
    'KEEP-scroll-1', 'KEEP-scroll-2', 'KEEP-scroll-3', 'KEEP-under-cookie', 'KEEP-last']);
  expect(result.skipped).toEqual({ hidden: 0, clipped: 0, covered: 0 });
});

test('paragraph text is what the reader sees: collapsed whitespace, no hidden inline text or citation markers', async ({ page, server }) => {
  await page.goto(server.url('text.html'));
  const { paragraphs } = await extract(page);
  expect(paragraphs).toEqual([
    { n: 1, heading: 'First section',
      text: 'Whitespace runs collapse to single spaces, and inline markup links read straight through.' },
    { n: 2, heading: 'First section', text: 'The river is 12 km long and drains an area of 40 km2 in total.' },
    { n: 3, heading: 'A subsection', text: 'Read the full report here before the council meets again.' },
    { n: 4, heading: 'A subsection', text: 'Short one.' },
    { n: 5, heading: 'A subsection', text: expect.stringMatching(/^A long paragraph for scrolling\..*is due\.$/) },
  ]);
});
