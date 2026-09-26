# Design notes: where the build differs from SPEC §6, and why

These are implementation choices below the SPEC §4 principles. The one tolerance that touches
§4.5 is marked **§4.5 tolerance**.

## Page access comes from the toolbar click

- **The toolbar icon opens the panel from `action.onClicked`**, not with
  `setPanelBehavior({openPanelOnActionClick: true})`. With that behavior Chrome opens the panel
  without granting `activeTab` (Chromium's `ExtensionActionRunner::RunAction` returns before
  `GrantTabPermissions` when the action opens a side panel), and a click inside the panel never
  grants it. From `onClicked`, the same click opens the panel and grants the tab; the grant
  survives same-origin navigation.
- **On a page the click has not granted, Build asks for that click**, and the click resumes the
  build, which on a page the click cannot open up (`chrome://`, the Web Store) then reports it
  unreadable rather than asking again: since a tab that leaves the click's origin closes its panel
  (below), that is the only page a waiting Build can still be on, apart from a web page a panel
  opened where Chrome showed no URL (`chrome://`, the demo through Chrome 153) moved to, and there
  the click opens that page's own panel and the old one ignores the click.
  There is no host-permission fallback: without access Chrome withholds the tab's URL, so the panel
  cannot even name the origin it would request. Install-time permissions stay `activeTab`,
  `scripting`, `sidePanel`, `storage`.
- `tests/e2e/panel.spec.js` pins it, including a canary that fails if Chrome starts granting
  access through `openPanelOnActionClick`.

## One panel per tab

- **The toolbar click opens the tab's own panel, on the page the click shows**: `setOptions({tabId,
  path: 'panel/panel.html?tab=<id>&page=<url sans #fragment>', enabled: true})` then `open({tabId})`
  (`src/lib/tab-panel.js`), and the default panel is disabled when the worker starts, so a tab the
  icon was never clicked on shows none. Chrome hides a tab's panel while another tab is in front
  (the document lives on: a build in it keeps streaming) and shows the same document again on
  return; the panel dies with its tab. The tab id rides in the URL because `runtime.getContexts`
  reports no tab for a side-panel context, and the page rides with it because that is the URL the
  click saw, before any navigation the panel's own start could race: a panel needs no `tabs.get` to
  know its page. `setOptions` with the same path on an open panel changes nothing; with another
  path Chrome loads the panel afresh, so a click on another page in the same tab (only a tab whose
  panel shows no URL can still be on one, below) gives that page a panel of its own, and a click on
  the same page keeps the panel, which is what lets the click resume a waiting Build on `chrome://`.
  Measured on Chromium 153 (`tabs.spec.js` pins it): on a Chrome where a new path did not reload the
  panel, the old panel would read the clicked page and then close at that page's load's end, a
  broken experience rather than a leak. With the default panel left enabled, Chrome would open it,
  window-wide, on the first tab switch.
