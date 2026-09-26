# Security Policy

Pyramid Reader is a Chrome MV3 extension. It runs **only when you invoke it** (toolbar click or
`Alt+Shift+P`), reads the visible text of that one page, and sends that text to the AI provider
you configured, with your own API key, and nowhere else. Nothing is sent to the developer. Keys
are stored in `chrome.storage.local` on your machine. Because the extension handles an API key
and sends page text to a third party you chose, security reports matter to us.

## Supported versions

Only the latest released version is supported. Please make sure you are on the current version
before reporting.

## Reporting a vulnerability

Please report security issues **privately**. Do not open a public GitHub issue for an
exploitable vulnerability.

- **GitHub** → the repository's **Security** tab → **Report a vulnerability** (private advisory).
- **Email**: `studio.peach.go+pyramid-reader@gmail.com`.

Please include:

- The extension version (`manifest.json` `version`, shown on `chrome://extensions`).
- Your Chrome version and OS.
- Steps to reproduce, and the impact you believe it has.
- A proof-of-concept page or URL if one is relevant. If the issue involves a provider or model,
  name them, but **never include an API key**.

## What to expect

- We aim to acknowledge a report within **7 days**.
- We'll confirm the issue, agree on a fix and a disclosure timeline with you, and credit you in
  the release notes unless you'd prefer to stay anonymous.
- Fixes ship as a new Chrome Web Store version; the rollout then depends on Google's review queue.

## Scope

In scope: everything in `src/`, which is what ships in the extension package: the manifest, the
side panel, the page agent, the provider transports and the verify step. Of particular interest:
any way page text or a key could reach a destination other than the configured provider's
origin, any way model or page text could reach the DOM as markup, and any way a page script
could drive the panel.

Out of scope: the developer's tooling (`scripts/`, `eval/`, `prototype/`, `tests/`, CI), the AI
providers themselves and their models' output, and the content of the pages you choose to read
(the extension quotes that content; it does not vet it).
