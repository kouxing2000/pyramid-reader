// Draws the tree's nodes (lib/tree.js readyNodes() shapes, checked by lib/verify) as they stream
// in (SPEC §5.2), with each node's check results (SPEC §5.3).
//
//   #tree
//     section.verdict[data-id=verdict] > .node, p.summary
//     p.claims-head > span, button.expand-all
//     ol.claims > li.claim[data-id=b0] > .node, ol.evidence > li.evidence[data-id=b0.0] > .node
//
// A claim is folded to its number, title and check; its flags stay out of the fold, and a claim
// with a quote not on the page opens (SPEC §4.2: a failure is shown). Opening a claim (li.open)
// shows its body, sources and evidence.
// A node's text is a button.go that shows its source on the page: the exact sentence or quote
// when it was found, else the first paragraph it cites; hovering shows the source sentence, which
// the button also keeps in data-tip.
// The verdict, the titles and the bodies are each span.orig, the tree's text, then span.tr, empty
// until panel.js puts its translation there (translate.js); quotes are the page's words, and have
// none.
import { el } from './dom.js';
import { MSG } from './messages.js';

// Each cited paragraph as a button; the panel scrolls the page to it on click.
const cites = (src) => el('span', { class: 'cites' },
  src.map((n) => el('button', { type: 'button', class: 'cite', 'data-n': n }, `¶${n}`)));
// Text the panel may translate: the tree's own, then its translation's place.
const translatable = (text) => [el('span', { class: 'orig' }, text), el('span', { class: 'tr' })];

// The node's text, as a button that shows where it comes from.
function go(cls, text, { anchor, src }) {
  const found = anchor.status === 'anchored' || anchor.status === 'repaired';
  const tip = found ? anchor.sentence : MSG.unanchoredTip;
  return el('button', {
    type: 'button', class: `go ${cls}`, 'data-n': found ? anchor.n : src[0], title: tip, 'data-tip': tip,
    ...(found && { 'data-start': anchor.start, 'data-end': anchor.end }),
  }, cls === 'title' ? translatable(text) : text);
}

const CHECKS = {
  anchored: () => [MSG.anchored, MSG.anchoredTip],
  repaired: ({ n, from }) => [MSG.repaired(n), MSG.repairedTip(from, n)],
  unanchored: () => [MSG.unanchored, MSG.unanchoredTip],
};
// Each check text is its mark, a space, then its words; the mark and the words are separate spans
// so that a claim row can show the mark alone.
function check({ anchor }) {
  const [text, tip] = CHECKS[anchor.status]?.(anchor) ?? [];
  if (!text) return null;
  const space = text.indexOf(' ');
  return el('span', { class: 'check', 'data-status': anchor.status, title: tip },
    el('span', { class: 'mark', 'aria-hidden': 'true' }, text.slice(0, space)), el('span', { class: 'label' }, text.slice(space)));
}

// What the checks found.
const FLAGS = {
  number: (f) => MSG.numberMissing(f.value, f.foundIn),
};
function flags(node) {
  if (!node.flags?.length) return null;
  return el('ul', { class: 'flags' }, node.flags.map((f) => el('li', { class: 'flag', 'data-type': f.type }, FLAGS[f.type](f))));
}

const VIEWS = {
  verdict: (node) => el('div', { class: 'node' },
    el('span', { class: 'kind' }, node.kind),
    go('title', node.title, node),
    el('p', { class: 'meta' }, cites(node.src), ' ', check(node)),
    flags(node)),
  claim: (node) => el('div', { class: 'node' },
    el('span', { class: 'num', 'aria-hidden': 'true' }, String(Number(node.id.slice(1)) + 1)),
    go('title', node.title, node),
    el('span', { class: 'side' }, check(node),
      el('button', { type: 'button', class: 'fold', 'aria-expanded': 'false' }, '›')),
    flags(node),
    el('div', { class: 'more' },
      el('p', { class: 'body', 'data-tip': '' }, translatable(node.body)),
      el('p', { class: 'meta' }, cites(node.src)))),
  evidence: (node) => el('div', { class: 'node' },
    node.anchor.status === 'derived'
      ? el('p', { class: 'value' }, node.quote, ' ', el('span', { class: 'tag' }, MSG.derived))
      : go('quote', node.quote, node),
    el('p', { class: 'meta' }, cites(node.src), ' ', check(node))),
};

/** Opens or folds a claim (li.claim): its body, sources and evidence show only when open. */
export function setOpen(claim, open) {
  claim.classList.toggle('open', open);
  const fold = claim.querySelector(':scope > .node .fold');
  fold?.setAttribute('aria-expanded', String(open));
  fold?.setAttribute('title', open ? MSG.foldOpenTip : MSG.foldTip);
}

/** Draws node in root, or redraws it in place when root already shows a node with its id. */
export function drawNode(root, node) {
  const view = VIEWS[node.type](node);
  const shown = [...root.querySelectorAll('[data-id]')].find((e) => e.dataset.id === node.id);
  if (shown) {
    shown.querySelector(':scope > .node').replaceWith(view);
    if (node.type === 'claim') setOpen(shown, shown.classList.contains('open'));
    return;
  }

  if (node.type === 'verdict') return root.prepend(el('section', { class: 'verdict', 'data-id': node.id }, view));
  if (node.type === 'claim') {
    const claims = root.querySelector(':scope > ol.claims') ?? root.appendChild(el('ol', { class: 'claims' }));
    if (!root.querySelector(':scope > .claims-head')) {
      claims.before(el('p', { class: 'claims-head' }, el('span', {}, MSG.claims),
        el('button', { type: 'button', class: 'expand-all', 'aria-pressed': 'false', title: MSG.expandAllTip }, MSG.expandAll)));
    }
    const li = claims.appendChild(el('li', { class: 'claim', 'data-id': node.id }, view, el('ol', { class: 'evidence' })));
    // A claim arriving after "Expand all" opens like the rest.
    return setOpen(li, root.querySelector('.expand-all').getAttribute('aria-pressed') === 'true');
  }
  const parent = [...root.querySelectorAll('li.claim')].find((e) => e.dataset.id === node.parent);
  parent.querySelector(':scope > ol.evidence').append(el('li', { class: 'evidence', 'data-id': node.id }, view));
  // A quote not on the page is a failed check, and a failure is never folded away (SPEC §4.2, §5.3).
  if (node.anchor.status === 'unanchored') setOpen(parent, true);
}

/**
 * Under the verdict: how many of the tree's sources were found on the page, and how many flags
 * the checks raised. Nothing until the verdict is drawn.
 * @param {Iterable<object>} nodes  the nodes drawn so far
 */
export function drawSummary(root, nodes) {
  const verdict = root.querySelector(':scope > section.verdict');
  if (!verdict) return;
  let found = 0, total = 0, flagged = 0;
  for (const node of nodes) {
    if (node.anchor.status !== 'derived') total++;
    if (node.anchor.status === 'anchored' || node.anchor.status === 'repaired') found++;
    flagged += node.flags?.length ?? 0;
  }
  const summary = verdict.querySelector(':scope > .summary') ?? verdict.appendChild(el('p', { class: 'summary' }));
  summary.textContent = MSG.summary(found, total, flagged);
}
