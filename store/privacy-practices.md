# Privacy practices tab: Pyramid Reader (draft answers)

The Privacy practices tab is dashboard-only (no API fills it), one-time per permission, and the
usual publish blocker: a submission with an unanswered permission is refused. Fill it before the
first Submit. Every answer below describes the code in `src/` as it stands; a change that adds a
permission or a destination for page text needs a new answer here first.

## Single purpose description

> Turns the article on the current page into a summary in levels in the side panel: the
> conclusion first, then its claims, their verbatim evidence and the sentence on the page, each
> opened on demand and located on the page before it is drawn, using an AI model and API key
> the user supplies.

## Permission justifications

**activeTab**
> Granted only when the user clicks the toolbar icon or presses the keyboard shortcut in a tab.
> It lets the extension read the visible text of the page in that tab at that click, and of the
> same page loaded again (a reload), to show the page's title and any tree saved for it on this
> device, to build a tree when the user presses Build tree, and to scroll to and highlight the
> sentence a claim cites. The extension reads no web page in a tab the user has not clicked the
> icon in, reads no other page that tab then loads (its panel closes when the tab leaves the
> page), and declares no content script.

**scripting**
> Injects the page agent (`src/content/page.js`) into the page the user clicked the toolbar icon
> on, and into that page loaded again (a reload), to list the visible paragraphs, to highlight
> cited sentences with the CSS Custom Highlight API, and to tell the panel which paragraph the
> user points at, clicks or scrolls to, so the panel and the page stay in step; that stays on the
> device and is never recorded. The page's DOM is never modified. No content
> script is declared or registered, and nothing is injected into a tab the user has not clicked
> the icon in, nor into another page that tab then loads.

**sidePanel**
> The extension's whole user interface is the side panel: the tree, the source clicks, the
> Read-in switch and Settings. Nothing is injected into the page as UI.

**storage**
> `chrome.storage.local` holds the user's settings (provider, model, base URL), their API keys
> (local only, never `storage.sync`), their paint and reading preferences, and the trees built
> for pages they visited, so a page opened again shows its tree without a new request. Nothing
> is stored anywhere else.

**Host permissions** (all under `optional_host_permissions`, requested one at a time when the
user saves a key for that provider; install asks for none)
> Each entry is one AI provider's API origin: api.openai.com, api.anthropic.com,
> generativelanguage.googleapis.com (Google Gemini), api.deepseek.com,
> dashscope-intl.aliyuncs.com (Qwen), api.moonshot.ai (Kimi), openrouter.ai, plus localhost and
> 127.0.0.1 for a model server running on the user's own computer (Ollama, LM Studio). The
> permission is requested only when the user saves a key for that provider and only for that
> origin, and it is used only to send the visible paragraphs of the page in a tab whose
> panel's Build tree the user pressed (when Build waits for the toolbar-icon click Chrome
> requires, the page the tab shows at that click) and to receive the tree, and, in Settings, to ask that provider whether it serves
> the chosen model. There is no `<all_urls>` and the extension sends no request to any other site.

## Remote code

> **No.** The extension loads no remote JavaScript, WebAssembly or CSS. The provider's answer is
> JSON data, validated against a fixed schema and drawn by the extension's own code through
> `textContent` only.

## Data usage: what the extension collects or handles

Tick these three, with the explanations the form allows:

- **Website content**: when the user presses Build tree, the visible text of the page in that tab
  (or, when Build waits for the toolbar-icon click Chrome requires, of the page the tab shows at
  that click) is sent to the AI provider the user configured, with the user's own API key, to build the tree. It is not
  sent to the developer or anywhere else, and never stored outside the user's browser (the built
  tree, whose quotes are the page's words, is saved in the user's local extension storage).
- **Authentication information**: the user's API key for the provider they chose is stored in
  the user's local extension storage and sent only to that provider's origin, as that provider's
  API requires. The developer never receives it.

- **Web history**, stored locally only: for each page the user built a tree on, the saved tree
  entry holds that page's address and when it was built and last shown, so the page shows its
  tree again without a new request. It never leaves the device and is never transmitted. (The
  store's definition of web history is the pages visited plus data such as time of visit; this
  is that, for built pages only, so it is ticked, saying it stays local.)

Leave unticked: personally identifiable information, health, financial and payment, personal
communications, location, user activity. The extension records none of them.

## Certifications (tick all three)

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

The transfer to the AI provider is the user's own request, with their own key, for the item's
single purpose, which the Limited Use policy permits when disclosed; the privacy policy and the
store description both disclose it.

## Privacy policy URL

`https://peach-studio.com/privacy_policy_pyramid-reader.html` (live; its source is
`privacy-policy.html` beside this file: change it there, then redeploy the studio site's copy).
