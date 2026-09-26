// The guard on what the eval commits (AGENTS.md: never commit article text): a file bound for git
// may not repeat RUN words in a row from any page it measured. Quotes and basis sentences are the
// pages' own words, so trees stay in the run's gitignored local/ directory; this catches the text
// that slips into a note, a title or a flag.
const RUN = 8;

// A Han, kana or hangul character is a word of its own: those scripts put no spaces between words.
const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}';
const WORD = new RegExp(`[${CJK}]|(?:(?![${CJK}])[\\p{L}\\p{N}'])+`, 'gu');
const words = (text) => text.toLowerCase().replace(/[’‘]/g, "'").match(WORD) ?? [];

/** Every run of RUN words in the pages' paragraphs. */
export function pageRuns(pages) {
  const runs = new Set();
  for (const page of pages) {
    for (const p of page.paragraphs) {
      const w = words(p.text);
      for (let i = 0; i + RUN <= w.length; i++) runs.add(w.slice(i, i + RUN).join(' '));
    }
  }
  return runs;
}

/**
 * The runs of page text that `text` repeats, first occurrence each. URLs are left out: the eval
 * commits them, and a headline in a URL's slug repeats the page's own words.
 */
export function leaks(text, runs) {
  const w = words(text.replace(/https?:\/\/[^\s"'<>)\]]+/g, ' '));
  const found = new Set();
  for (let i = 0; i + RUN <= w.length; i++) {
    const run = w.slice(i, i + RUN).join(' ');
    if (runs.has(run)) found.add(run);
  }
  return [...found];
}
