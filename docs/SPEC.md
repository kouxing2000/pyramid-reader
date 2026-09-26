# Pyramid Reader — product spec

Working name. Draft v1, 2026-09-23. Evidence behind every "why" below is in
the market research, which is not in this repo; the prototype that measured cost, latency and
faithfulness is in `prototype/`.

## 1. The product in one paragraph

A Chrome side panel that turns the article you are reading into a conclusion-first tree: a
one-sentence verdict, 3-5 claims under it, verbatim evidence under each claim. Every claim is one
click from the sentence it came from on the live page, and the model is told to keep the
article's own hedges ("remains unclear" must not become "unlikely"). A second-language layer puts the verdict and
each claim into the reader's own language, translated on their computer, so a Chinese-native reader
can triage an English article in Chinese and check it in English. It runs on the reader's own model and API key: no server, no account.

## 2. Why it should exist

- **Plain summaries are free in every browser now.** Gemini in Chrome summarizes any page free in
  50+ languages including Chinese; Edge, Brave, Opera, Comet and Dia do the same. So this is not a
  summarizer, and must never be pitched as one.
- **What they don't do is depth, sentence anchors, or a mixed-language layer.** Built-in output is
  flat; "expand" makes it longer, not deeper; citations are whole-page links. No shipped product
  combines claim tree + reader-chosen depth + live-page anchors + a reader's-language layer; the closest
  are Sidenote, Iligani and MindMapAny.
- **The failure that matters is a verdict more certain than its source.** Prototype: Haiku turned
  "it remains unclear" into "cooperation unlikely", which a quote/number check cannot catch.
  Literature measures certainty distortion around 43% for a Haiku-class model. Citations raise
  trust even when wrong, so a source link beside a distorted verdict makes the error look sourced.
  **The reader does the checking, and the product makes it one click:** every claim opens on the
  sentence it came from.
- **First audience: Chinese-native readers of English long-form, outside mainland China.** They
  already pay for reading help (Immersive Translate, 3M Chrome users, no summary layer) and
  describe an "AI triage first, then read closely with a translator" workflow with no product in
  the triage step. The tree is that step, and hands off to the translator for close reading.

## 3. Users and jobs

- **Primary — bilingual triage reader.** "Tell me what this piece concludes — in Chinese if I want —
  and let me check any claim against the English in one click, so I decide what to read closely."
- **Secondary — English reader of long-form** analysis, reports and reference pages who wants the
  argument's shape before committing 20 minutes.
- **Non-goals:** chatting about the page, full-text translation (hand off to the reader's
  translator), news aggregation, read-later queues.

## 4. Principles — hard constraints, not preferences

1. **Checkable.** Every node cites paragraph anchors. Evidence nodes are verbatim quotes. Hovering a
   claim shows its source sentence; clicking scrolls the page to it and highlights it.
2. **Hedge-preserving.** A verdict or claim title may not be more certain than the sentences it
   cites. The prompt holds the model to it, and nothing checks it afterwards: how well it holds
   is the reader's choice of model (Settings recommends some, §5.4), and a claim's sentence is one
   click away for the reader to check. The tree's words are never rewritten after the model
   writes them.
3. **No invented thesis.** Pages without an argument (narrative, reference) get a scoping verdict —
   what the page establishes — never an argument the text does not make.
4. **Bring your own model and key; no server.** The extension calls the provider the reader chose,
   directly. No article text, tree or key goes anywhere else.
5. **Visible text only.** Never read text hidden behind a paywall overlay or otherwise not rendered
   to the reader.
6. **Nothing shared or cached server-side.** No public tree pages, no shared cache. (Legal
   guardrail: caching and republishing are what publisher suits target.)
7. **Value before the key.** A first-time user sees a working, clickable tree before pasting any key.

## 5. Experience

### 5.1 Main flow

1. Reader opens the side panel (toolbar icon or shortcut) on an article and presses **Build tree**.
2. The verdict streams in first (target: visible within ~10s), then branches, then evidence.
3. Clicking a claim or quote scrolls the page to the cited paragraph and highlights the exact
   sentence; hovering shows the sentence in a tooltip without moving the page.
4. When the article is in another language than the reader's, **Read in [original | Both | theirs]**
   shows the tree as written, with a translation under each line, or in their language alone; quotes
   stay the page's words, and hovering a translated line shows its original. Their language is the
   first of Chrome's languages that isn't the article's, unless they choose one, from the switch's
   ▾ or in Settings, which then holds over Chrome's; a reader whose only language is the article's
   never sees the switch. The tree opens as written when the reader
   reads the article's language, and in Both when they don't, until they choose.