- **The two calls run in the same tick.** In the service worker an `await` before
  `sidePanel.open`, even of `setOptions`, loses the click's gesture (`may only be called in
  response to a user gesture`); Chrome applies the two in order. In an extension page (the
  panel, the demo) the click's activation outlasts an awaited `tabs.create`, which is how the
  demo offer opens the demo in a tab of its own, with its own panel.
- **The panel belongs to the page it was clicked open on, and closes when the tab leaves it.**
  `tabs.onUpdated` fires `loading` and `complete` for a navigation, a reload and a same-document
  change alike, and the panel decides by URL alone, never by reading the new page, so no page the
  icon was not clicked on is ever read. A page is its URL without the `#fragment`, the one the
  click saw (`here`, from the panel's own URL): the same URL (a reload, a `#` change) is looked at again
  by the quiet read, which tells a new document (entered, its saved tree drawn) from the same one
  (left alone); another URL (a navigation, a `pushState` or `replaceState` to another path or
  query, history back) closes the panel; a URL Chrome withholds where it showed one means the tab
  left the click's origin, and closes it too. While the grant holds Chrome shows the new URL from
  the `loading` status on, in `changeInfo.url` when it changed and on `tabs.get` always (measured,
  Chromium 153). A build under way when the tab leaves is stopped and nothing is saved; one under
  way when the page reloads finishes, is saved, and the reloaded document is then looked at
  (`followUp`). `readPage`, the one place that injects, also refuses a tab whose URL is not `here`,
  and the injected agent answers nothing from a document whose URL is not `here` either, for the
  moments between a navigation, the panel's check, the injection landing and the update that closes
  the panel. The panel's own URL names its page; Chrome sends no referrer from an extension page,
  so no request carries it (`network.spec.js` pins that; a no-referrer meta changed nothing). The
  next page gets a panel only from its own click.
- **Closing is `setOptions({tabId, enabled: false})`** (`closeTabPanel`, `src/lib/tab-panel.js`):
  it destroys the panel's document in the same turn, from the panel itself or the worker, whether
  the tab is in front or behind another, on any Chrome with a side panel. `sidePanel.close({tabId})`
  (Chrome 141) resolves at once but hides the panel after ~300 ms and destroys it at ~400 ms, and
  does nothing at all while the tab is behind another; `window.close()` from the panel behaves like
  it. The next `openTabPanel` enables the tab's panel again, and whichever closed it, a tab switch
  away and back shows no panel. A streaming request in a closed panel keeps its socket for ~5 s,
  aborted first or not, so a provider stops within that.
- **A panel opened where Chrome shows no URL asks the demo page itself.** Chrome shows no
  `chrome://` URL to the click or the panel, and through Chrome 153 none of the extension's own
  pages either (from 154 it shows those: `tabs.create`'s `pendingUrl`, `tabs.getCurrent`,
  `action.onClicked` and `tabs.get` all name the demo page, measured; scripting it stays refused on
  both). The demo's openers pass the URL Chrome shows them, so on 154 the demo's panel follows the
  URL rule like a web page's, and where `here` is undefined a reload shows no URL either: once such
  a tab has loaded (`complete`), the panel messages the demo page (`page-link.js demoAnswers`),
  which alone answers, and nothing is injected: an answer is the demo's reload, looked at again
  (`demo-ready` re-enters it too); silence is a tab that left for another page, and the panel
  closes. Measured: the demo's module script has answered before its tab reports `complete`. CI
  pins only the bundled Chromium's path (153 with Playwright 1.63, so the messaging one); the other
  is run by hand with `PR_CHROME`, and `demo.spec.js`'s extension-page canary ties the URL's
  visibility to the browser's major version, so a Playwright bump across 154 shows up there.
- **The harness** attaches the panel on screen, the front tab's, and closes a panel with
  `close({tabId})`: `close({windowId})` finds no window-wide panel. `tests/e2e/tabs.spec.js`
  pins this section, the demo tab and a reload during a build included, through the panel
  document's `visibilityState`; `window.spec.js` pins what the window shows, headed with the page
  sized by the window, where a tab's `outerWidth - innerWidth` is a panel's width where one shows
  and nothing where none does. `PR_CHROME=<executable>` runs the suite on another Chromium or
  Chrome for Testing build; branded Chrome from 137 ignores `--load-extension`, so a reader's own
  Chrome cannot run it, and a pass here is Chrome for Testing under Playwright's switches, not that
  Chrome.
- `sidePanel.onOpened` and `onClosed` exist from Chrome 141 and 142; `minimum_chrome_version` is
  116, so nothing uses them.

## One page agent, and it never writes to the page

- `src/content/page.js` exports one self-contained `pageAgent({op})` in place of `extract.js` +
  `anchor.js`: extraction and highlighting share the text walk that maps offsets in a
  paragraph's extracted text to DOM positions, so they cannot disagree.
- **No `data-pr-p` attributes.** Paragraph elements are kept in the extension's isolated world
  (`globalThis.__pyramidReader`), invisible to page scripts, under the id of the reading that
  found them: reading the page again (the panel checking for a saved tree) never renumbers the
  paragraphs of a tree already on screen. A highlight is a Range in
  `CSS.highlights` styled by a stylesheet the panel inserts with `scripting.insertCSS` (AUTHOR
  origin: Chrome does not paint `::highlight()` rules from a USER-origin sheet); the page's DOM is
  never modified. A paragraph that left the DOM or changed text is
  reported `stale`.

## The painted page: the tree on the article itself

- Beyond SPEC §5.1's click-to-highlight, **a whole tree is painted on its page**: every node found
  there (`anchored` or `repaired`) as a named highlight in its claim's colour, the verdict's
  sentence in grey (`src/panel/paint.js` plans it; the page agent's `paint` op draws it). Paint means checked: an unanchored node or a
  computed value has no paint. A tree still streaming is not painted, nor one cut short by Stop.
- Same mechanism as the click highlight: `CSS.highlights` plus the extension stylesheet, so the
  page's DOM is still never modified. The palette is Okabe-Ito hues at a quarter strength and never
  sets the text colour, so one palette reads on light and dark pages; the click's highlight has a
  higher priority and paints above it.
- **The page tells the panel what the reader points at, clicks and scrolls to.** The first paint
  starts a watcher in the extension's isolated world (listeners page scripts cannot see, which
  never call `preventDefault`): the pointer over painted text marks its claim, a click on painted
  text that is not a link or control picks it, and an `IntersectionObserver` reports the first and
  last paragraph on screen. Hit-testing is the pointer against the painted ranges'
  `getClientRects()`: one exact path from Chrome 116. The panel accepts these messages only for the
  tree on screen: same tab, same reading, and on a web page the same `documentId` (reading ids
  restart in every document). The watcher takes the reader's input only (`isTrusted`), so a page
  script cannot pick claims with synthetic events.
- **The paint lasts as long as the panel shows its tree.** Each paint is numbered; the panel holds a
  port named `pr-paint:<n>` to the page (`tabs.connect`, by `documentId`; the demo by frame) while
  paint n is on screen. The page clears its paint and stops the watcher when that port closes: the
  panel closed, or moved to another page or tree. The page does the clearing, not the service
  worker, so nothing depends on the worker being alive when the panel goes. A port for an older
  paint closing late leaves a newer paint be.
- **What a page script can see.** `CSS.highlights` is one registry per document, shared with the
  page's main world: a page script can read which of its sentences the tree anchors, grouped by
  claim, and tell that the extension is in use. No model text is exposed (titles, bodies and
  their translations stay in the panel). The click highlight has always had this exposure for one sentence;
  painting widens it to the tree's anchors while a tree is on screen. Paint mode Off exposes
  nothing beyond the click highlight. A page script can also write the registry: add ranges to
  a claim's highlight and paint any text in its colour. Hit-testing reads the extension's own
  ranges, so a click on such text selects nothing.
- Paint mode All / Focus / Off is the reader's, kept in `chrome.storage.local` (`paint`).

## Which paragraphs count (§4.5 visible text only)

- **Scope** is the first of `article`, `main`, `body` holding `MIN_PARAGRAPHS` rendered `<p>`s
  of `MIN_CHARS` or more (the prototype's rule; constants in `src/content/page.js`). Every
  rendered `<p>` in it is listed, short ones included, since a short paragraph can be the one a
  quote comes from; numbering can therefore differ from `prototype/read.py`, which drops the
  short ones. `nav`, `footer`, `aside`, `figure`, `table` and dialogs are skipped.
- **Text** is what the reader sees: whitespace collapsed, `<br>` as a space, screen-reader-only
  text and bracketed citation markers (`[1]`) dropped.
- A paragraph is left out when it is **hidden** (not rendered, zero-size, opacity 0, blurred,
  transparent text), **clipped** (outside the overflow-clipping boxes from the paragraph's own
  box up, or before the document's start), or **covered** (under a painted, positioned box that
  paints above it). Clipping follows the containing-block chain: an absolutely positioned box
  escapes clipping boxes below its containing block, and a transform, filter or `contain`
  creates a containing block like positioning does. Inside a box that scrolls, content counts
  as reachable when that box itself is visible.
- Clipping and coverage are sampled along each line of text, so a float the text wraps around
  does not count. A paywall hides whole lines, so **one line more than `MAX_HIDDEN` hidden
  excludes the whole paragraph**. **§4.5 tolerance:** a line hidden by less than that (a small
  box over a word or two, such as a share button) does not, and its hidden words are read.
- Paint order is approximated from CSS stacking rules, since no browser API answers "is this
  off-screen text occluded". A plain "negative z-index is behind" rule is wrong both ways: a
  modal's backdrop drawn as its own `::before` at `z-index: -1` still covers the page, and a
  card's `::before` background under positioned text does not. `::before`/`::after` boxes count
  as layers, since paywall white-outs and backdrops are often drawn with them. The top layer (a
  modal `<dialog>`, an open popover, a fullscreen element, and each one's `::backdrop` over the
  whole viewport) paints above everything else.
- A fixed or sticky box scrolls past the text and does not cover it, unless it fills
  `GATE_SHARE` of the viewport (a backdrop covers everything) or the text cannot be scrolled:
  it sits in no scrolling box, and the page cannot scroll (overflow hidden, or nothing to scroll,
  as with a `body { position: fixed }` lock). Then only the current screen is readable and fixed
  boxes cover what they sit on. Text in a scrolling box (an app shell, a reader overlay) can be
  scrolled back into view, whatever the document does. The viewport is measured on
  `document.scrollingElement`, which also holds in quirks mode.
- An `<article>` inside `nav`, `aside`, `footer` and the like (a "more stories" card) is not
  part of the article.
- The panel reports skipped paragraphs by reason, so an over-eager rule is visible to the reader.

## The side panel runs the build

- `background.js` only opens the panel. The panel reads the page, calls the provider, validates
  and draws the tree: an extension page can fetch a granted origin cross-origin, so no
  panel-to-worker streaming protocol is needed and no service-worker lifetime limit can cut off a
  slow answer. Closing the panel ends the build.

## Providers are transports; the prompt is built once

- A provider is `stream(cfg, {system, user, schema}, signal)`, an async iterator of text deltas
  (`src/lib/providers/`). Three wire formats sit behind it: `chat-completions.js`, `anthropic.js`
  and `gemini.js`. All three POST through `events()` in `http.js`, over its `send()`, the
  extension's only network call, which reads server-sent events through the one reader in `src/lib/sse.js`, refuses
  redirects, and turns an error status or a body that is not a stream into a `ProviderError`
  with the key scrubbed. Each transport reads its own events into text chunks; `answer()` passes
  them on and makes a stream with none a `ProviderError`. `src/lib/prompt.js` builds the only prompt; a retry is the same request
  with the rejection appended to the user message.
- A provider's `params(model)` go where that API takes its settings (the body; Gemini's
  `generationConfig`), and they are what keeps thinking off (SPEC §6). A model that cannot turn it off answers 400, and the panel shows the 400: OpenAI's
  gpt-5-mini and o4-mini and Gemini's pro models, as probed; Anthropic's Opus 5.5 and Fable, by
  Anthropic's API reference.
- **Anthropic** (`/v1/messages`): the key goes in `x-api-key`, with the
  `anthropic-dangerous-direct-browser-access: true` header, Anthropic's browser CORS support: the
  one its official JS SDK sends when `dangerouslyAllowBrowser` is set. Thinking is `{type: 'disabled'}`. Structured output is
  `output_config.format`. Its structured-output reference lists complex array constraints as
  unsupported, so `lenientSchema()` drops the array bounds: the 3-5 branches go, and "two or no
  children" merges into one plain array. The prompt still writes
  out the full schema, and the validator enforces it. No Anthropic key exists here, so this
  transport is tested against a local server only: the request shape is the API reference's and
  the browser header the SDK's, unconfirmed by a live call.
- **Gemini** (`:streamGenerateContent?alt=sse`): the key goes in `x-goog-api-key`, never the URL.
  The full `TREE_SCHEMA` goes in `responseJsonSchema`, and the live API accepts its `anyOf` and
  array bounds. Thinking is `thinkingBudget: 0`. The flash-lite models do not think by default,
  and some of them reject a budget of 0 with a bare 400, so they get no thinking setting. A
  finish other than `STOP` is a `ProviderError`; `RECITATION` is named, since an answer made of
  verbatim quotes can trip it.
- `chat-completions.js` serves OpenAI and every OpenAI-compatible endpoint, which differ only in
  base URL and JSON mode. OpenAI gets strict `json_schema`, and its reasoning models get
  `reasoning_effort: 'none'` (thinking off, SPEC §6). Its models without reasoning (`gpt-3.5*`,
  `gpt-4*`, `chatgpt-*`, `*chat-latest`, and `ft:` fine-tunes of them) reject the parameter
  outright and get none; the set is closed, since
  new models reason. A reasoning model that cannot turn thinking off (gpt-5-mini, o4-mini)
  answers 400 with its supported values, shown in the panel, rather than build slowly.
  OpenAI-compatible gets `json_object` and no thinking switch, since there is no common one: the
  model name decides.
- The system message carries the JSON schema as text for every provider, so an endpoint with
  JSON mode only still knows the shape.
- A transport passes each usage report the provider streams to `cfg.onUsage`, in the provider's
  own shape: OpenAI's `usage` (sent only when the request asks with `stream_options`, which the
  extension does not), Gemini's `usageMetadata` on every chunk, Anthropic's `usage` of
  `message_start` and `message_delta`. The panel sets no hook; the eval prices builds with it.

