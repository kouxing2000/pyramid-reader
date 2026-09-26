// One tree build: stream the model's answer, show each node as soon as its own fields are
// complete and valid (SPEC §5.1: the verdict first), and when the answer breaks the schema, ask
// once more with the error (SPEC §6).
import { OPEN, parsePartial } from './partial-json.js';
import { retryPrompt } from './prompt.js';
import { readyNodes, SchemaError } from './tree.js';

/**
 * @param {object} o
 * @param {{system: string, user: string, schema: object}} o.prompt  from treePrompt()
 * @param {(prompt: object, signal?: AbortSignal) => AsyncIterable<string>} o.stream
 *   a provider transport bound to its settings: yields the answer's text as it arrives
 * @param {number} o.count  the page's paragraph count, the highest number a node may cite
 * @param {(node: object) => object | Promise<object>} [o.verify]
 *   the per-node check (lib/verify), run once per node; a node is shown only after it ran, as what
 *   it returns
 * @param {(node: object) => void} o.onNode  each node once, in reading order (readyNodes() shapes)
 * @param {(error: string) => void} [o.onRetry]  the first answer was rejected for `error`; nodes
 *   shown so far are void, and the second answer's nodes follow
 * @param {AbortSignal} [o.signal]
 * @returns {Promise<object>} the complete tree, valid against TREE_SCHEMA and the tree rules
 * @throws SchemaError when the second answer breaks the schema too; the transport's errors as is
 */
export async function buildTree({ prompt, stream, count, verify = (node) => node, onNode, onRetry = () => {}, signal }) {
  const attempt = async (p) => {
    const shown = new Set(); // ids of the nodes shown
    let text = '';
    const show = async (final) => {
      let tree;
      try {
        tree = parsePartial(text);
      } catch (e) {
        throw new SchemaError(`the answer is not JSON (${e.message})`);
      }
      if (final && !tree) throw new SchemaError('the answer holds no JSON object');
      if (final && tree[OPEN]) throw new SchemaError('the answer ends before its JSON object closes');
      for (const node of readyNodes(tree, count, final)) {
        if (shown.has(node.id)) continue;
        shown.add(node.id);
        onNode(await verify(node));
      }
      return tree;
    };
    for await (const delta of stream(p, signal)) {
      text += delta;
      await show(false); // a SchemaError here ends the stream, and with it the request
    }
    const tree = await show(true);
    // The validator passes a tree saved before trees named their language; a new one must name it,
    // or it could never be read in the reader's.
    if (!tree.lang) throw new SchemaError('lang is missing');
    return tree;
  };

  try {
    return await attempt(prompt);
  } catch (e) {
    if (!(e instanceof SchemaError)) throw e;
    onRetry(e.message);
    return attempt(retryPrompt(prompt, e.message));
  }
}
