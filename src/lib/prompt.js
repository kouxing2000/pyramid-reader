// The one prompt every provider gets (SPEC §6: prototype/read.py RULES plus an explicit hedge
// rule). The tree's JSON schema lives with its validator in tree.js.
import { TREE_SCHEMA } from './tree.js';

export const RULES = `You restructure an article into a Minto pyramid a reader can skim top-down and
drill into. Answer with one JSON object matching the schema at the end. Rules:

1. \`lang\`: the language the article is written in, as a BCP 47 code ("en", "de", "zh",
   "pt-BR"). Write the verdict, every title and every body in that language.
   \`verdict\`: ONE sentence, the article's main point -- the thing a reader must take away
   if they read nothing else.
2. \`kind\`: argument (makes a case), report (news: what happened), narrative (a story or
   biography), reference (explains a topic). NEVER invent a thesis the text does not make:
   for a narrative or reference piece, the verdict states what the piece establishes about
   its subject, not an argument you supply.
3. Keep the article's certainty. The verdict and every title may be no more certain than the
   paragraphs they cite. If those paragraphs hedge -- "may", "could", "remains unclear",
   "is expected to", "critics say" -- the verdict or title keeps the hedge. Never turn
   "unclear" into "unlikely", "may" into "will", a forecast into a fact, or one side's claim
   into the article's own.
4. \`branches\`: 3-5, MECE, ordered by importance. Each \`title\` is a CLAIM that answers the
   "why?" or "how?" the verdict provokes -- never a bucket like "Background", "Reactions",
   "Early life". Each branch has a \`body\` of 1-3 sentences.
5. \`children\`: two or none per branch -- one child groups nothing, so a branch with only
   one piece of evidence gets none (its \`basis\` already shows it). Each child is one piece of
   evidence for the branch's claim: \`quote\` is a sentence or phrase copied from a cited
   paragraph, and \`derived\` is false. Only when the evidence is a value you computed from
   the text (a total, a share, a difference) is \`quote\` that value in a few words, with
   \`derived\` true and \`src\` citing every paragraph the computation uses.
6. \`src\` / \`verdict_src\`: the paragraph numbers [n] the node is based on. Every node must
   cite at least one. Say only what the cited paragraphs say: no outside knowledge, no
   inference beyond the text. If the article attributes a claim to someone, keep the
   attribution.
7. \`basis\` / \`verdict_basis\`: the one sentence from a cited paragraph that most directly
   supports the verdict or title.
8. \`basis\`, \`verdict_basis\` and every \`quote\` not derived are copied character for
   character from ONE paragraph: no paraphrase, no ellipsis, no joining text from two places.

The user message is the article: its title after "# ", then one numbered paragraph per
line; lines starting with "## " are headings.`;

/**
 * @param {{title: string, paragraphs: {n: number, text: string, heading: string}[]}} page
 * @returns {{system: string, user: string, schema: object}}
 */
export function treePrompt({ title, paragraphs }) {
  const lines = title ? [`# ${title}`] : [];
  let heading = null;
  for (const p of paragraphs) {
    if (p.heading && p.heading !== heading) lines.push(`## ${p.heading}`);
    heading = p.heading;
    lines.push(`[${p.n}] ${p.text}`);
  }
  return {
    system: `${RULES}\n\nJSON schema:\n${JSON.stringify(TREE_SCHEMA)}`,
    user: lines.join('\n'),
    schema: TREE_SCHEMA,
  };
}

/** The same request once more, telling the model why its last answer was rejected. */
export function retryPrompt(prompt, error) {
  return {
    ...prompt,
    user: `${prompt.user}\n\nYour previous answer was rejected: ${error}. ` +
      'Answer again with the complete JSON object, following every rule.',
  };
}