## Tree schema

- Key order is generation order: `lang, kind, verdict, verdict_src, verdict_basis, branches`, and
  per branch `title, src, basis, body, children`. The verdict and each claim carry a verbatim
  `basis` sentence, which the verify step anchors on the page.
- `lang`, the article's language, which the tree is written in, is the one field the schema asks
  for and the validator does not require: trees saved in the panel and scored by the eval before
  it existed have none, and stay valid. When present it must be a BCP 47 tag. A tree without it
  has no second language (below).
- **Evidence is `{quote, src, derived}` with no title.** It is the page's words, or, with
  `derived: true`, a value the model computed and declares; no model prose sits on it.
- 3-5 branches and two or no children are in the schema (`minItems`/`maxItems`, and `anyOf` for
  "0 or 2"), so an endpoint that enforces the schema cannot break them; the prompt alone does
  not hold a cheap model to them. The validator checks them for every endpoint.

## Streaming and validation

- `src/lib/partial-json.js` re-parses the answer so far on every delta; `readyNodes()` in
  `src/lib/tree.js` lists the nodes whose own fields are complete, validating each one. The
  validator is hand-written next to `TREE_SCHEMA`, and `tests/unit/tree.test.js` walks the
  schema so the two cannot drift.
- `buildTree()` (`src/lib/build.js`) passes each node through a `verify` hook, once, before it is
  drawn; the panel's hook is `verifier()` (below). A node that breaks the schema ends that answer's stream at once and the
  one retry starts; the nodes drawn so far are cleared. A paragraph number outside the page is
  a schema error, not an anchor to repair. Keys the schema does not name are ignored.
