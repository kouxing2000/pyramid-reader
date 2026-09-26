// The panel's one way to make DOM. Page and model text only ever go in as Text nodes, never
// parsed as HTML (AGENTS.md: model text reaches the DOM only via textContent).

/**
 * el('p', {class: 'title', 'data-n': 3}, 'text', childNode, [more, children])
 * Attributes are set as strings. Children are nodes or strings, arrays flattened, falsy ones
 * skipped; a string becomes a Text node.
 * @throws TypeError on an on* attribute: listeners go through addEventListener
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (/^on/i.test(name)) throw new TypeError(`el(): no inline handlers (${name})`);
    node.setAttribute(name, String(value));
  }
  node.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return node;
}
