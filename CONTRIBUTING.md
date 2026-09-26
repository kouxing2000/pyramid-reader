# Contributing to Pyramid Reader

Thanks for your interest. This is a small, zero-dependency, zero-build Chrome MV3 extension, so
contributing is deliberately low-ceremony. The product spec, `docs/SPEC.md`, is the contract:
its §4 principles are hard constraints, and a change that needs to break one is a question to
open first, not an implementation choice.

## Ground rules

- **No build, no bundler, no runtime dependencies.** Chrome loads `src/` as it is. The
  `package.json` devDependencies are test tooling only and are never bundled. Keep it that way.
- **Every `src/**/*.js` is an ES module**, and every one except the entry points
  (`background.js`, `panel/panel.js`, `demo/demo.js`) must import cleanly in Node, so unit tests
  and the eval reuse the real code. Only entry points touch `chrome.*` or the DOM at module top
  level. Code that runs in the page (`src/content/page.js`) is a self-contained function injected
  with `chrome.scripting.executeScript({ func })`.
- **Model text reaches the DOM only via `textContent`.** Never `innerHTML` for anything a model
  or a page wrote. `tests/unit/rules.test.js` lints `src/` for this, for `storage.sync`, for
  console output and for a network call outside `providers/http.js`; `manifest.test.js` pins the
  permissions and `modules.test.js` the Node importability.
- **Nothing leaves the machine but the request to the provider the reader chose.** The one
  network call is `src/lib/providers/http.js`. API keys live in `chrome.storage.local` only, never
  `storage.sync`, never a log. A change that adds tracking, an always-on permission or a second
  destination for page text is very unlikely to be accepted.
- **Minimal permissions.** Install-time permissions stay `activeTab`, `scripting`, `sidePanel`,
  `storage`. Provider origins are `optional_host_permissions`, each a specific origin, requested
  when a key is saved. No `<all_urls>`, no content script.
- **No article text in the repo.** Test fixtures are HTML written for the tests
  (`tests/fixtures/pages/`); the eval keeps page text in its gitignored `local/`. The one
  exception is the first-run demo in `src/demo/`, a CC BY-SA Wikipedia article with attribution,
  which `scripts/build-demo.mjs` writes: rebuild it, don't edit it.

## Develop locally

1. Clone the repo.
2. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `src/`.
3. On any article, click the toolbar icon or press **Alt+Shift+P**; the side panel opens. With
   no key saved, the panel offers the bundled demo article and its tree. To build on a real page,
   open Settings (the gear) and save a provider, model and key.

### The reload gotcha

- `background.js` changes → reload the extension card on `chrome://extensions`.
- Panel changes (`src/panel/`, `src/lib/`) → close and reopen the side panel; the panel is an
  extension page and loads its modules fresh each time.
- `src/content/page.js` is injected per call, so a page never holds a stale copy; a page left
  painted by an older panel clears when that panel closes.

## Tests

Node 22 or later.

```bash
npm install
npx playwright install chromium          # first run only
npm test                                 # unit tests, then Playwright E2E (headless, plus one headed spec)
npm run test:unit                        # node --test tests/unit/
npm run test:e2e                         # Playwright only
npm run test:headed                      # visible browser
PR_CHROME="/path/to/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" npm test   # another Chromium / Chrome for Testing build (branded Chrome cannot load unpacked extensions)
xvfb-run -a npm test                     # Linux with no display: one spec runs headed
node --test tests/unit/tree.test.js      # one unit file
npx playwright test tests/e2e/demo.spec.js   # one E2E file
```

The E2E loads `src/` unpacked in Chromium and drives the real side panel over CDP
(`tests/e2e/side-panel.js`); trees are built against a local mock provider
(`tests/e2e/mock-provider.js`), never a real one. Please run `npm test` before opening a PR, and
add or update a test when you change behavior. `docs/DESIGN.md` records where the build differs
from SPEC §6: add any new deviation there.

The eval (`eval/`) spends real money and needs API keys; see the README before running it.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(panel): …`,
  `fix(verify): …`, `test: …`, `docs: …`.
- Keep PRs focused; describe the user-visible change and how you verified it (UI changes need a
  screenshot or a clear repro).
- Add a bullet under **`## [Unreleased]`** in `CHANGELOG.md` for any user-facing change.
- Don't bump the version, and don't commit a zip or generated store assets in a feature PR;
  releases are the maintainers'.
- Never commit an API key, a page's text, or a tree built from a real page.

## Security

Found a vulnerability? Please report it privately, as `SECURITY.md` asks, not in a public issue.
