// Offsets into a paragraph's extracted text become a DOM Range, highlighted with the CSS Custom
// Highlight API and scrolled into view, without touching the page's DOM.
import { test, expect } from './fixtures.js';
import { pageAgent } from '../../src/content/page.js';
import { highlighted } from './page-checks.js';

const agent = (page, req) => page.evaluate(pageAgent, req);

test.beforeEach(async ({ page, server }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // instant scrolling
  await page.goto(server.url('text.html'));
});

test('showing a paragraph scrolls it into view and highlights all of it, without DOM changes', async ({ page }) => {
  const { paragraphs } = await agent(page, { op: 'extract' });
  const last = paragraphs.at(-1);
  const inView = () => page.evaluate(() => {
    const r = document.querySelectorAll('p')[4].getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight;
  });
  expect(await inView()).toBe(false);
  const html = await page.evaluate(() => document.documentElement.outerHTML);

  expect(await agent(page, { op: 'show', n: last.n })).toEqual({ ok: true });
  expect(await highlighted(page)).toEqual([last.text]);
  await expect.poll(inView).toBe(true);
  expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(html);
});

test('offsets select exactly that span, across inline markup and collapsed whitespace', async ({ page }) => {
  const { paragraphs: [p1] } = await agent(page, { op: 'extract' });
  for (const phrase of ['inline markup links', 'runs collapse to single', 'Whitespace', 'straight through.']) {
    const start = p1.text.indexOf(phrase);
    expect(await agent(page, { op: 'show', n: 1, start, end: start + phrase.length })).toEqual({ ok: true });
    expect(await highlighted(page)).toEqual([phrase]);
  }
});

test('a span can run across text the extraction dropped (a citation marker, screen-reader text)', async ({ page }) => {
  const { paragraphs } = await agent(page, { op: 'extract' });
  const span = async (n, phrase) => {
    const start = paragraphs[n - 1].text.indexOf(phrase);
    expect(await agent(page, { op: 'show', n, start, end: start + phrase.length })).toEqual({ ok: true });
    return (await highlighted(page))[0];
  };
  // The range's ends land on the right characters; the dropped text in between is inside it.
  expect(await span(2, '12 km long and drains')).toBe('12 km long[1] and drains');
  expect(await span(3, 'here before')).toBe('here (opens in a new tab) before');
});

test('a paragraph that left the page, or whose text changed, is reported stale', async ({ page }) => {
  await agent(page, { op: 'extract' });
  await page.evaluate(() => document.querySelectorAll('p')[0].remove());
  expect(await agent(page, { op: 'show', n: 1 })).toEqual({ ok: false, reason: 'stale' });
  await page.evaluate(() => { document.querySelectorAll('p')[0].append(' More.'); });
  expect(await agent(page, { op: 'show', n: 2 })).toEqual({ ok: false, reason: 'stale' });
  expect(await highlighted(page)).toBeNull();
});

test('out-of-range offsets are refused, and clear removes the highlight', async ({ page }) => {
  const { paragraphs: [p1] } = await agent(page, { op: 'extract' });
  for (const [start, end] of [[5, 5], [-1, 3], [0, p1.text.length + 1], [1.5, 4]]) {
    expect(await agent(page, { op: 'show', n: 1, start, end })).toEqual({ ok: false, reason: 'bad-range' });
  }
  expect(await agent(page, { op: 'show', n: 99 })).toEqual({ ok: false, reason: 'stale' });
  await agent(page, { op: 'show', n: 1 });
  expect(await highlighted(page)).toEqual([p1.text]);
  expect(await agent(page, { op: 'clear' })).toEqual({ ok: true });
  expect(await highlighted(page)).toBeNull();
});