5. The tree is kept locally per URL; reopening the page shows it instantly, with a "rebuild" action.

### 5.2 Tree shape

- **Verdict:** one sentence; a `kind` badge: argument / report / narrative / reference. The tree
  names the article's language (`lang`) and is written in it.
- **Branches:** 3-5, mutually exclusive, ordered by importance. The title is a CLAIM ("China
  competes on cheap, open, ubiquitous AI"), never a bucket ("Background", "Reactions"). 1-3 sentence
  body.
- **Evidence children:** two or none per branch. Each is a verbatim quote from the page, or a value
  the model computed, tagged `derived` and linked to every paragraph it draws on.
- **Depth:** two levels in the panel; the page itself is the third. (NN/g: past two levels of
  hidden detail, users get lost.)

### 5.3 How check results appear

- Per node: anchored ✓ · anchor repaired (citation moved to where the quote actually is) ·
  unanchored ⚠.

### 5.4 Settings

Provider · model · API key (per provider) · the translation language
(Chrome's languages, or one chosen) ·
a **tested models** table with each model's measured anchor rate and typical time, produced by
the eval (§8), under the recommended models: each provider's default or a larger model from the
same provider, noting that even these sometimes state a claim more surely than the page. Beside the model, a ✓ when the provider serves it, a warning when
it does not or refuses the key, asked of the provider when Settings opens and on Save. For a
reader with no key, a link to a free Gemini key from Google AI Studio, noting that Google may use
free-tier text to improve its products.

### 5.5 First run, no key

A bundled demo: one Wikipedia article snapshot (CC BY-SA, attributed) served from the extension
itself, with its pre-built tree — fully interactive (anchors, hover, translation). Then "Add a key to use
this on any page".

## 6. Architecture

Manifest V3, **vanilla JavaScript with zero runtime dependencies** (same convention as
`open-book-reader`: dev tooling only in `package.json`, Playwright for tests).

```
content script (injected on demand via activeTab)
  extract.js   visible-text extraction -> tags each paragraph element data-pr-p="n"
               -> [{n, text, heading}]          (live DOM ids, so anchors never drift)
  anchor.js    scrollTo(n) / highlight(n, quote) -- quote located inside paragraph n by
               normalized string match; falls back to whole-paragraph highlight
service worker
  background.js   orchestrates one build: extract -> provider -> verify -> cache -> panel
  providers/      generateTree({paragraphs, model, key}) -> stream of partial JSON
    anthropic.js  Messages API, schema-constrained output
    openai.js     structured output (json_schema)
    gemini.js     responseSchema
    compat.js     OpenAI-compatible: DeepSeek, Qwen, Kimi, OpenRouter, Ollama
                  (JSON mode only on some -> client-side validation is mandatory)
  schema.js       hand-written validator; on failure, retry ONCE with the error text
  verify/
    anchors.js    every quote must be found (normalized) in a cited paragraph; else search all
                  paragraphs and repair the citation; else mark unanchored
    derived.js    numbers absent from cited text -> tag derived, link all source paragraphs
  cache.js        IndexedDB, key = URL + hash(extracted text), LRU-capped
side panel
  panel.html/js   fixed renderer; model text only ever via textContent, never innerHTML
  translate.js    the reader's language: Chrome's on-device Translator on the verdict, titles
                  and bodies
```

- **Prompt:** start from `prototype/read.py` `RULES` (it produced the prototype's six
  trees), add the hedge rule explicitly, keep the JSON schema.
- **Thinking off by default.** In the prototype, thinking was 60-74% of output tokens and most of
  the wait; the tree itself is ~2k tokens.
- **Translation on the computer**, with Chrome's Translator API (Chrome 138+, desktop): no tokens,
  no key, and it works on the demo and saved trees. Where Chrome has none, or not for the pair,
  the Read-in switch is hidden. The first use of a language downloads its model, which Chrome
  starts only after a click in the panel.
- **Permissions:** `sidePanel`, `storage`, `activeTab`, `scripting`. Provider origins as
  `optional_host_permissions`, requested when a key is added. No `<all_urls>` content script.
- **Keys** in `chrome.storage.local` only — never `storage.sync`, never logged.
- **Personal flat-rate path** (`claude -p` through a native-messaging host) is dev-only and never
  shipped: Chrome's Aug 2026 policy bans extensions that route around AI services' usage limits.

## 7. Data, privacy, store compliance

- **Stored locally:** keys, trees, settings. Nothing else. No telemetry in the MVP.
- **Sent:** the visible paragraph text, to the reader's chosen provider only; Settings also asks
  that provider, with the saved key, whether it serves the saved model. Translation runs on
  the computer and sends no text; the first time a language is used, Chrome downloads its
  translation model from Google.
- **Store listing must disclose** that page text is sent to the AI service the user configures
  (Aug 2026 disclosure rules, Limited Use policy). The renderer is fixed code drawing JSON, which
  keeps it inside the MV3 remote-code rules.

## 8. Quality: the eval

The eval is how "tested models" gets its numbers, and how any prompt or model change is judged.

- **Page set:** 50-100 URLs in `eval/pages.txt`, weighted toward hedged news analysis and wiki /
  reference pages, plus some narrative pieces. Pages are fetched at eval time; **article text is
  never committed** (copyright). Each run stores only URLs, extracted-text hashes, trees and scores.
- **Models:** every provider with a key present — Claude through `claude -p` on the dev machine,
  OpenAI (`OPENAI_API_KEY`), Gemini (`GEMINI_API_KEY`), DeepSeek when a key exists. A model with no
  key prints `SKIPPED <model>: no key` — never a silent omission.
- **Per model:** anchor resolution rate, first-try schema validity, time to verdict, total time,
  tokens, cost.
- **Output:** `eval/results/<date>/` JSON plus a markdown table; the table feeds §5.4.
- **Hedge flips are not scored by the eval**; a review of verdicts and titles measures them
  when a gate asks (§9.5). The 2026-09-24 run's review of 167 verdicts and titles
  (`eval/results/2026-09-24/reviews.json`) is that run's record of each model's flips.

## 9. MVP

**Goal:** the maintainer uses it daily on real articles, and the eval says which models it can
recommend.

### 9.1 In scope

- Side panel: build tree, streaming verdict-first, claim/evidence rendering, click-to-anchor,
  hover-source, Read-in switch (translation on the computer), local cache per URL.
- Providers: OpenAI, Gemini, Anthropic, OpenAI-compatible (covers DeepSeek/Qwen/Ollama).
- Verify pipeline: anchors + repair, derived tags.
- Settings with keys, models, tested-models table.
- First-run demo tree without a key.
- Eval harness + one full run on the models available.
- Chrome Web Store listing in English, Public.

### 9.2 Out of scope

Server of any kind · billing and accounts · mobile / share-sheet app · mainland edition and Edge
store · shared or public trees · on-device Gemini Nano (probed 2026-09-26: it could not build
the tree, DESIGN.md) · Firefox/Safari · telemetry · full-text
translation.

### 9.3 Milestones — each ends in a commit with its tests green

- **M0 Scaffold.** Commit the existing docs/prototype first; MV3 manifest, empty side panel,
  Playwright harness that loads the unpacked extension.
- **M1 Extraction + anchors, no model.** Panel lists extracted paragraphs; clicking one scrolls and
  highlights it on the page. Tested on local HTML fixtures written for the tests (never scraped
  articles), including an overlay-hidden paragraph that must NOT be extracted.
- **M2 One provider end to end.** OpenAI-compatible + OpenAI adapter, schema validation + one
  retry, streaming verdict-first, tree rendering. E2E test against a mock provider.
- **M3 Verify pipeline.** anchors/derived with unit tests.
- **M4 Remaining providers, 中文 layer, settings, first-run demo, local cache.**
- **M5 Eval.** Harness, `eval/pages.txt`, one run across available models, results table wired
  into settings.

### 9.4 Done means

- Works on the two prototype pages (BBC analysis, Wikipedia "Mary Mallon") and at least three other
  sites of different layouts; ≥95% of evidence quotes resolve to an anchor on the eval set.
- Time to verdict and total time are measured and reported per model (target ≤10s to verdict on a
  fast model — reported for the MVP, a gate before any public launch).
- A test proves the extension makes no network request except to the configured provider.
- Keys never appear in `storage.sync` or in logs; model text reaches the DOM only via
  `textContent`.
- Unit tests (verify, schema, extraction) and Playwright E2E (mock provider) pass.

### 9.5 After the MVP (not now)

Store listing in Chinese. Quality gates, not yet met, that the first Public store release (0.0.4)
shipped ahead of: zero hedge flips by the recommended model on the eval set (a review, §8), ≤$0.02
per tree on the recommended cheap model, verdict ≤10s.

## 10. Open questions

- Product name.
