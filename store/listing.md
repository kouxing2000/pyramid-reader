# Chrome Web Store listing: Pyramid Reader (draft)

Draft copy for the Developer Dashboard. Everything here is pasted by hand: the Web Store API
uploads and publishes the package only; listing fields, privacy practices and assets are
dashboard-only. Companion files: `privacy-practices.md` (the Privacy practices tab) and
`privacy-policy.html` (the page the privacy URL serves).

## Item

| Field | Value |
| --- | --- |
| Publisher | The **peach-studio group** publisher. Create the item signed in as a member of that group and pick the group publisher in the "Publisher" field before the first upload: an item created under an individual publisher and moved to the group later loses its original-author standing with the store. The group's address and the sign-in account are kept outside this repo. |
| Package | `dist/pyramid-reader-v<version>.zip` from `npm run package` (manifest.json at the zip root). |
| Version | The `version` in `src/manifest.json`, which names the zip. Every later upload must be strictly higher. |
| Name | Pyramid Reader |
| Category | Tools (in the Productivity group). Education is the alternative if the dashboard's list reads better that way; the dashboard's current list decides. |
| Language | English |
| Visibility | Unlisted for the draft and the first review, so the link can be shared for dogfooding before the listing is searchable; Public once the SPEC §9.5 gates are met. |
| Distribution | All regions. |

## Short description (132 characters max)

The manifest's description (`src/manifest.json`), which fits the cap, is the store's short description too:

> Read the conclusion first, then open only the levels you need: claims, evidence, the sentence on the page.

## Detailed description (plain text; the dashboard renders no markdown)

The conclusion first. Every level under it, when you ask.

Pyramid Reader turns the article you are reading into a summary in levels, in a Chrome side panel. The name is the pyramid principle: the answer first, then the levels that support it.

A SUMMARY IN LEVELS
The first screen is the conclusion alone: one sentence, and the kind of page it came from. Under it, three to five claims, each folded to its title. Open a claim when you want more than its title: its summary, its sources, its verbatim quotes. Click a quote, or a claim, and the page itself scrolls to the sentence it came from. Four levels, the top first; open only what you don't already know, and leave the rest folded.

CHECKABLE, ONE CLICK FROM THE PAGE
Every claim and every quote is located on the page before it is drawn; hover a line and its sentence shows in a tooltip without moving the page. A quote that could not be found on the page is marked, never hidden. The whole tree is painted on the page in each claim's colour, so you can see where the argument lives as you scroll.

THE ARTICLE'S OWN HEDGES, KEPT
The model is told that a verdict or claim may never be more certain than the sentences it cites: "remains unclear" must not become "unlikely". Numbers in the verdict and claims must be in the paragraphs they cite, or they are flagged. Settings recommends models measured on the eval, and shows each one's anchor rate and speed.

READ IT IN YOUR LANGUAGE
The verdict and claims can be read in your own language, translated on your computer with Chrome's built-in translator (Chrome 138+): as written, both, or yours. Quotes stay the page's words. No tokens, no key, nothing sent.

YOUR OWN MODEL AND KEY, NO SERVER
Pyramid Reader calls the AI provider you choose, directly from your browser, with your API key: OpenAI, Anthropic, Google Gemini, or any OpenAI-compatible endpoint (DeepSeek, Qwen, Kimi, OpenRouter, or a local server such as Ollama). The page's visible text goes to that provider and nowhere else. No account, no server of ours, no telemetry; keys stay in your browser's local storage and are never synced.

TRY IT BEFORE ADDING A KEY
A bundled demo, a Wikipedia article with its tree, works with no key at all: click through the claims, see the highlights, read it in your language.

WHAT IT DOES NOT DO
It does not chat about the page, translate the full text, or read text you cannot see: paywalled or hidden paragraphs are never sent. Trees are kept on your computer, per page, and never shared.

Open source (MIT) at github.com/kouxing2000/pyramid-reader.

## URLs

| Field | Value | State |
| --- | --- | --- |
| Privacy policy | `https://peach-studio.com/privacy_policy_pyramid-reader.html` | Live. Its source is `privacy-policy.html`; the studio site serves a copy, so change the source first and then redeploy the copy. |
| Homepage | `https://github.com/kouxing2000/pyramid-reader` | The public repo; also `homepage_url` in `src/manifest.json`. |
| Support | `https://github.com/kouxing2000/pyramid-reader/issues` | The repo's issues. |
| Official URL (verified publisher badge) | `peach-studio.com` | Pick it from the pull-down under Additional fields once the listing exists. |

## Assets

| Asset | Requirement | State |
| --- | --- | --- |
| Store icon | 128x128 PNG; a 96x96 motif with 16px transparent padding reads best | `src/icons/icon128.png`: the summary bubble, the same file the manifest names. |
| Screenshots | 1 to 5, exactly 1280x800 (or 640x400), PNG or JPEG | `store/screenshots/` from `npm run screenshots`, in the order the levels open: `01-verdict.png` (the first screen: the verdict alone, every claim folded), `02-claim.png` (one claim opened on its summary and quotes), `03-sentence.png` (a quote clicked, its sentence highlighted on the page), `04-settings.png` (provider, model, empty key field, tested models). All from the bundled demo, so no third-party article text is in a store asset. A fifth, the tree read in Chinese (Read in: Both), is a hand capture in real Chrome, since the capture browser cannot download the translator model. |
| Small promo tile | 440x280, optional | None yet. |
| Marquee | 1400x560, optional | None yet. |
| Promo video | YouTube URL, optional | None. |

## Store listing fields that ask a question

- **Single purpose**: see `privacy-practices.md`.
- **Mature content**: No.
- **Does this item use remote code?** No (the extension loads no remote scripts; model output is JSON drawn by fixed code).
- **Trader / non-trader** (if the dashboard asks under the EU rules): whatever the publisher account already declares; it is an account-level field.
