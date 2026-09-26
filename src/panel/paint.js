// What the page shows of the tree (the painted page): each claim's sentences in the claim's colour,
// and the verdict's in grey. Only what was found on the page is painted, so paint means checked: an
// unanchored node and a computed value have no sentence to paint. The page agent's paint op draws it (content/page.js).

// The paint modes: every claim, only the claim the reader picked, or none.
export const PAINT_MODES = ['all', 'focus', 'off'];
const HUES = 5; // pr-c1..pr-c5 in content/page.js HIGHLIGHT_CSS

const FOUND = new Set(['anchored', 'repaired']);

/** The claim a node belongs to: 'verdict', or a claim id such as 'b0' for b0 and its evidence b0.1. */
export const claimOf = (node) => (node.type === 'verdict' ? 'verdict' : node.id.split('.')[0]);

/** A claim's highlight: 'v' for the verdict, 'c1'..'c5' for claims b0..b4 (and on round again). */
export const hueOf = (claim) => (claim === 'verdict' ? 'v' : `c${(Number(claim.slice(1)) % HUES) + 1}`);

/**
 * @param {Iterable<object>} nodes  the tree's checked nodes (lib/verify shapes), in reading order
 * @param {{mode?: 'all'|'focus'|'off', focus?: string|null}} state  focus: the claim picked
 *   ('verdict' or a claim id); in focus mode only it is painted, and nothing when none is picked
 * @returns {{marks: {h: string, id: string, n: number, start: number, end: number}[]}}  a mark
 *   per node found on the page, in its claim's highlight
 */
export function paintPlan(nodes, { mode = 'all', focus = null } = {}) {
  const marks = [];
  if (mode === 'off') return { marks };
  for (const node of nodes) {
    const id = claimOf(node);
    if (!FOUND.has(node.anchor.status) || (mode === 'focus' && id !== focus)) continue;
    const { n, start, end } = node.anchor;
    marks.push({ h: hueOf(id), id, n, start, end });
  }
  return { marks };
}