- The request refuses redirects: one would re-send the article and the key to wherever it
  points (§4.4).
- Only an answer is retried. A response that is not an event stream, or a stream with no
  content, is the endpoint's failure (`ProviderError`) and is shown, not asked for again.
- A build that stops keeps the nodes already drawn, each validated, under a "Stopped" status.
  Stop aborts the request; there is no timeout, so a hung endpoint waits for Stop.

## Settings and page access for the provider

- `chrome.storage.local` holds `settings` (`provider`, and `baseUrl`/`model` per provider) and
  `keys`, the API keys by endpoint origin; nothing goes to `storage.sync`. A key is sent only to
  the origin it was saved for: the key field refills when the base URL's origin changes, and Save
  stores a key the reader did not type only under the origin it came from.
- Build and Save read storage afresh, so a panel in another window never works from, or writes
  back, stale settings.
- Save requests the endpoint's origin (scheme, host and port) before storing anything. Chrome
  refuses an origin outside `optional_host_permissions`, so an OpenAI-compatible endpoint not
  listed there cannot be saved.
- With no usable provider, Build lists the paragraphs a tree would be built from, and the panel
  offers the demo.
- The translation language (`translateTo`), chosen in Settings or from the Read-in switch's ▾, is
  saved the moment it changes: it needs no key, so it is not part of the provider's Save. How the reader reads a translated tree
  (`read`) is saved by the panel's switch, like the paint mode.
