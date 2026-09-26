// Page-side code. `pageAgent` is injected with chrome.scripting.executeScript({ func }) into the
// extension's isolated world, and tests hand the same function to Playwright's page.evaluate, so
// it must stay self-contained: every helper lives inside it, nothing from module scope. The demo
// page, which cannot be scripted, imports it and runs it itself.

// What paints pageAgent's highlights. The panel inserts it into a web page with the default AUTHOR
// origin (Chrome does not paint ::highlight() rules from a USER-origin sheet); either way it is not
// part of the page's DOM. The demo page adds it to its own head.
//   pyramid-reader  the sentence shown by a click: solid, above the paint
//   pr-c1..pr-c5    each claim's sentences (with its evidence), in its colour at a quarter strength
//                   so text stays readable on light and dark pages; the text colour is never set.
//                   Okabe-Ito hues, told apart with the common colour-vision deficiencies.
//   pr-v            the verdict's sentence, grey
export const PAINT_HUES = ['0 114 178', '230 159 0', '0 158 115', '204 121 167', '240 228 66'];
export const HIGHLIGHT_CSS = [
  '::highlight(pyramid-reader) { background-color: #ffd54f !important; color: #000 !important; }',
  ...PAINT_HUES.map((rgb, i) => `::highlight(pr-c${i + 1}) { background-color: rgb(${rgb} / 0.25) !important; }`),
  '::highlight(pr-v) { background-color: rgb(128 128 128 / 0.22) !important; }',
].join('\n');

/**
 * @param {{op: 'extract'} | {op: 'show', n: number, start?: number, end?: number, reading?: string} |
 *   {op: 'paint', gen: number, marks: {h: string, id: string, n: number, start: number, end: number}[],
 *    reading?: string} |
 *   {op: 'clear', paint?: boolean}} req
 *   extract: number the page's visible paragraphs (SPEC §4.5) and remember their elements under
 *            a new `reading` id, which the result names.
 *   show:    scroll to paragraph n of that reading (the latest by default) and highlight characters
 *            [start, end) of its extracted text (the whole paragraph by default) with the CSS
 *            Custom Highlight API.
 *   paint:   replace the page's paint (pr-* highlights, see HIGHLIGHT_CSS) with these ranges of that
 *            reading: each mark in highlight pr-<h>, reported to the panel as claim `id`. A range
 *            whose paragraph changed is skipped, the rest still paint. In the
 *            extension, the first paint also starts the watcher, which tells the panel what the
 *            reader points at, clicks and scrolls to, and clears the paint when the panel lets go
 *            of it: the panel holds a port named `pr-paint:<gen>` while paint `gen` is on screen.
 *   clear:   remove the highlight; with paint, the paint too, and stop the watcher.
 * @returns extract -> {reading, title, paragraphs: [{n, text, heading}], skipped: {hidden, clipped, covered}}
 *          show    -> {ok: true} | {ok: false, reason: 'stale' | 'bad-range'}
 *          paint   -> {ok: true, stale: number}  the ranges skipped
 *          clear   -> {ok: true}
 */
