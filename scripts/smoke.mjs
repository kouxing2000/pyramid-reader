// A live smoke run of one provider through the extension's own prompt, transport, validator and
// checks, on the article fixture's text. Dev tooling: never shipped, run by hand with a real key.
//
//   node scripts/smoke.mjs gemini gemini-3.8-flash GEMINI_API_KEY
//   node scripts/smoke.mjs openai gpt-5.4-mini OPENAI_API_KEY
import { buildTree } from '../src/lib/build.js';
import { treePrompt } from '../src/lib/prompt.js';
import { endpointOrigin, providerConfig, PROVIDERS } from '../src/lib/providers/index.js';
import { verifier } from '../src/lib/verify/index.js';
import { ARTICLE_PAGE } from '../tests/fixtures/trees/article.js';

const [provider, model, keyVar] = process.argv.slice(2);
if (!PROVIDERS[provider] || !model || !process.env[keyVar]) {
  console.error('usage: node scripts/smoke.mjs <provider> <model> <KEY_ENV_VAR>  (the variable must be set)');
  process.exit(2);
}
const settings = { provider, providers: { [provider]: { model } } };
const keys = { [endpointOrigin(PROVIDERS[provider].baseUrl)]: process.env[keyVar] };
const cfg = providerConfig(settings, keys);
const page = { title: 'The Ledger of Small Bridges', paragraphs: ARTICLE_PAGE.map((p) => ({ ...p, heading: null })) };

const started = performance.now();
const seconds = (t) => ((t - started) / 1000).toFixed(1);
let verdictAt;
const nodes = new Map();
const retries = [];
await buildTree({
  prompt: treePrompt(page), count: ARTICLE_PAGE.length, verify: verifier(ARTICLE_PAGE),
  stream: (p, signal) => cfg.transport.stream(cfg, p, signal),
  onNode: (n) => { if (n.type === 'verdict') verdictAt ??= performance.now(); nodes.set(n.id, n); },
  onRetry: (e) => retries.push(e),
});
console.log(`${cfg.label} ${cfg.model} ${JSON.stringify(cfg.params)}: verdict ${seconds(verdictAt)} s, ` +
  `tree ${seconds(performance.now())} s, retries ${JSON.stringify(retries)}`);
for (const n of nodes.values()) console.log(`  ${n.id} ${n.anchor.status} ${n.flags.map((f) => f.type).join(' ')}`);
