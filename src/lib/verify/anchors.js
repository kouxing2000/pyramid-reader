// Where a node's words are on the page (SPEC §4.1, decision 4): the verdict's and each claim's
// `basis` sentence, and each evidence quote, located in the paragraphs by one normalized match
// and returned as offsets into that paragraph's extracted text, which the page agent highlights.
import { hasNumber } from './numbers.js';
import { normalize } from './text.js';

// What a model adds around a copied passage: quote marks, brackets, closing punctuation.
const EDGES = /^[\s"'.,;:!?()[\]-]+|[\s"'.,;:!?()[\]-]+$/g;
const WORD_CHAR = /[\p{L}\p{N}]/u;

// A match may not begin or end inside a word or a number: "10%" is not in "110%".
const bounded = (norm, i, needle) =>
  !(WORD_CHAR.test(needle[0]) && WORD_CHAR.test(norm[i - 1] ?? '')) &&
  !(WORD_CHAR.test(needle.at(-1)) && WORD_CHAR.test(norm[i + needle.length] ?? ''));

/**
 * The first place the passage occurs as whole words, looking in the cited paragraphs first, in
 * citation order, then in the rest. Quote and dash variants, case and spacing do not matter, nor
 * do quote marks or punctuation at its edges; a full stop, question or exclamation mark the passage
 * ends with is kept in the match when the page has it there too.
 * @param {{n: number, norm: string, map: number[]}[]} paragraphs
 * @returns {{n: number, start: number, end: number, cited: boolean} | null}
 *   [start, end) indexes the paragraph's own text
 */
function locate(passage, paragraphs, src) {
  const full = normalize(passage).norm;
  const needle = full.replace(EDGES, '');
  if (!WORD_CHAR.test(needle)) return null;
  const stop = full.replace(/["')\]\s]+$/, '').at(-1);
  const rest = paragraphs.map((p) => p.n).filter((n) => !src.includes(n));
  for (const n of [...src, ...rest]) {
    const { norm, map } = paragraphs[n - 1];
    for (let i = norm.indexOf(needle); i >= 0; i = norm.indexOf(needle, i + 1)) {
      if (!bounded(norm, i, needle)) continue;
      let end = i + needle.length;
      if ('.!?'.includes(stop ?? '-') && norm[end] === stop) end++;
      return { n, start: map[i], end: map[end - 1] + 1, cited: src.includes(n) };
    }
  }
  return null;
}

/**
 * The node with its `anchor`:
 *   {status: 'anchored', n, start, end, sentence}  found in a paragraph it cites
 *   {status: 'repaired', ..., from}                 found in another paragraph, which the node now
 *                                                   cites: evidence in its place (a quote comes
 *                                                   from one paragraph), a claim or the verdict in
 *                                                   addition; `from` is the model's `src`
 *   {status: 'unanchored'}                          not on the page
 *   {status: 'derived'}                             a value the model computed and declared; it
 *                                                   is honoured only when it states a number, and
 *                                                   anything else is located like a quote
 * `sentence` is the whole sentence around the match, for the panel's tooltip.
 * @param {{n: number, text: string, norm: string, map: number[], sentences: {start, end}[]}[]} paragraphs
 */
export function anchorNode(node, paragraphs) {
  const evidence = node.type === 'evidence';
  if (evidence && node.derived && hasNumber(node.quote)) return { ...node, anchor: { status: 'derived' } };
  const hit = locate(evidence ? node.quote : node.basis, paragraphs, node.src);
  if (!hit) return { ...node, anchor: { status: 'unanchored' } };
  const { n, start, end, cited } = hit;
  const anchor = { status: cited ? 'anchored' : 'repaired', n, start, end, sentence: sentenceAround(paragraphs[n - 1], start, end) };
  if (cited) return { ...node, anchor };
  return { ...node, src: evidence ? [n] : [...node.src, n], anchor: { ...anchor, from: node.src } };
}

// The sentence (or run of sentences) of paragraph p that holds [start, end).
function sentenceAround(p, start, end) {
  const inside = p.sentences.filter((s) => s.end > start && s.start < end);
  return inside.length ? p.text.slice(inside[0].start, inside.at(-1).end) : p.text.slice(start, end);
}
