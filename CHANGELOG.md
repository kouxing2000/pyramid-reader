# Changelog

All notable changes to **Pyramid Reader** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.4] - 2026-09-26

- Settings points a reader with no API key to a free Gemini key from Google AI Studio, and notes
  that Google may use free-tier text to improve its products. Following the link sets the form to
  Google Gemini.
- The panel header names the page the panel reads, beside the Settings gear; Chrome's own side
  panel header already names the extension. The Settings sheet runs the panel's full width.
- Focus rings stay inside their segment, All / Focus / Off appears once a tree is on screen, and
  the Model field lines up with the others.
- The extension links to its source: https://github.com/kouxing2000/pyramid-reader.

## [0.0.3] - 2026-09-26

- A panel belongs to the page it was opened on: when the tab leaves that page it closes, and the
  next page gets a panel from its own icon click, so no page is read before you ask. Leaving is a
  new URL, without its #fragment: a link, the address bar, a site moving to another article by
  pushState; a reload or a # change keeps it. A build under way when you leave stops, and nothing
  is saved.

## [0.0.2] - 2026-09-26

- A panel belongs to its tab: the toolbar icon opens it for that tab only, and a tab whose icon
  was never clicked shows none. It keeps its tree while you are on another tab, and follows its
  tab to each new page it loads, with that page's saved tree or Build tree to read it; a page on
  another origin asks for one icon click first, since Chrome withdraws access there. A build under
  way when the tab moves on finishes and is saved for its page. The demo opens in a tab of its
  own, with its own panel.
- An icon: a speech bubble with its headline cut out and its detail lines only half there, the
  mark of a summary in levels. The panel header carries the same mark.
- The description, the panel's tooltips and the demo banner say what the tree is: the conclusion
  first, every level under it when you ask.

## [0.0.1] - 2026-09-25

The first release, open source under MIT.

- A Chrome side panel that turns the article on the page into a conclusion-first tree: a
  one-sentence verdict, 3-5 claims under it, verbatim evidence under each claim.
- Every node is checked before it is drawn: its sentence or quote is located on the page (✓),
  its citation repaired when the words are elsewhere (↪), or it is marked unanchored (⚠); a
  number the cited paragraphs do not hold is flagged.
- Clicking a claim or a quote scrolls the page to its sentence and highlights it; hovering names
  it. The whole tree is painted on the page in each claim's colour (All / Focus / Off), and the
  page tells the panel which claims are on screen and under the pointer.
- Read the tree in your own language: the verdict, titles and bodies translated on your computer
  with Chrome's built-in Translator (Chrome 138+), shown as written, in Both, or in your language.
- Bring your own model and key: OpenAI, Anthropic, Google Gemini, or any OpenAI-compatible
  endpoint (DeepSeek, Qwen, Kimi, OpenRouter, a local server). Keys stay in `chrome.storage.local`;
  the page's visible text goes only to the provider you chose.
- Settings recommend models and show a tested-models table measured by the eval: quotes anchored,
  time to verdict and to the whole tree.
- A first-run demo: a Wikipedia article (CC BY-SA 4.0, attributed) bundled with its tree, so a
  tree can be tried before any key is saved.
- Trees are saved locally per page and shown again on the next visit, with Rebuild.
