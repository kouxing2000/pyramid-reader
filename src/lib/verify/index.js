// The per-node verify hook buildTree() runs before a node is shown (SPEC §6 verify/): locate its
// source on the page, and check its numbers against what it cites.
import { anchorNode } from './anchors.js';
import { numberFlags, numbersIn } from './numbers.js';
import { normalize, sentences } from './text.js';

/**
 * @param {{n: number, text: string}[]} paragraphs  the page's paragraphs, numbered from 1 in order
 * @returns {(node: object) => object}  a readyNodes() node, returned with
 *   anchor: see anchorNode(); src: repaired when the anchor was found in an uncited paragraph;
 *   flags: [{type: 'number', ...}], empty when every check passed
 *   It throws a RangeError for a node citing a paragraph the page does not have. In a build,
 *   readyNodes() rejects such a node first, as an answer to retry; a caller that skips it, such
 *   as the eval on raw model output, gets this error instead of a failed lookup.
 */
export function verifier(paragraphs) {
  const page = paragraphs.map(({ n, text }) => ({
    n, text, ...normalize(text), sentences: sentences(text),
    numbers: new Set(numbersIn(text).map((x) => x.value)),
  }));
  return (node) => {
    const bad = node.src.findIndex((n) => !(Number.isInteger(n) && n >= 1 && n <= page.length));
    if (bad >= 0) throw new RangeError(`${node.id} cites ¶${node.src[bad]}; the page has ¶1-¶${page.length}`);
    const anchored = anchorNode(node, page);
    return { ...anchored, flags: anchored.type === 'evidence' ? [] : numberFlags(anchored, page) };
  };
}