- The tested-models table reads `src/lib/tested-models.js`, which `node eval/eval.mjs tested`
  writes from a run's results. Each row shows the
  pages it was measured on, and `via` when it was measured outside the extension's own transport
  (the Claude rows, through `claude -p`).
- Above the table, Settings recommends each provider's default model (`PROVIDERS[id].model`) or a
  larger one from the same provider: the default is the recommendation, so changing one changes
  both. The OpenAI-compatible provider has no default and no recommendation.
- The flag beside the model is the provider's answer, not the eval's: each transport's
  `checkModel()` asks through `lookup()` in `http.js` (Anthropic and Gemini: GET the model by
  name; chat-completions: GET `/models` and look for it). ✓ when served; "not found" only from a
  provider's own endpoint, since a compatible server may accept names it does not list (Ollama,
  OpenRouter); "key rejected" on 401, and on Gemini's 400 `API_KEY_INVALID`; nothing on any other
  answer, a 403 included (OpenAI's region block), or none. It is asked when Settings opens and
  after Save, only about the provider in use and its saved model, and any edit to the form
  clears it: never at the panel's start, and never with a key for a provider only looked at. A
  measured model's ✓ carries the eval's numbers in its tooltip.
- Under the key field, a reader with no key is pointed to a free one: "Get a free Gemini key"
  opens Google AI Studio in a new tab and sets the form's provider to Google Gemini, on a click
  or a middle click. Gemini's default model was free of charge on Google's free tier when the
  link was added (the Gemini API pricing page, 2026-09-26). The note beside it says Google may
  use free-tier text to improve its products (the Gemini API terms; not in the EEA, Switzerland
  or the UK). It is the reader's own navigation: the panel requests nothing from Google.
- `paint`, `read` and `translateTo` are each their own entry, beside `settings` and `keys`, so
  that saving one and the provider's Save never write over each other.
- The E2E cannot answer Chrome's permission prompt (a native dialog no CDP command or switch
  accepts), so it stubs `chrome.permissions.request` and the mock provider allows CORS. The
  path from a real grant to the provider fetch is not covered by a test.

## Verify: every node is checked before it is drawn

- `verifier(paragraphs)` (`src/lib/verify/`) prepares the page once per build and returns the
  per-node hook. It adds `anchor` and `flags` to each node, and may repair its `src`. The checks
  are synchronous string work, so the hook takes no abort signal. None of them reads certainty:
  the prompt's hedge rule is the whole of SPEC §4.2.
- In a build a paragraph number outside the page never reaches the hook: `readyNodes()` rejects
  it as a broken answer, which is retried. `verifier()` also refuses one itself, with a
  `RangeError` naming the node and the number, for callers that skip `readyNodes()` (the eval).
- **One matcher places every source (decision 4).** The verdict's and each claim's `basis`, and
  each evidence quote, are searched for as whole words in the cited paragraphs in citation order,
  then in the rest ("10%" is not found in "110%"). Quote and dash variants, case, spacing, the
  page's invisible characters (a soft hyphen) and quote marks or punctuation at the passage's
  edges do not matter; an index map turns the match back into offsets in the page's own text,
  which the page agent highlights, with the sentence's closing stop when the passage has one.
  - Found in a cited paragraph: ✓. Found in another: the citation is repaired (↪). Evidence moves
    to that paragraph, since a quote comes from one; a claim or the verdict adds it.
  - Not found: ⚠, and clicking the text falls back to the whole first cited paragraph.
