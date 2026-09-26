# Pyramid Reader — agent instructions

- **This is a public, open-source repo (MIT).** Never commit anything personal or
  publishing-sensitive: personal emails, store or OAuth credentials, publisher IDs, analytics, or
  the names of the maintainer's private tooling. `docs/NEXT.md`, `docs/research/` and `design/`
  are local only (gitignored). Scan every diff for these before committing.
- **If `docs/NEXT.md` exists (maintainer-local), start a session with it** — the dated handoff:
  current state, next milestone, loose ends outside the repo. Update it when a milestone lands.
- **The spec is the contract**: `docs/SPEC.md`. Its §4 principles are hard constraints; a change
  that needs to break one is a question for the maintainers, not an implementation choice.
- **Zero runtime dependencies** in the shipped extension (vanilla JS, MV3). Dev tooling
  (Playwright, scripts) lives in `package.json` devDependencies only.
- **Never commit article text** scraped from third-party sites — test fixtures are HTML written
  for the tests; the eval fetches pages at run time, keeps their text and the trees built from
  them (whose quotes are the pages' words) in its gitignored `eval/results/<run>/local/`, and
  commits only URLs, text hashes, scores, reviews and costs.
  The one exception is the first-run demo (SPEC §5.5) in `src/demo/`: `demo.html`, a single CC
  BY-SA Wikipedia article at a pinned revision, with full attribution and licence, visible
  paragraphs only, and `demo-tree.js`, the tree built from it, whose quotes are that article's
  words. `scripts/build-demo.mjs` writes both.
- **Model text reaches the DOM only via `textContent`.** API keys live in `chrome.storage.local`
  only and never appear in logs, tests or commits.
- `prototype/` is reference material, not product code: read it, don't build on it.
- **`src/` is the unpacked extension** — the only directory Chrome loads and the only one that
  ships; docs, prototype, tests and `node_modules/` stay outside it.
- **Every `src/**/*.js` is an ES module** (`"type": "module"`), and every one except the entry
  points (`background.js`, `panel/panel.js`, `demo/demo.js`) must import cleanly in Node, so unit tests and the eval
  reuse the real code. So only entry points touch `chrome.*` or the DOM at module top level.
  Code that runs in the page exports self-contained functions injected via
  `chrome.scripting.executeScript({ func })` — injected files run as classic scripts, where
  `export` is a syntax error — and tests pass the same function to Playwright's `page.evaluate`.
- `npm test` runs `node --test` unit tests (`tests/unit/`) then Playwright E2E (`tests/e2e/`),
  which loads `src/` unpacked in Chromium (first run: `npx playwright install chromium`);
  `npm run test:headed` shows the browser. Playwright has no Page for Chrome's side panel, so
  E2E drives the real panel through `tests/e2e/side-panel.js` (raw CDP, trusted input) and clicks
  the toolbar icon with CDP `Extensions.triggerAction`. Page fixtures are served over http from
  `tests/fixtures/pages/`; trees are built against `tests/e2e/mock-provider.js`, a local
  OpenAI-compatible endpoint (never a real provider, never a real key).
- `docs/DESIGN.md` records where the build differs from SPEC §6; update it with any new deviation.
- Stage explicit paths when committing — never `git add -A`.
