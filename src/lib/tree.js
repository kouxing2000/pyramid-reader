// The tree's nodes as they stream in, and the hand-written validator for them (SPEC §6: the
// transport may not enforce the schema, so every answer is checked here).
import { OPEN } from './partial-json.js';

const KINDS = ['argument', 'report', 'narrative', 'reference'];

const str = { type: 'string' };
const paragraphNumbers = { type: 'array', items: { type: 'integer' } };
// Every property required and no others: OpenAI's strict structured outputs accept nothing else.
const object = (properties) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties,
});

const EVIDENCE = object({ quote: str, src: paragraphNumbers, derived: { type: 'boolean' } });

// The JSON schema of the tree the model is asked for (prompt.js). Key order is generation
// order: the verdict's source fields come straight after it, so the verdict can be checked and
// shown before the branches have streamed. readyNodes() below is the validator;
// tests/unit/tree.test.js keeps the two in step.
export const TREE_SCHEMA = object({
  lang: str,
  kind: { type: 'string', enum: KINDS },
  verdict: str,
  verdict_src: paragraphNumbers,
  verdict_basis: str,
  branches: {
    type: 'array',
    minItems: 3,
    maxItems: 5,
    items: object({
      title: str,
      src: paragraphNumbers,
      basis: str,
      body: str,
      // Two or none: an endpoint that enforces the schema cannot answer with one.
      children: { anyOf: [0, 2].map((n) => ({ type: 'array', minItems: n, maxItems: n, items: EVIDENCE })) },
    }),
  },
});

/** An answer that breaks the schema or a structural rule; the message goes back to the model. */
export class SchemaError extends Error {
  name = 'SchemaError';
}

const complete = (v) => v !== undefined && !v?.[OPEN];
const items = (k) => `${k} item${k === 1 ? '' : 's'}`;
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
// A well-formed BCP 47 tag ('en', 'zh-Hant', 'pt-BR').
function isLanguage(v) {
  try {
    return typeof v === 'string' && Intl.getCanonicalLocales(v).length === 1;
  } catch {
    return false;
  }
}

/**
 * The nodes whose own fields have all streamed in, in reading order, each validated. The verdict
 * comes first and nothing shows before it; branches show in order; evidence shows once its
 * object closes. The verdict carries the language the tree is written in, the article's own,
 * when the tree names it: trees saved and scored before `lang` existed do not, and stay valid.
 *
 *   {id: 'verdict', type: 'verdict', lang?, kind, title, src, basis}
 *   {id: 'b0',      type: 'claim',   title, src, basis, body}
 *   {id: 'b0.1',    type: 'evidence', parent: 'b0', quote, src, derived}
 *
 * @param {object} tree  parsePartial output
 * @param {number} count the number of paragraphs a `src` may cite
 * @param {boolean} final the answer has ended: a missing field is an error, not still to come
 * @throws SchemaError at the first complete value that breaks the schema
 */
export function readyNodes(tree, count, final = false) {
  const check = checker(count, final);
  const verdict = verdictNode(tree, check);
  if (!verdict) return [];
  const nodes = [verdict];
  const branches = tree.branches;
  if (branches === undefined) {
    check.fields(tree, ['branches'], '');
    return nodes;
  }
  check.that(Array.isArray(branches), 'branches must be an array');
  const size = `branches has ${items(branches.length)}; it must have 3-5`;
  check.that(branches.length <= 5, size);
  if (complete(branches)) check.that(branches.length >= 3, size);
  for (const [i, b] of branches.entries()) {
    const claim = claimNode(b, i, check);
    if (!claim) break;
    nodes.push(claim);
    const { evidence, done } = evidenceNodes(b, claim.id, `branches[${i}]`, check);
    nodes.push(...evidence);
    if (!done) break;
  }
  return nodes;
}

// The verdict once kind, verdict and its sources are complete, with the tree's language if it
// came first, as the schema orders it.
function verdictNode(tree, check) {
  if (!check.fields(tree, ['kind', 'verdict', 'verdict_src', 'verdict_basis'], '')) return null;
  if (complete(tree.lang)) check.that(isLanguage(tree.lang), 'lang must be a language code such as en, zh or pt-BR');
  check.that(KINDS.includes(tree.kind), `kind must be one of ${KINDS.join(', ')}`);
  check.text(tree.verdict, 'verdict');
  check.src(tree.verdict_src, 'verdict_src');
  check.text(tree.verdict_basis, 'verdict_basis');
  return {
    id: 'verdict', type: 'verdict', ...(complete(tree.lang) && { lang: tree.lang }), kind: tree.kind,
    title: tree.verdict, src: tree.verdict_src, basis: tree.verdict_basis,
  };
}

// Branch i as a claim once its own fields are complete, else null.
function claimNode(b, i, check) {
  const path = `branches[${i}]`;
  if (complete(b)) check.that(isObject(b), `${path} must be an object`);
  if (!check.fields(b, ['title', 'src', 'basis', 'body'], `${path}.`)) return null;
  check.text(b.title, `${path}.title`);
  check.src(b.src, `${path}.src`);
  check.text(b.basis, `${path}.basis`);
  check.text(b.body, `${path}.body`);
  return { id: `b${i}`, type: 'claim', title: b.title, src: b.src, basis: b.basis, body: b.body };
}

// The branch's evidence whose objects have closed; done when the branch itself has closed, so
// the next branch may be read.
function evidenceNodes(b, parent, path, check) {
  const evidence = [];
  const children = b.children;
  if (children === undefined) {
    check.fields(b, ['children'], `${path}.`);
    return { evidence, done: false };
  }
  check.that(Array.isArray(children), `${path}.children must be an array`);
  const pair = `${path}.children has ${items(children.length)}; it must have 0 or 2`;
  check.that(children.length <= 2, pair);
  if (complete(children)) check.that(children.length !== 1, pair);
  for (const [j, c] of children.entries()) {
    if (!complete(c)) break;
    const cp = `${path}.children[${j}]`;
    check.that(isObject(c), `${cp} must be an object`);
    check.fields(c, ['quote', 'src', 'derived'], `${cp}.`);
    check.text(c.quote, `${cp}.quote`);
    check.src(c.src, `${cp}.src`);
    check.that(typeof c.derived === 'boolean', `${cp}.derived must be true or false`);
    evidence.push({ id: `${parent}.${j}`, type: 'evidence', parent, quote: c.quote, src: c.src, derived: c.derived });
  }
  return { evidence, done: complete(b) };
}

function checker(count, final) {
  const that = (ok, message) => { if (!ok) throw new SchemaError(message); };
  return {
    that,
    // true when every key has a complete value; a key still streaming gives false, unless the
    // answer has ended (or the object has closed), when it is missing.
    fields(obj, keys, path) {
      for (const key of keys) {
        if (complete(obj?.[key])) continue;
        that(!(final || complete(obj)), `${path}${key} is missing`);
        return false;
      }
      return true;
    },
    text: (v, path) => that(typeof v === 'string' && v.trim() !== '', `${path} must be a non-empty string`),
    src(v, path) {
      that(Array.isArray(v) && v.length > 0, `${path} must list at least one paragraph number`);
      for (const [k, n] of v.entries()) {
        that(Number.isInteger(n) && n >= 1 && n <= count,
          `${path}[${k}] is ${JSON.stringify(n)}, not a paragraph number (1-${count})`);
      }
    },
  };
}
