# Pyramid Reader

**The conclusion first. Every level under it, when you ask.**

A Chrome side panel that turns the article you are reading into a summary in levels: a
one-sentence verdict on top, each claim folded to its title under it, its evidence one click
away, and the page's own sentence one click further. Open only what you don't already know.
Every line is checked against the page before it is drawn, and the model is told to keep the
article's own hedges. The verdict and claims can be read in your own language, translated on
your computer. Runs on your own model and API key: the page's visible text goes only to the
provider you configure, with your key, and nothing goes to the developer.

Start with `docs/SPEC.md`, the product spec, then `docs/DESIGN.md`, where the build differs from
it and why.

Needs Chrome 116 or later (138 or later to read a tree in your own language) on a computer, and
Node 22 or later for development. Privacy policy:
<https://peach-studio.com/privacy_policy_pyramid-reader.html>.

- `src/` — the extension. Until it is on the Chrome Web Store, load it unpacked: `chrome://extensions`
  → Developer mode → Load unpacked → `src/`. Then click the toolbar icon (or press `Alt+Shift+P`)
  on an article; with no key yet, the panel offers a bundled demo article and its tree.
- `tests/` — `npm install && npx playwright install chromium && npm test` (Node unit tests, then Playwright E2E)
- `scripts/` — dev tools, never shipped: `smoke.mjs` runs one provider live through the extension's
  own pipeline; `build-demo.mjs` rebuilds the first-run demo (`src/demo/`); `package.mjs` zips
  `src/` for the Chrome Web Store (`npm run package`); `screenshots.mjs` captures the store
  screenshots from the demo (`npm run screenshots`)
- `eval/` — the eval (SPEC §8), never shipped: `pages.txt` lists the pages, `eval.mjs` reads
  them, builds and scores trees per model, and writes the settings' tested-models table; each run's
  results and summary are in `eval/results/<run>/`
- `docs/SPEC.md` — product spec, including the MVP chapter (§9)
- `prototype/` — the throwaway Python prototype (`read.py` builds a tree via `claude -p`,
  `check.py` checks quotes and numbers against cited paragraphs)

## Running the eval

The eval spends real money on each model it builds with. Every step takes `--run <name>`
(default: today's date) and works in `eval/results/<name>/`.

```sh
node eval/eval.mjs extract                       # read every page in eval/pages.txt (free)
node eval/eval.mjs run --models all --cap 10     # build trees; --pages every:2 for a subset
node eval/eval.mjs score                         # re-check offline, write results.json, summary.md
node eval/eval.mjs tested                        # write the rows to src/lib/tested-models.js
node eval/eval.mjs check                         # confirm no committed file repeats page text
```

- **Keys** come from the environment: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`,
  `DEEPSEEK_API_KEY`. A model whose key is missing prints `SKIPPED <model>: no key`, and the
  summary lists it.
- **`--cap` is dollars for the whole run** (default 10), counted from `spend.jsonl`. A build starts
  only when its worst case fits under the cap, and each request caps its own output. Run a pilot
  first (`--pages ids:<id,...>`) and read its cost per tree before a full run. One run at a time
  spends from a run's ledger. Ctrl-C stops the builds in flight and records what they cost.
- **Claude runs through `claude -p`** (`~/.local/bin/claude`), not the extension's Anthropic
  transport, and bills the dev machine's Claude plan: its reported cost counts against the cap,
  its times include the CLI's start, and the settings table marks those rows "via claude -p". The
  run stops Claude builds when the plan's weekly use passes 90%.
- Page text, raw answers and trees stay in the run's gitignored `local/`; the other files in the
  run directory are what gets committed.

## Contributing

`CONTRIBUTING.md` has the ground rules and the reload gotchas; `CHANGELOG.md` lists what changed.
Found a security problem? Report it privately, as `SECURITY.md` asks, not in a public issue.

## License

MIT (`LICENSE`), except the first-run demo in `src/demo/` (`demo.html`, `demo-tree.js`): a
Wikipedia article and the tree built from it, under CC BY-SA 4.0 (`NOTICE`).
