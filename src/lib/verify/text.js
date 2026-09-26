// Text helpers the checks share: a normalized form that keeps a map back to the page's own
// offsets, and sentence boundaries.

// Characters a model may write for another: curly quotes, dash variants, odd spaces.
const SAME = new Map([
  ...[...'‘’‚‛′`'].map((c) => [c, "'"]),
  ...[...'“”„‟″'].map((c) => [c, '"']),
  ...[...'‐‑‒–—―−'].map((c) => [c, '-']),
]);
const INVISIBLE = /[\u00ad\u200b-\u200d\u2060\ufeff]/;
const SPACE = /\s/;

/**
 * The text as the checks compare it: quote and dash variants unified, invisible characters
 * dropped, whitespace runs collapsed to one space, lowercase. map[i] is the offset in `text` of
 * norm[i], so a match in the normalized form maps back to the page's exact characters.
 * @returns {{norm: string, map: number[]}}
 */
export function normalize(text) {
  let norm = '';
  const map = [];
  let space = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (INVISIBLE.test(c)) continue;
    if (SPACE.test(c)) {
      space = norm.length > 0;
      continue;
    }
    if (space) {
      norm += ' ';
      map.push(i - 1);
      space = false;
    }
    const lower = (SAME.get(c) ?? c).toLowerCase();
    norm += lower.length === 1 ? lower : c; // a case mapping that changes length would shift offsets
    map.push(i);
  }
  return { norm, map };
}

// A sentence break after one of these is an abbreviation, not the end of the sentence; a single
// letter is an initial, except the word "I".
const ABBREVIATION = /(?:^|[\s(.])(?:mr|mrs|ms|dr|prof|st|jr|sr|gen|col|lt|capt|sgt|gov|sen|rep|rev|hon|vs|approx|inc|ltd|corp|e\.g|i\.e|(?!i\.)[a-z])\.["')\]]*\s*$/i;
const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

/**
 * The sentences of a paragraph as [start, end) offsets, trailing space excluded. Intl.Segmenter
 * finds the breaks; a break right after a title or an initial ("Mrs.", "U.S.", "B. Raymond") is
 * joined back.
 * @returns {{start: number, end: number}[]}
 */
export function sentences(text) {
  const out = [];
  for (const { segment, index } of segmenter.segment(text)) {
    const prev = out.at(-1);
    if (prev && ABBREVIATION.test(text.slice(prev.start, prev.end))) prev.end = index + segment.length;
    else out.push({ start: index, end: index + segment.length });
  }
  for (const s of out) while (s.end > s.start && SPACE.test(text[s.end - 1])) s.end--;
  return out.filter((s) => s.end > s.start);
}