- **Clicking a node's text shows its source on the page; hovering names it.** A claim or the
  verdict highlights its basis sentence. A quote highlights exactly its own words, and its tooltip
  (a native `title`) shows the whole sentence around them. A ¶ button highlights the paragraph.
- **Numbers are declared, not inferred (decision 8).** Every number in the verdict, a claim's
  title or a claim's body must be in the paragraphs the node cites, compared as values
  ("fifty-seven" is 57, "3.2m" is 3,200,000). A missing one is flagged with the paragraph that
  does hold it, if any. Evidence marked `derived` is exempt only when it states a number; a
  "derived" value with no number is located like a quote, so the tag cannot excuse a paraphrase.
  A lone "one" or "two" is not read: in prose they are mostly pronouns and determiners.

## The reader's language (SPEC §5.1)

- `src/panel/translate.js` picks the tree's second language and translates it with Chrome's
  on-device Translator (Chrome 138+, desktop). The model writes the tree once, in the article's
  language; translation costs no tokens and needs no key, so the demo and saved trees translate
  too. Only the verdict, the titles and the bodies are translated: quotes are the page's words.
- The second language is the one the reader chose, else the first of `navigator.languages` that
  isn't the article's, compared as the Translator names languages (`zh-TW` is `zh-Hant`, `pt-BR`
  is `pt`). A reader with no other language sees nothing. One who has another but cannot have
  the tree in it (a Chrome without the Translator, a pair it reports `unavailable`, or an
  `availability()` that throws) sees why, in the switch's place, never a switch that silently
  does nothing. The tree opens as written when the reader reads the article's language and in
  Both when they don't, until they choose.
- The reader chooses it in Settings or from the ▾ beside their language on the switch: one
  setting, applied by `settings.js` `chooseLanguage()` from either. The ▾ is a native select, so
  it opens Chrome's own list, whose pick counts as the click a download needs. Its list disables
  the article's language, and a pick Chrome cannot translate into is refused, with why: either
  would leave no switch to choose again from. A language picked there while the tree shows the
  original is shown, in the reader's-language view.
- Each line is `span.orig` then `span.tr`; CSS on `body[data-read]` shows one, the other or
  both. The panel translates only what the current view shows, each text once per pair (a
  per-text memo: a saved tree is drawn node by node in one loop, and every node would otherwise
  ask again for every line not yet back), and writes only into lines still on screen.
- Chrome downloads a language's model the first time, and only after a click in the panel. A
  tree drawn by a peek, before any click, shows "Translate into …" instead of a failure; the
  click is the gesture Chrome needs.
- In the reader's-language view, hovering a line shows its original and then its source
  sentence, and the node's flags show as they do in every view.
- Playwright's Chromium has the real Translator in extension pages, but not on web pages. A test
  must never make it download a model: the E2E starts Chromium with `--lang=en-US` (languages `en-US, en`),
  which offer no second language on the English fixtures, and `tests/e2e/setup.js`
  `withTranslator()` replaces it with a fake for the translation tests. CDP's
  `Page.addScriptToEvaluateOnNewDocument` needs `Page.enable` first, or it is registered and
  never runs.

## Saved trees (SPEC §5.1)

- A complete tree is saved in `chrome.storage.local`, not SPEC §6's IndexedDB: one store holds
  settings and trees, and a stand-in for it runs the cache's tests in Node. The key is
  `tree:<sha256 of the URL without its #fragment and the text the model was sent>`, and the entry
  keeps its model and when it was saved and last shown. Past `CACHE_CAP` entries the least
  recently shown are dropped (`src/lib/cache.js`). Nothing leaves the machine (SPEC §4.6).
- Build shows the saved tree for the page's current text, with no request; Rebuild asks the
  provider again and replaces it. A page whose text changed is a page with no saved tree.
- A saved tree is drawn through the same validator and checks as a streamed one, against the
  page as it reads now. One the validator rejects was saved by a version with another schema;
  it is dropped, and Build builds the page afresh. So is one saved before trees named their
  language (`lang`), which could never be read in the reader's. A new build must name it: an
  answer without `lang` is a broken answer, asked for once more (`lib/build.js`), so no tree
  without it is saved. The eval keeps scoring older trees, which is why the validator itself
  does not require `lang`.
