// Parses the JSON a model has streamed so far, so the panel can draw each tree node as soon as
// its own fields are complete (SPEC §5.1: the verdict renders first).

// Set on every object or array whose closing bracket has not arrived yet.
export const OPEN = Symbol('open');

const PLAIN_RUN = /[^"\\\u0000-\u001f]*/y; // string characters that need no decoding
const NUMBER_RUN = /[-+0-9.eE]*/y;

/**
 * Parses a prefix of a JSON object. Whatever is complete comes back as ordinary values; an object
 * or array still open is returned with `[OPEN]: true`; a trailing string, number or literal that
 * may still grow (`"unfin`, `12`, `tr`) is left out, as is a key still waiting for its value.
 * Text before the first `{` (a markdown fence, a preamble) is skipped; text after the object
 * closes is ignored.
 *
 * @returns the value parsed so far, or undefined before the first `{`
 * @throws SyntaxError when the text can never become a JSON object
 */
export function parsePartial(text) {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let i = start;
  const END = Symbol('end'); // the text ran out inside the current value

  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++; };
  const fail = (what) => {
    throw new SyntaxError(`${what} at character ${i}: ${JSON.stringify(text.slice(i, i + 20))}`);
  };

  function value() {
    ws();
    if (i >= text.length) return END;
    const c = text[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    for (const [word, v] of [['true', true], ['false', false], ['null', null]]) {
      const got = text.slice(i, i + word.length);
      if (word.startsWith(got) && (got === word || i + got.length === text.length)) {
        if (got !== word) return END;
        i += word.length;
        return v;
      }
    }
    return fail('unexpected character');
  }

  function object() {
    const obj = {};
    i++; // {
    ws();
    if (text[i] === '}') { i++; return obj; }
    for (;;) {
      ws();
      if (i >= text.length) return open(obj);
      if (text[i] !== '"') fail('expected a key');
      const key = string();
      if (key === END) return open(obj);
      ws();
      if (i >= text.length) return open(obj);
      if (text[i] !== ':') fail('expected ":"');
      i++;
      const v = value();
      if (v === END) return open(obj);
      // Like JSON.parse, "__proto__" is an ordinary own key, not the prototype.
      Object.defineProperty(obj, key, { value: v, enumerable: true, writable: true, configurable: true });
      if (v?.[OPEN]) return open(obj);
      ws();
      if (i >= text.length) return open(obj);
      if (text[i] === '}') { i++; return obj; }
      if (text[i] !== ',') fail('expected "," or "}"');
      i++;
    }
  }

  function array() {
    const arr = [];
    i++; // [
    ws();
    if (text[i] === ']') { i++; return arr; }
    for (;;) {
      const v = value();
      if (v === END) return open(arr);
      arr.push(v);
      if (v?.[OPEN]) return open(arr);
      ws();
      if (i >= text.length) return open(arr);
      if (text[i] === ']') { i++; return arr; }
      if (text[i] !== ',') fail('expected "," or "]"');
      i++;
    }
  }

  function open(container) {
    container[OPEN] = true;
    return container;
  }

  function string() {
    let out = '';
    i++; // "
    for (;;) {
      PLAIN_RUN.lastIndex = i;
      const run = PLAIN_RUN.exec(text)[0];
      out += run;
      i += run.length;
      if (i >= text.length) return END;
      const c = text[i++];
      if (c === '"') return out;
      if (c !== '\\') fail('control character in a string');
      if (i >= text.length) return END;
      const e = text[i++];
      if (e === 'u') {
        const hex = text.slice(i, i + 4);
        if (!/^[0-9a-fA-F]*$/.test(hex)) fail('bad \\u escape');
        if (hex.length < 4) return END;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else {
        const ch = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[e];
        if (ch === undefined) fail('bad escape');
        out += ch;
      }
    }
  }

  function number() {
    NUMBER_RUN.lastIndex = i;
    const run = NUMBER_RUN.exec(text)[0];
    // At the end of the text a number may still grow ("12" -> "123"), or be half-written ("1.").
    if (i + run.length === text.length) {
      return /^-?(\d+(\.\d*)?([eE][+-]?\d*)?)?$/.test(run) ? END : fail('bad number');
    }
    if (!/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(run)) fail('bad number');
    i += run.length;
    return Number(run);
  }

  return object();
}