export function pageAgent(req) {
  const HIGHLIGHT = 'pyramid-reader';
  // The article body is the first of article / main / body holding MIN_PARAGRAPHS rendered
  // <p>s of MIN_CHARS or more (prototype/read.py); every rendered <p> in it is then listed, short
  // ones included, since a short paragraph can still be the one a quote comes from.
  const MIN_CHARS = 40;
  const MIN_PARAGRAPHS = 5;
  // A paywall hides whole lines (an overlay, a fade, a clipped box), so a paragraph is left out
  // when any line of it is more than MAX_HIDDEN clipped or covered; a small overlap, such as a
  // share button over a word, is tolerated. Lines are sampled every SAMPLE_PX.
  const MAX_HIDDEN = 0.25;
  const SAMPLE_PX = 24;
  const GATE_SHARE = 0.9; // a fixed layer this much of the viewport covers every scroll position
  const SCOPES = ['article', 'main', 'body'];
  const CHROME = 'nav, footer, aside, figure, figcaption, table, dialog, [role="dialog"], [aria-modal="true"]';
  const WS = /\s/;
  // checkVisibility() options under both names: opacityProperty / visibilityProperty arrived in
  // Chrome 121, the manifest allows 116, and an unknown option is silently ignored.
  const SEEN = { opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true };
  // The top layer paints above everything else: a modal <dialog>, an open popover, a fullscreen
  // element, and the ::backdrop each one draws over the whole viewport.
  const TOP_LAYER = ':modal, :popover-open, :fullscreen';
  // Readings kept for show: a newer read of the page (the panel checking for a saved tree) must
  // not renumber the paragraphs of a tree already on screen.
  const READINGS_KEPT = 8;

  const styles = new Map();
  const style = (el, pseudo = null) => {
    const key = pseudo ? `${pseudo}` : el;
    let byEl = styles.get(el);
    if (!byEl) styles.set(el, (byEl = new Map()));
    if (!byEl.has(key)) byEl.set(key, getComputedStyle(el, pseudo));
    return byEl.get(key);
  };

  // ---- text: what a paragraph says, and where each character lives in the DOM ----

  const inlineHidden = new Map();
  // Inline content inside a visible paragraph that the reader still does not see: screen-reader-
  // only text (a clipped 1px box) and bracketed citation markers like [1] or [citation needed].
  const hiddenInline = (el) => {
    if (inlineHidden.has(el)) return inlineHidden.get(el);
    const s = style(el);
    const r = el.getBoundingClientRect();
    const hidden = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName) ||
      (el.tagName === 'SUP' && /^\s*\[[^\]]*\]\s*$/.test(el.textContent)) ||
      ((r.width <= 1 || r.height <= 1) && (s.overflow !== 'visible' || s.clip !== 'auto'));
    inlineHidden.set(el, hidden);
    return hidden;
  };
  // Glyphs filled with a fully transparent colour are invisible, unless an element up to the
  // paragraph paints its background through them (background-clip: text, for gradient text).
  const transparentText = (parent, root) => {
    if (alpha(style(parent).webkitTextFillColor) > 0) return false;
    for (let el = parent; el; el = el.parentElement) {
      if (style(el).backgroundClip === 'text') return false;
      if (el === root) break;
    }
    return true;
  };
  const textShown = (node, root) => {
    const parent = node.parentElement;
    if (!parent.checkVisibility(SEEN)) return false;
    for (let el = parent; el && el !== root; el = el.parentElement) if (hiddenInline(el)) return false;
    return !transparentText(parent, root);
  };

  // The paragraph's text as the reader sees it: shown text nodes in order, whitespace runs
  // collapsed to one space, <br> read as a space, trimmed. map[i] is the DOM position [node,
  // offset] of text[i], so offsets into the text become a DOM Range.
  const textOf = (root, withMap = false) => {
    let text = '';
    const map = withMap ? [] : null;
    const nodes = [];
    let space = null;
    const push = (ch, pos) => {
      if (WS.test(ch)) {
        if (text && !space) space = pos;
        return;
      }
      if (space) {
        text += ' ';
        map?.push(space);
        space = null;
      }
      text += ch;
      map?.push(pos);
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => n.nodeType === Node.ELEMENT_NODE
        ? (n.tagName === 'BR' || !hiddenInline(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
        : (textShown(n, root) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    for (let n; (n = walker.nextNode());) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        if (n.tagName === 'BR') push(' ', [n.parentNode, [...n.parentNode.childNodes].indexOf(n)]);
        continue;
      }
      nodes.push(n);
      for (let i = 0; i < n.data.length; i++) push(n.data[i], [n, i]);
    }
    return { text, map, nodes };
  };

  // ---- visibility: is this paragraph rendered where the reader can see it? ----

  const docEl = document.documentElement;
  const body = document.body;
  const scroller = document.scrollingElement ?? docEl;
  const rootStyle = style(docEl);
  // The viewport takes <html>'s overflow, or <body>'s when <html>'s is visible.
  const viewportOverflow = (axis) => {
    const own = rootStyle[`overflow${axis}`];
    return own !== 'visible' ? own : style(body)[`overflow${axis}`];
  };
  const bodyPropagates = rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible';
  const scrollable = (v) => v === 'auto' || v === 'scroll';
  const scrolls = (el, axis) => (axis === 'X' ? el.scrollWidth > el.clientWidth + 1 : el.scrollHeight > el.clientHeight + 1);
  // The reader cannot scroll the page on an axis whose overflow is hidden, or where there is
  // nothing to scroll to (how a `body { position: fixed }` scroll lock looks).
  const locked = (axis) => ['hidden', 'clip'].includes(viewportOverflow(axis)) || !scrolls(scroller, axis);
  // Measured on the scrolling element: in quirks mode <html>'s client box is the whole document.
  const viewport = { left: 0, top: 0, right: scroller.clientWidth, bottom: scroller.clientHeight };

  // The box an absolutely positioned box (or, with `fixed`, a fixed one) is placed and clipped
  // against, searching from `from` up: the nearest box that is positioned (absolute only) or
  // that transforms, filters or contains its descendants. null: the initial containing block
  // (absolute) or the viewport (fixed).
  const containerOf = (from, fixed) => {
    for (let a = from; a; a = a.parentElement) {
      const s = style(a);
      if ((!fixed && s.position !== 'static') || s.transform !== 'none' || s.translate !== 'none' ||
          s.rotate !== 'none' || s.scale !== 'none' || s.perspective !== 'none' || s.filter !== 'none' ||
          s.backdropFilter !== 'none' || /transform|perspective|filter/.test(s.willChange) ||
          /paint|layout|strict|content/.test(s.contain) || s.contentVisibility === 'auto') return a;
    }
    return null;
  };
  // The next box whose overflow can clip a box positioned `position` whose parent is `from`
  // (inclusive, for a pseudo-element's host): absolute and fixed boxes skip to their containing
  // block, and a fixed box without one is clipped by the viewport alone.
  const up = (from, position) => {
    if (position === 'absolute') return { box: containerOf(from, false), toViewport: false };
    if (position === 'fixed') {
      const box = containerOf(from, true);
      return { box, toViewport: !box };
    }
    return { box: from, toViewport: false };
  };

  // Where content can be seen, walking the clipping boxes from `first` ({box, toViewport}) up.
  // Inside a box that scrolls on an axis, content can be brought anywhere into that box, so from
  // there up the question on that axis is whether the box itself stays visible. The walk ends at
  // the viewport, which clips everything under a fixed box; otherwise it ends at the document,
  // which cannot be scrolled above its top, and which clips to the viewport on an axis the page
  // cannot scroll (a scroll-locked page shows one screen and no more).
  // -> {rect, movable}: movable when the reader can scroll the content vertically at all.
  const clipOf = (first) => {
    const axes = { X: { lo: -Infinity, hi: Infinity, reach: null }, Y: { lo: -Infinity, hi: Infinity, reach: null } };
    const clip = (axis, lo, hi) => {
      const a = axes[axis];
      if (!a.reach) {
        a.lo = Math.max(a.lo, lo);
        a.hi = Math.min(a.hi, hi);
      } else {
        a.reach = [Math.max(a.reach[0], lo), Math.min(a.reach[1], hi)];
        if (a.reach[0] >= a.reach[1]) [a.lo, a.hi] = [Infinity, -Infinity];
      }
    };
    let { box: a, toViewport } = first;
    while (a && a !== docEl && !(a === body && bodyPropagates)) {
      const s = style(a);
      const r = a.getBoundingClientRect();
      const box = {
        X: [r.left + a.clientLeft, r.left + a.clientLeft + a.clientWidth],
        Y: [r.top + a.clientTop, r.top + a.clientTop + a.clientHeight],
      };
      for (const axis of ['X', 'Y']) {
        const overflow = s[`overflow${axis}`];
        if (overflow === 'visible') continue;
        // An outer scroll box brings inner boxes into view too, so it replaces the reach.
        if (scrollable(overflow) && scrolls(a, axis)) axes[axis].reach = box[axis];
        else clip(axis, ...box[axis]);
      }
      ({ box: a, toViewport } = up(a.parentElement, s.position));
    }
    if (toViewport) {
      clip('X', viewport.left, viewport.right);
      clip('Y', viewport.top, viewport.bottom);
    } else {
      clip('Y', -scrollY, Infinity);
      if (style(docEl).direction === 'ltr') clip('X', -scrollX, Infinity);
      if (locked('X')) clip('X', viewport.left, viewport.right);
      if (locked('Y')) clip('Y', viewport.top, viewport.bottom);
    }
    return {
      rect: { left: axes.X.lo, right: axes.X.hi, top: axes.Y.lo, bottom: axes.Y.hi },
      movable: axes.Y.reach !== null || (!toViewport && !locked('Y')),
    };
  };
  const inside = (r, x, y) => x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  const intersects = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  const alpha = (color) => {
    if (color === 'transparent') return 0;
    const m = color.match(/^rgba\([^)]*,\s*([\d.]+)\)$/) || color.match(/\/\s*([\d.]+)(%?)\s*\)$/);
    if (!m) return 1;
    return m[2] === '%' ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
  };
  const opacityOf = (el) => {
    let o = 1;
    for (let a = el; a; a = a.parentElement) o *= parseFloat(style(a).opacity);
    return o;
  };
  const shrink = (r, c) => ({
    left: Math.max(r.left, c.left), top: Math.max(r.top, c.top),
    right: Math.min(r.right, c.right), bottom: Math.min(r.bottom, c.bottom),
  });
  const area = (r) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
  const paints = (s, opacity) =>
    s.backdropFilter !== 'none' ||
    (opacity >= 0.5 && (alpha(s.backgroundColor) >= 0.5 || s.backgroundImage !== 'none'));

  // ---- paint order, approximated from CSS 2.1 Appendix E ----
  // A layer is a real element or a ::before/::after box; each has a path of elements from <html>.
  const pathOf = (el) => {
    const p = [];
    for (let a = el; a; a = a.parentElement) p.unshift(a);
    return p;
  };
  const stackingZ = (s, parent) => {
    const flexItem = parent && /flex|grid/.test(style(parent).display);
    if (s.zIndex !== 'auto' && (s.position !== 'static' || flexItem)) return parseInt(s.zIndex, 10) || 0;
    if (s.position === 'fixed' || s.position === 'sticky' || parseFloat(s.opacity) < 1 ||
        s.transform !== 'none' || s.translate !== 'none' || s.rotate !== 'none' || s.scale !== 'none' ||
        s.perspective !== 'none' || s.filter !== 'none' || s.backdropFilter !== 'none' ||
        s.clipPath !== 'none' || s.maskImage !== 'none' || s.isolation === 'isolate' ||
        s.mixBlendMode !== 'normal' || /transform|opacity|filter|perspective/.test(s.willChange) ||
        /paint|layout|strict|content/.test(s.contain)) return 0;
    return null;
  };
  // Where a branch below the common ancestor paints in that ancestor's stacking context: its
  // outermost stacking context's z-index; else 0 if anything on it is positioned (positioned
  // layers paint above in-flow content); else -0.5, the in-flow content itself.
  const layerOf = (branch) => {
    let positioned = false;
    for (const { el, pseudo } of branch) {
      const s = style(el, pseudo);
      const z = stackingZ(s, pseudo ? el : el.parentElement);
      if (z !== null) return z;
      if (s.position !== 'static') positioned = true;
    }
    return positioned ? 0 : -0.5;
  };
  const steps = (layer) => {
    const p = pathOf(layer.el).map((el) => ({ el, pseudo: null }));
    if (layer.pseudo) p.push({ el: layer.el, pseudo: layer.pseudo });
    return p;
  };
  // Does `layer` paint over paragraph element `el`? Neither may contain the other, except that a
  // ::backdrop sits under its own element's content.
  const paintsOver = (layer, el) => {
    if (layer.top) return !(layer.pseudo === '::backdrop' && layer.el.contains(el));
    const a = steps(layer);
    const b = steps({ el, pseudo: null });
    let i = 0;
    while (i < a.length && i < b.length && a[i].el === b[i].el && a[i].pseudo === b[i].pseudo) i++;
    const la = layerOf(a.slice(i));
    const lb = layerOf(b.slice(i));
    if (la !== lb) return la > lb;
    // Same layer: later in tree order paints later. ::before precedes the host's children and
    // ::after follows them.
    if (a[i].pseudo) return a[i].pseudo === '::after';
    return Boolean(a[i].el.compareDocumentPosition(b[i].el) & Node.DOCUMENT_POSITION_PRECEDING);
  };

  // Moves with the viewport rather than with the content: fixed (with no containing block of its
  // own) or sticky, or inside such a box with no scroll container in between.
  const viewportAnchored = (el) => {
    for (let a = el; a; a = a.parentElement) {
      const s = style(a);
      if (s.position === 'sticky' || (s.position === 'fixed' && !containerOf(a.parentElement, true))) return true;
      if (a !== el && (scrollable(s.overflowX) || scrollable(s.overflowY))) return false;
    }
    return false;
  };

  // Every painted, positioned box that could sit over text: overlays, fades, dialogs, banners,
  // including ::before/::after boxes (a common way to draw a paywall fade).
  const collectLayers = () => {
    const layers = [];
    for (const el of body.querySelectorAll('*')) {
      if (!el.checkVisibility()) continue; // no box: neither it nor its ::before/::after paints
      const s = style(el);
      const opacity = opacityOf(el);
      if (s.position !== 'static' && s.visibility !== 'hidden' && paints(s, opacity)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) layers.push({ el, pseudo: null, rect: r, top: el.matches(TOP_LAYER) });
      }
      for (const pseudo of ['::before', '::after']) {
        const ps = style(el, pseudo);
        if (ps.content === 'none' || ps.display === 'none' || !['absolute', 'fixed'].includes(ps.position) ||
            ps.visibility === 'hidden' || !paints(ps, opacity * parseFloat(ps.opacity))) continue;
        const rect = pseudoRect(el, ps);
        if (rect) layers.push({ el, pseudo, rect, top: false });
      }
    }
    for (const el of document.querySelectorAll(TOP_LAYER)) {
      const bs = style(el, '::backdrop');
      if (bs.display !== 'none' && paints(bs, parseFloat(bs.opacity))) {
        layers.push({ el, pseudo: '::backdrop', rect: { ...viewport }, top: true });
      }
    }
    for (const l of layers) {
      const { position } = style(l.el, l.pseudo);
      const first = up(l.pseudo ? l.el : l.el.parentElement, position); // a pseudo box's parent is its host
      l.anchored = first.toViewport || viewportAnchored(l.el);
      l.rect = shrink(l.rect, clipOf(first).rect);
      l.gate = l.anchored && area(shrink(l.rect, viewport)) >= GATE_SHARE * area(viewport);
    }
    return layers.filter((l) => l.rect.right > l.rect.left && l.rect.bottom > l.rect.top);
  };
  // The painted (border) box of an absolutely or fixed positioned pseudo-element. Chrome resolves
  // its left, top, width and height to px whatever the page set, against its containing block's
  // padding box; width and height follow box-sizing.
  const pseudoRect = (host, ps) => {
    const cb = containerOf(host, ps.position === 'fixed');
    let origin = ps.position === 'fixed' ? { left: 0, top: 0 } : { left: -scrollX, top: -scrollY };
    if (cb) {
      const r = cb.getBoundingClientRect();
      const own = cb !== docEl && cb !== body; // the root's scroll is already in its rect
      origin = { left: r.left + cb.clientLeft - (own ? cb.scrollLeft : 0), top: r.top + cb.clientTop - (own ? cb.scrollTop : 0) };
    }
    const px = (v) => parseFloat(v) || 0;
    const [left, top, width, height] = [ps.left, ps.top, ps.width, ps.height].map(parseFloat);
    if (![left, top, width, height].every(Number.isFinite)) return null;
    const edges = (a, b) => (ps.boxSizing === 'border-box' ? 0
      : px(ps[`padding${a}`]) + px(ps[`padding${b}`]) + px(ps[`border${a}Width`]) + px(ps[`border${b}Width`]));
    const w = width + edges('Left', 'Right');
    const h = height + edges('Top', 'Bottom');
    if (w <= 0 || h <= 0) return null;
    const x = origin.left + left + px(ps.marginLeft);
    const y = origin.top + top + px(ps.marginTop);
    return { left: x, top: y, right: x + w, bottom: y + h };
  };

  let layers = null;
  const blurred = (el) => {
    for (let a = el; a; a = a.parentElement) {
      const m = style(a).filter.match(/blur\(([\d.]+)px\)/);
      if (m && parseFloat(m[1]) >= 2) return true;
    }
    return false;
  };

  // 'ok' | 'hidden' | 'clipped' | 'covered'. Coverage is judged on the paragraph's lines of
  // text, not its element box, so a float the text wraps around does not count against it.
  const fate = (el, nodes) => {
    if (!el.checkVisibility(SEEN) || blurred(el)) return 'hidden';
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return 'hidden';
    const rects = [];
    const range = document.createRange();
    for (const n of nodes) {
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) rects.push(r);
    }
    if (!rects.length) return 'hidden';

    layers ??= collectLayers();
    const { rect: clip, movable } = clipOf({ box: el, toViewport: false });
    const over = layers.filter((l) =>
      !el.contains(l.el) && // the paragraph's own content and pseudo boxes
      (l.pseudo || !l.el.contains(el)) && // a box around the paragraph is its background
      // A fixed or sticky layer scrolls past the text unless it fills the viewport or the text
      // cannot be scrolled.
      (l.gate || ((!l.anchored || !movable) && intersects(l.rect, box))) &&
      paintsOver(l, el));
    if (over.some((l) => l.gate)) return 'covered';

    const lines = [];
    for (const r of rects) {
      const y = (r.top + r.bottom) / 2;
      let line = lines.find((l) => y >= l.top && y < l.bottom);
      if (!line) lines.push((line = { top: r.top, bottom: r.bottom, total: 0, clipped: 0, covered: 0 }));
      const n = Math.max(3, Math.ceil(r.width / SAMPLE_PX));
      for (let i = 0; i < n; i++) {
        const x = r.left + (r.width * (i + 0.5)) / n;
        line.total += 1;
        if (!inside(clip, x, y)) line.clipped += 1;
        else if (over.some((l) => inside(l.rect, x, y))) line.covered += 1;
      }
    }
    if (lines.every((l) => (l.clipped + l.covered) / l.total <= MAX_HIDDEN)) return 'ok';
    const sum = (k) => lines.reduce((t, l) => t + l[k], 0);
    return sum('clipped') >= sum('covered') ? 'clipped' : 'covered';
  };

  // ---- ops ----

  const extract = () => {
    const judged = new Map();
    const judge = (el) => {
      if (!judged.has(el)) {
        const { text, nodes } = textOf(el);
        const words = /[\p{L}\p{N}]/u;
        const verdict = !words.test(el.textContent) ? 'skip' : words.test(text) ? fate(el, nodes) : 'hidden';
        judged.set(el, { text, verdict, isHeading: el.tagName !== 'P' });
      }
      return judged.get(el);
    };
    const scopes = SCOPES.map((sel) => {
      const roots = [...document.querySelectorAll(sel)].filter((r, _, all) =>
        !r.parentElement?.closest(CHROME) && !all.some((o) => o !== r && o.contains(r)));
      const blocks = roots.flatMap((root) => [...root.querySelectorAll('p, h2, h3')]
        .filter((el) => {
          const c = el.closest(CHROME);
          return !(c && root.contains(c) && c !== root);
        }));
      const judgedBlocks = blocks.map((el) => ({ el, ...judge(el) }));
      const paragraphs = judgedBlocks.filter((b) => !b.isHeading && b.verdict !== 'skip');
      // Covered and clipped paragraphs still mark where the article is; hidden ones (templates,
      // collapsed widgets) do not.
      const rendered = paragraphs.filter((b) => b.verdict !== 'hidden' && b.text.length >= MIN_CHARS).length;
      return { judgedBlocks, paragraphs, rendered };
    });
    const scope = scopes.find((s) => s.rendered >= MIN_PARAGRAPHS) ?? scopes.find((s) => s.rendered > 0) ??
      scopes.find((s) => s.paragraphs.length > 0) ?? scopes[0];

    const paragraphs = [];
    const els = [];
    const skipped = { hidden: 0, clipped: 0, covered: 0 };
    let heading = null;
    for (const b of scope.judgedBlocks) {
      if (b.verdict === 'skip') continue;
      if (b.isHeading) {
        if (b.verdict === 'ok') heading = b.text;
      } else if (b.verdict === 'ok') {
        els.push(b.el);
        paragraphs.push({ n: paragraphs.length + 1, text: b.text, heading });
      } else {
        skipped[b.verdict]++;
      }
    }
    // Isolated-world state: the page's own scripts cannot see it, and no attribute is written
    // into the page. Maps keep insertion order, so the first key is the oldest reading.
    const readings = (globalThis.__pyramidReader ??= new Map());
    // A counter, not crypto.randomUUID(), which a plain-http page does not have.
    const reading = `r${(globalThis.__pyramidReadings = (globalThis.__pyramidReadings ?? 0) + 1)}`;
    readings.set(reading, { els, texts: paragraphs.map((p) => p.text) });
    while (readings.size > READINGS_KEPT) readings.delete(readings.keys().next().value);
    return { reading, title: document.title, paragraphs, skipped };
  };

  const readingOf = (reading) => {
    const readings = globalThis.__pyramidReader;
    return reading === undefined ? [...(readings?.values() ?? [])].at(-1) : readings?.get(reading);
  };

  // Characters [start, end) of paragraph n's extracted text (all of it by default) as a DOM Range,
  // or why there is none: the paragraph left the DOM or changed text, or the span is not in it.
  const locate = (reg, n, start, end) => {
    const el = reg?.els[n - 1];
    if (!el || !el.isConnected) return { reason: 'stale' };
    const { text, map } = textOf(el, true);
    if (text !== reg.texts[n - 1]) return { reason: 'stale' };
    start ??= 0;
    end ??= text.length;
    if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && end <= text.length)) {
      return { reason: 'bad-range' };
    }
    const range = document.createRange();
    const [startNode, startOffset] = map[start];
    const [endNode, endOffset] = map[end - 1];
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset + 1);
    return { range, startNode };
  };

  const show = ({ n, start, end, reading }) => {
    const { range, startNode, reason } = locate(readingOf(reading), n, start, end);
    if (!range) return { ok: false, reason };
    const shown = new Highlight(range);
    shown.priority = 1; // above the paint
    CSS.highlights.set(HIGHLIGHT, shown);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tall = range.getBoundingClientRect().height > innerHeight * 0.6;
    (startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : startNode).scrollIntoView({
      block: tall ? 'start' : 'center', behavior: reduce ? 'instant' : 'smooth',
    });
    return { ok: true };
  };

  const PAINT = ['pr-v', 'pr-c1', 'pr-c2', 'pr-c3', 'pr-c4', 'pr-c5'];
  const unpaint = () => {
    for (const name of PAINT) CSS.highlights.delete(name);
    CSS.highlights.delete(HIGHLIGHT);
    globalThis.__pyramidWatch?.detach();
  };

  // ---- the watcher: what the reader points at, clicks and scrolls to, told to the panel ----
  //
  // Isolated-world state like the readings: listeners the page's scripts cannot see, which never
  // call preventDefault, so a click on the page does what it did before, and which take the
  // reader's input only (a page script's synthetic events are not the reader). A later paint gives
  // it the new ranges. It ends with the paint: when the panel's port for the paint on screen
  // closes (the panel closed, or moved to another page), on clear, or when the extension goes
  // away (reloaded, removed).
  //   view  {first, last}  the first and last paragraph of the reading on screen (null when none)
  //   point {id}           the claim whose painted text is under the pointer, or null
  //   pick  {id}           a click on painted text that is not a link or control
  const watch = (reading, reg, spans, gen) => {
    const running = globalThis.__pyramidWatch;
    if (running) return running.update(reading, reg, spans, gen);
    if (!globalThis.chrome?.runtime?.id) return undefined; // not in the extension (page.evaluate in tests)

    const state = { reading, spans, gen, first: undefined, last: undefined, pointed: null, io: null };
    const send = (event, data) => {
      try {
        chrome.runtime.sendMessage({ type: 'pr-page', reading: state.reading, event, ...data }).catch(() => {}); // no panel open
      } catch {
        detach(); // this extension context is gone
      }
    };
    const hit = (x, y) => {
      for (const s of state.spans) {
        for (const r of s.range.getClientRects()) if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return s.id;
      }
      return null;
    };
    let frame = 0;
    let px = 0;
    let py = 0;
    const onMove = (e) => {
      if (!e.isTrusted) return;
      px = e.clientX;
      py = e.clientY;
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        const id = hit(px, py);
        if (id !== state.pointed) send('point', { id: (state.pointed = id) });
      });
    };
    const onClick = (e) => {
      if (!e.isTrusted || e.button !== 0) return;
      if (e.target.closest?.('a, button, input, select, textarea, label, summary, [role="button"], [contenteditable]')) return;
      if (!getSelection().isCollapsed) return; // the reader is selecting text
      const id = hit(e.clientX, e.clientY);
      if (id) send('pick', { id });
    };
    const observe = (r) => {
      state.io?.disconnect();
      state.first = state.last = undefined; // a new paint hears where the reader is at once
      const numbers = new Map(r.els.map((el, i) => [el, i + 1]));
      const onScreen = new Set();
      state.io = new IntersectionObserver((entries) => {
        for (const e of entries) onScreen[e.isIntersecting ? 'add' : 'delete'](numbers.get(e.target));
        const first = onScreen.size ? Math.min(...onScreen) : null;
        const last = onScreen.size ? Math.max(...onScreen) : null;
        if (first === state.first && last === state.last) return;
        Object.assign(state, { first, last });
        send('view', { first, last });
      });
      for (const el of r.els) state.io.observe(el);
    };
    // Only the port for the paint on screen clears it: an older one closing late, after a newer
    // paint, leaves the newer one be.
    const onConnect = (port) => {
      const held = /^pr-paint:(\d+)$/.exec(port.name);
      if (held) port.onDisconnect.addListener(() => { if (state.gen === Number(held[1])) unpaint(); });
    };
    const detach = () => {
      removeEventListener('pointermove', onMove, true);
      removeEventListener('click', onClick, true);
      state.io?.disconnect();
      try {
        chrome.runtime.onConnect.removeListener(onConnect);
      } catch { /* the extension context is gone, and its listeners with it */ }
      delete globalThis.__pyramidWatch;
    };
    addEventListener('pointermove', onMove, { capture: true, passive: true });
    addEventListener('click', onClick, { capture: true, passive: true });
    chrome.runtime.onConnect.addListener(onConnect);
    globalThis.__pyramidWatch = {
      update: (next, r, s, g) => {
        Object.assign(state, { reading: next, spans: s, gen: g, pointed: null });
        observe(r);
      },
      detach,
    };
    return observe(reg);
  };

  const paint = ({ marks = [], reading, gen }) => {
    const reg = readingOf(reading);
    const painted = new Map();
    const spans = [];
    let stale = 0;
    for (const { h, id, n, start, end } of marks) {
      const { range } = locate(reg, n, start, end);
      if (!range) {
        stale++;
        continue;
      }
      if (!painted.has(`pr-${h}`)) painted.set(`pr-${h}`, new Highlight());
      painted.get(`pr-${h}`).add(range);
      spans.push({ id, range });
    }
    for (const name of PAINT) CSS.highlights.delete(name);
    for (const [name, h] of painted) CSS.highlights.set(name, h);
    if (reg) watch(reading, reg, spans, gen);
    return { ok: true, stale };
  };

  // With `page` (the panel's page, its URL sans #fragment), another document answers nothing: the
  // tab may have moved on between the panel's check and the injection landing.
  if (req.op === 'extract') return req.page !== undefined && location.href.split('#')[0] !== req.page ? null : extract();
  if (req.op === 'show') return show(req);
  if (req.op === 'paint') return paint(req);
  if (req.op === 'clear') {
    if (req.paint) unpaint();
    else CSS.highlights.delete(HIGHLIGHT);
    return { ok: true };
  }
  throw new Error(`pageAgent: unknown op ${req.op}`);
}