- The panel peeks when it opens, when the toolbar icon is clicked on its tab, when its tab loads
  a page, and when the demo page asks: it reads its tab and, on a document not on screen, enters
  it, with its saved tree (or the demo's) drawn if there is a valid one and otherwise the word
  that Build reads it. A peek never builds and sends nothing. It leaves the document on screen as
  it is, tree included, unless its changed text has a saved tree; it gives way to a Build that
  starts while it reads, and runs again after one that was running.

## The first-run demo (SPEC §5.5, §4.7)

- `src/demo/demo.html` is a snapshot of one Wikipedia article at a pinned revision, CC BY-SA 4.0,
  with its attribution and licence in the page. It holds only the paragraphs the extension's own
  extractor reads from that revision, as plain headings and paragraphs. `src/demo/demo-tree.js`
  holds a tree built from it through the extension's own prompt (as it was before trees named
  their language: the panel gives it `lang: 'en'`, and its `zh` fields go unread), transport and checks: a selected
  run, the first with every node on the page and no flags, which the script alone will write
  (its header names the run and why the earlier runs were flagged).
  `scripts/build-demo.mjs` makes both, and `DEMO_META.textSha256` pins the text the tree was
  built from; `tests/e2e/demo.spec.js` checks the page still reads as that text.
- It is the one article text the repo carries (AGENTS.md).
- **The panel offers it; installing opens no tab.** An install-time tab would open in every E2E
  test's fresh profile and race the tests for the active tab.
- **The demo page runs the page agent itself.** Chrome lets no extension script an extension page,
  with activeTab or without, and through Chrome 153 does not show the panel its URL. The page imports `pageAgent`
  and answers `{demo: req}` messages (`chrome.tabs.sendMessage` reaches an extension page), and
  answering is how the panel tells it apart (`src/panel/page-link.js`). Each load of the page
  names itself, as Chrome's `documentId` names a web page's document, so a reloaded demo is drawn
  afresh rather than taken for the one on screen. `tests/e2e/demo.spec.js`
  has a canary for this constraint.
- The demo page's "Open the tree" button opens the side panel itself (a click in an extension page
  is a user gesture). Build on the demo page draws the demo's tree; no key is needed.

## Keyboard shortcut

- `commands._execute_action` (Alt+Shift+P) is the toolbar click by another route: with no popup it
  fires `action.onClicked`, and Chrome grants activeTab on it as on the click. No test presses it:
  a browser-level shortcut cannot be sent from the harness, so the manifest test pins it instead.

## The eval (SPEC §8)

- `eval/eval.mjs` runs in steps (`extract`, `run`, `score`, `tested`, `check`) over one run directory,
  `eval/results/<run>/`. Its header lists the commands.
- **Pages are read by the shipped page agent** (decision 9): Playwright's full Chromium opens
  each URL with a desktop user agent and runs `pageAgent({op: 'extract'})`, so the paragraphs the
  models get, and the anchor rate measured on them, are what a reader's build would send. A page
  is read once `load` fires or 20 s after the document is parsed, whichever is first (ad scripts
  can hold `load` back for a minute), then 2 s later. A page under 5 paragraphs is not built.
- **Every build is the extension's**: `treePrompt()`, `buildTree()` with its validator and one
  retry, and `verifier()` on each node, through the extension's transports with its thinking-off
  params. Two request fields are added: `stream_options: {include_usage: true}` on
  chat-completions requests, so the build can be priced, and an output cap of
  `MAX_OUTPUT_TOKENS` (`eval/lib/models.js`) on every request, so its cost is bounded. A build
  that runs past 240 s is stopped.
- **Claude runs through `claude -p`** (`eval/lib/claude-cli.js`), since no Anthropic key exists
  here: its system prompt replaced by the tree prompt, tools off, thinking off
  (`alwaysThinkingEnabled: false`), and the schema reduced by the Anthropic transport's own
  `lenientSchema()`. The CLI returns the answer as the input of a StructuredOutput tool call; the
  first call is read, and the build ends when it closes. The CLI's own schema retry is not read,
  but its cost counts: the process is read to its end in the background. Its times include the
  CLI's start (a second or two to the first response), and Sonnet's tool input usually arrives in
  one burst near the end, so its time to verdict is close to its tree time. These times describe
  the CLI, not the extension's Anthropic transport, which streams text and is still not run live;
  the settings table marks those rows `via claude -p`.
- **The spend cap** counts `spend.jsonl`. A build starts only when its worst case fits under the
  cap with what running builds have reserved: two attempts of its prompt and `MAX_OUTPUT_TOKENS`,
  a bound the requests enforce. claude -p gets it per response through
  `CLAUDE_CODE_MAX_OUTPUT_TOKENS` in its environment, since no flag sets it, and `--max-budget-usd`
  for the whole process, its own retries included; the CLI checks that budget only after each
  response, which the per-response cap bounds. Reservations live in the running process, so a lock (`run.lock`) lets one run at a
  time spend from a ledger. A cap that is not a positive number is refused. Cost is the
  provider's reported tokens at its list price, or claude -p's own reported cost, kept also when
  the CLI fails without an answer. An answer abandoned mid-stream has no final usage report, so
  it is counted from its characters, three to a token, or from what was reported so far if that
  is more, and marked estimated. A claude -p process still running two minutes after its answer
  is killed. Ctrl-C stops the builds in flight as a reader's Stop would, records what they cost,
  keeps no tree from them, and exits 130; a second Ctrl-C quits at once. A malformed `--cap` or
  `--concurrency` is refused.
- **A model that cannot be reached** prints `SKIPPED <model>: <why>`, and the run records it in
  `skipped.json`, which the summary lists: what the run saw, not the environment of whoever scores
  it.
- **Page text never reaches git.** The pages, raw answers and trees (whose quotes and bases are
  the pages' words) stay in the run's `local/`, which is gitignored. The committed files hold
  URLs, text hashes, statuses, numbers, costs, and notes, which may quote a few words of a page
  but never eight in a row: `score` and `tested` refuse to write a file that repeats eight words
  in a row from a page the run measured, and they and `check` read every file of the run outside
  `local/` again (a Han, kana or hangul character counts as a word). So re-scoring offline works
  on the machine that ran the build.
- **`score` checks the stored trees again** with the current `readyNodes()` and `verifier()`, so a
  change to the checks is measured without a model call: quotes and bases anchored, and number
  flags. `tested` writes a row for every model that built a tree. The 2026-09-24 run also holds
  `reviews.json`, a review (by a Claude Opus session) of 167 verdicts and titles for hedge flips, kept as that run's
  record; nothing reads it. Scoring that run again would rewrite its
  `results.json` and `summary.md` in the current shape, so it is left as it was scored.

## No on-device model (SPEC §9.2)

Chrome's Prompt API (`LanguageModel`) runs a model on the reader's computer, with no key, and
the side panel can call it. A probe on 2026-09-26 found that it cannot build the tree, which is
why an on-device model stays out of scope. A reader without a key gets the free Gemini key
Settings links to instead.

- **How it was measured:** Chrome 154.0.8037.57 on an Apple M4 Pro, whose `prompt_api` model is
  `nano_v3_gpu_component` 2025.8.8.1141 (a 9216-token window). Twelve of the 2026-09-24 run's
  pages, spread over kinds and 3k-26k characters, went through the eval's own `runOne()` (the
  shipped prompt, `buildTree()` with its one retry, `verifier()`) and `scoreRun()`. A stand-in
  session replaying a cloud model's stored trees scored the same as that model, so the harness
  was not the difference.

  | Variant | Trees | First try | Bases anchored | Tree time, median |
  |---|---|---|---|---|
  | `responseConstraint`: the tree schema | 6/12 | 50% | 11.5% | 20.6 s |
  | no constraint | 2/12 | 8.3% | 0% | 30.8 s |
  | gemini-3.8-flash, same pages | 12/12 | 100% | 100% | 5.2 s |

- **With the schema enforced, every failure was the same runaway.** After a branch's `body`,
  where the schema requires `children`, the model wrote whitespace, which JSON allows without
  bound, until Chrome stopped it with `QuotaExceededError` after 90-205 s. That is not a schema
  error, so the retry never runs.
- **Without it, the model left out the evidence**: `children` missing on 8 of the 10 failures,
  `body` on 1, a single child on 1, on both attempts.
- **The trees it finished fail §4.1.** 11.5% of the schema-enforced trees' bases resolve to a
  sentence on the page, and none of the other two's, against 91.9-100% for every cloud model
  measured on the same pages, because a basis joins several sentences. Branch titles are often section headings rather than claims, and 2 of 20
  branches cite ten or more paragraphs.
- **The window was not the limit**: the largest page used 988 + 5959 of its 9216 tokens.
- **Probe again when the Prompt API's model changes.** Chrome 154 also ships
  `gemma4_4b_component` and `gemma4_12b_component` behind their own use cases, while
  `prompt_api` still maps to Nano. For a re-run: Chrome installs the model only with 20 GiB free
  on the profile's volume, while `availability()` still answers `downloadable`; Playwright's
  default switches (`--disable-features=OptimizationHints`, `--disable-component-update`) make it
  `unavailable`, so a probe launches Chrome itself and connects over CDP; and closing that window
  mid-download restarts the 4 GB download from zero.

## What reaches the network (SPEC §9.4)

- `tests/e2e/network.spec.js` records the requests of the side panel from its start-up on and of
  the service worker (CDP Network), and of the pages (Playwright), through a build, source
  clicks, a saved tree and a Rebuild, Settings, and through the demo. Everything but the
  extension's own files goes to the configured provider, Settings' model check (a GET) included;
  the demo sends nothing. Translation
  makes no request of the extension's: a language's model is Chrome's own download, which no test
  triggers. The worker's
  own start-up happens before any recorder can attach and is not recorded; it only registers
  listeners. `tests/unit/rules.test.js` keeps `fetch` to `providers/http.js` and keeps extension
  pages from loading scripts, styles, images or frames from the web and from calling
  `window.open`. A link the reader clicks (the demo's attribution, Settings' free key) is the
  reader's own navigation.
