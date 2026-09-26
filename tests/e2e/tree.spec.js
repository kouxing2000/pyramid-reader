// End to end in Chrome's real side panel: the settings form, then Build streaming a tree from a
// local mock OpenAI-compatible endpoint (mock-provider.js) for tests/fixtures/pages/article.html,
// each node checked against the page (SPEC §5.3) and linked to its sentence there (SPEC §5.1).
import { test, expect } from './fixtures.js';
import { BUILT, configure, KEY, MODEL, openArticle, shown } from './setup.js';
import { highlighted } from './page-checks.js';
import { MSG, percent } from '../../src/panel/messages.js';
import { RULES } from '../../src/lib/prompt.js';
import { PROVIDERS } from '../../src/lib/providers/index.js';
import { TESTED_MODELS } from '../../src/lib/tested-models.js';
import { ARTICLE_PAGE, ARTICLE_TREE, FLAWED_TREE } from '../fixtures/trees/article.js';

const TEXT = JSON.stringify(ARTICLE_TREE);

test('Save asks for the endpoint\'s origin, and keeps the key in storage.local, for that origin only', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  const panel = await openArticle({ page, server, cdp, extensionId }, 'settings');
  // The panel fills the form from storage once it loads; a form filled before that is reset under
  // the test (to OpenAI, whose permission prompt no one answers).
  await expect.poll(() => panel.evaluate(() => document.getElementById('model').value)).not.toBe('');
  await panel.click('#settings summary');
  // What typing does: set the value, fire input.
  const type = (id, value) => panel.evaluate(({ id, value }) => {
    const field = document.getElementById(id);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }, { id, value });
  const fill = async (baseUrl) => {
    await panel.evaluate(() => {
      document.getElementById('provider').value = 'compatible';
      document.getElementById('provider').dispatchEvent(new Event('change'));
    });
    await expect.poll(() => panel.evaluate(() => document.getElementById('base-url-row').hidden)).toBe(false);
    await type('base-url', baseUrl);
    await type('model', MODEL);
    await type('api-key', KEY);
  };
  const stored = () => serviceWorker.evaluate(() => chrome.storage.local.get(null));

  // Chrome itself refuses an origin the manifest does not list: no prompt, nothing saved.
  await fill('https://api.example.com/v1');
  await panel.click('#save');
  await expect.poll(() => panel.text('#settings-status')).toBe(MSG.originNotAllowed('https://api.example.com'));
  expect(await stored()).toEqual({});

  // A listed origin gets Chrome's permission prompt, which no test can answer: stand in for the
  // reader's answer, first No, then Yes.
  await panel.evaluate(() => {
    window.permissionRequests = [];
    window.permissionAnswer = false;
    chrome.permissions.request = async (req) => { window.permissionRequests.push(req); return window.permissionAnswer; };
  });
  await fill(provider.baseUrl);
  await panel.click('#save');
  await expect.poll(() => panel.text('#settings-status')).toBe(MSG.permissionDenied(provider.origin));
  expect(await stored()).toEqual({});

  await panel.evaluate(() => { window.permissionAnswer = true; });
  await panel.click('#save');
  await expect.poll(() => panel.text('#settings-status')).toBe(MSG.saved);
  expect(await panel.evaluate(() => window.permissionRequests))
    .toEqual([{ origins: [`${provider.origin}/*`] }, { origins: [`${provider.origin}/*`] }]);
  expect(await stored()).toEqual({
    settings: { provider: 'compatible', providers: { compatible: { baseUrl: provider.baseUrl, model: MODEL } } },
    keys: { [provider.origin]: KEY },
  });
  expect(await serviceWorker.evaluate(() => chrome.storage.sync.get(null))).toEqual({});

  // Pointing the form at another endpoint does not carry the saved key along: the field empties,
  // and a Save stores no key for the new origin (localhost is another origin than 127.0.0.1).
  const other = provider.baseUrl.replace('127.0.0.1', 'localhost');
  await type('base-url', other);
  expect(await panel.evaluate(() => document.getElementById('api-key').value)).toBe('');
  await panel.click('#save');
  await expect.poll(() => panel.evaluate(() => window.permissionRequests.length)).toBe(3);
  await expect.poll(() => panel.text('#settings-status')).toBe(MSG.saved);
  expect(await panel.evaluate(() => window.permissionRequests.at(-1))).toEqual({ origins: [`${new URL(other).origin}/*`] });
  expect(await stored()).toEqual({
    settings: { provider: 'compatible', providers: { compatible: { baseUrl: other, model: MODEL } } },
    keys: { [provider.origin]: KEY },
  });
  await type('base-url', provider.baseUrl);
  expect(await panel.evaluate(() => document.getElementById('api-key').value)).toBe(KEY);

  // Nor does a URL that changes with no input event (autofill): the key field still shows the
  // stored key, but Save stores it for the origin it came from only.
  await panel.evaluate((url) => { document.getElementById('base-url').value = url; }, other);
  expect(await panel.evaluate(() => document.getElementById('api-key').value)).toBe(KEY);
  await panel.evaluate(() => { document.getElementById('settings-status').textContent = ''; });
  await panel.click('#save');
  await expect.poll(() => panel.text('#settings-status')).toBe(MSG.saved);
  expect((await stored()).keys).toEqual({ [provider.origin]: KEY });
});

test('Settings links a reader with no key to a free Gemini key, in a new tab, and sets the form to Google Gemini', async ({ context, page, server, cdp, extensionId }) => {
  // Google's page, stood in for: the test never reaches the web.
  await context.route('https://aistudio.google.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>AI Studio</title>' }));
  const panel = await openArticle({ page, server, cdp, extensionId }, 'free-key');
  await expect.poll(() => panel.evaluate(() => document.getElementById('model').value)).toBe(PROVIDERS.openai.model);
  await panel.click('#settings summary');
  expect((await panel.text('#free-key')).replace(/\s+/g, ' ')).toBe('No API key? Get a free Gemini key from Google AI Studio. ' +
    'On its free tier, Google may use the text you send to improve its products.');

  const opened = context.waitForEvent('page');
  await panel.click('#free-key-link');
  await (await opened).waitForURL('https://aistudio.google.com/apikey');
  const form = () => panel.evaluate(() => ['provider', 'model', 'api-key'].map((id) => document.getElementById(id).value));
  await expect.poll(form).toEqual(['gemini', PROVIDERS.gemini.model, '']);
  expect(await panel.evaluate(() => location.pathname)).toBe('/panel/panel.html'); // the panel itself stayed put

  // A middle click opens the link with no click event. Its background tab is pointed at a local
  // page, since context.route does not reach it.
  await panel.evaluate((url) => {
    document.getElementById('free-key-link').href = url;
    document.getElementById('provider').value = 'openai';
    document.getElementById('provider').dispatchEvent(new Event('change'));
  }, server.url('article.html?free-key-middle'));
  await expect.poll(form).toEqual(['openai', PROVIDERS.openai.model, '']);
  const point = await panel.evaluate(() => {
    const r = document.getElementById('free-key-link').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  for (const type of ['mousePressed', 'mouseReleased']) {
    await panel.send('Input.dispatchMouseEvent', { type, ...point, button: 'middle', clickCount: 1 });
  }
  await expect.poll(form).toEqual(['gemini', PROVIDERS.gemini.model, '']);
});

test('Build streams the tree verdict first, then claims and evidence; a ¶ button highlights its paragraph', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await configure(serviceWorker, provider);
  provider.answer(TEXT, { holdAt: TEXT.indexOf('"branches"') });
  const panel = await openArticle({ page, server, cdp, extensionId }, 'tree');
  await panel.click('#build');

  // The provider has sent only the verdict and its sources: the verdict is on screen, alone.
  await expect.poll(() => panel.text('.verdict .title')).toBe(ARTICLE_TREE.verdict);
  expect(await panel.texts('.verdict .kind')).toEqual(['report']);
  expect(await panel.texts('.verdict .cite')).toEqual(['¶3', '¶5']);
  expect(await panel.texts('.claim')).toEqual([]);
  expect(await panel.text('#status')).toBe(MSG.asking(MODEL));

  provider.release();
  await expect.poll(() => panel.text('#status')).toMatch(BUILT);
  expect(await panel.evaluate(() => document.getElementById('stop').hidden)).toBe(true);
  expect(await panel.texts('.claim > .node > .title')).toEqual(ARTICLE_TREE.branches.map((b) => b.title));
  expect(await panel.evaluate(() => [...document.querySelectorAll('.claim')].map((c) => c.querySelectorAll('li.evidence').length)))
    .toEqual([2, 0, 2]);
  expect(await panel.texts('.evidence .quote')).toEqual([
    'the cheapest bridges to build were often the most expensive to keep',
    'timber decks rot faster than anyone budgets for',
    'A council report estimated the backlog at 3.2 million',
  ]);
  expect(await panel.texts('.evidence .value')).toEqual([`About 29% of the footbridges need repairs (61 of 214) ${MSG.derived}`]);
  // Model text is text: the markup in a body shows as written and makes no element.
  expect(await panel.text('.claim[data-id="b0"] .body')).toBe(ARTICLE_TREE.branches[0].body);
  expect(await panel.evaluate(() => document.querySelectorAll('#tree *:not(section, div, p, span, ol, ul, li, button)').length)).toBe(0);

  // Every source was found where it is cited; the computed value has none to find.
  expect(await panel.texts('.check')).toEqual(Array(7).fill(MSG.anchored));
  expect(await panel.texts('.flag')).toEqual([]);

  // One request, to the configured endpoint, carrying only the visible paragraphs (§4.5).
  expect(provider.requests).toHaveLength(1);
  const [{ url, headers, body }] = provider.requests;
  expect(url).toBe('/v1/chat/completions');
  expect(headers.authorization).toBe(`Bearer ${KEY}`);
  expect(body).toMatchObject({ model: MODEL, stream: true, response_format: { type: 'json_object' } });
  expect(body.messages[0].content.startsWith(RULES)).toBe(true);
  const article = body.messages[1].content;
  expect(article.split('\n').filter((line) => /^\[\d+\] /.test(line))).toEqual(ARTICLE_PAGE.map((p) => `[${p.n}] ${p.text}`));
  expect(article).toContain('## Why it matters');
  expect(article).not.toContain('paywall');

  // Claims start folded. A click anywhere on a claim's row opens it to its body, sources and
  // evidence, and folds it again; the chevron too.
  expect(await shown(panel, '.claim .more')).toEqual([false, false, false]);
  await panel.click('.claim[data-id="b2"] > .node > .side .check');
  expect(await shown(panel, '.claim .more')).toEqual([false, false, true]);
  await panel.click('.claim[data-id="b2"] > .node > .num');
  expect(await shown(panel, '.claim .more')).toEqual([false, false, false]);
  await panel.click('.claim[data-id="b2"] .fold');
  expect(await shown(panel, '.claim .more')).toEqual([false, false, true]);
  // What opening shows keeps its own clicks: a source there folds nothing.
  await panel.click('.claim[data-id="b2"] .cite[data-n="3"]');
  await expect.poll(() => highlighted(page)).toEqual([ARTICLE_PAGE[2].text]);
  expect(await panel.evaluate(() => document.querySelector('[aria-current="true"]')?.textContent)).toBe('¶3');
  expect(await shown(panel, '.claim[data-id="b2"] .more')).toEqual([true]);

  // A claim's text shows its basis sentence on the page, and names it on hover.
  const b2 = ARTICLE_TREE.branches[2];
  await panel.click('.claim[data-id="b2"] .title');
  await expect.poll(() => highlighted(page)).toEqual([b2.basis]);
  expect(await panel.evaluate(() => document.querySelector('.claim[data-id="b2"] .title').title)).toBe(b2.basis);
  expect(await panel.evaluate(() => document.querySelector('[aria-current="true"]') ===
    document.querySelector('.claim[data-id="b2"] .title'))).toBe(true);
  expect(await shown(panel, '.claim[data-id="b2"] .more')).toEqual([false]); // its title, on an open claim, folds it

  // Expand all opens the rest. A quote shows exactly its words there; hovering shows the
  // sentence around them.
  await panel.click('.expand-all');
  expect(await shown(panel, '.claim .more')).toEqual([true, true, true]);
  await panel.click('.evidence[data-id="b0.1"] .quote');
  await expect.poll(() => highlighted(page)).toEqual(['timber decks rot faster than anyone budgets for']);
  expect(await panel.evaluate(() => document.querySelector('.evidence[data-id="b0.1"] .quote').title)).toBe(ARTICLE_PAGE[3].text);
});

test('the checks are shown: a quote moved to its paragraph, text not on the page, a number not in its source', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await configure(serviceWorker, provider);
  provider.answer(JSON.stringify(FLAWED_TREE));
  const panel = await openArticle({ page, server, cdp, extensionId }, 'checks');
  await panel.click('#build');
  await expect.poll(() => panel.text('#status')).toMatch(BUILT);

  expect(await panel.text('.evidence[data-id="b0.0"] .check')).toBe(MSG.repaired(4));
  expect(await panel.texts('.evidence[data-id="b0.0"] .cite')).toEqual(['¶4']);
  expect(await panel.text('.claim[data-id="b2"] .flag')).toBe(MSG.numberMissing('4.5 million', null));
  // A flag is never folded away with its claim; the verdict counts the sources found and the flags.
  expect(await shown(panel, '.claim[data-id="b2"] .more')).toEqual([false]);
  expect(await shown(panel, '.claim[data-id="b2"] .flag')).toEqual([true]);
  expect(await panel.text('.verdict .summary')).toBe(MSG.summary(6, 7, 1));

  // Text not on the page: clicking it falls back to the whole first paragraph it cites.
  expect(await panel.text('.claim[data-id="b1"] > .node .check')).toBe(MSG.unanchored);
  await panel.click('.claim[data-id="b1"] .title');
  await expect.poll(() => highlighted(page)).toEqual([ARTICLE_PAGE[5].text]);
  expect(await shown(panel, '.claim[data-id="b1"] .more')).toEqual([true]); // its text opened it

  expect(await panel.texts('.flag')).toHaveLength(1);
  expect(await panel.texts('.check')).toEqual([MSG.anchored, MSG.anchored, MSG.repaired(4), MSG.anchored,
    MSG.unanchored, MSG.anchored, MSG.anchored]);
});

test('a quote not on the page opens its claim, so the failed check is never folded away', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await configure(serviceWorker, provider);
  const tree = structuredClone(ARTICLE_TREE);
  tree.branches[0].children[1].quote = 'timber decks last longer than anyone budgets for';
  provider.answer(JSON.stringify(tree));
  const panel = await openArticle({ page, server, cdp, extensionId }, 'unanchored-quote');
  await panel.click('#build');
  await expect.poll(() => panel.text('#status')).toMatch(BUILT);
  expect(await shown(panel, '.claim .more')).toEqual([true, false, false]);
  expect(await panel.text('.evidence[data-id="b0.1"] .check')).toBe(MSG.unanchored);
  expect(await shown(panel, '.evidence[data-id="b0.1"] .check')).toEqual([true]);
  // Expand all, then Collapse all: the failed check's claim stays open.
  await panel.click('.expand-all');
  expect(await shown(panel, '.claim .more')).toEqual([true, true, true]);
  await panel.click('.expand-all');
  expect(await shown(panel, '.claim .more')).toEqual([true, false, false]);
});

test('an answer that breaks the schema is asked for once more with the error; two in a row fail the build', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await configure(serviceWorker, provider);
  const bad = structuredClone(ARTICLE_TREE);
  bad.branches.pop();
  const error = 'branches has 2 items; it must have 3-5';
  provider.answer(JSON.stringify(bad));
  provider.answer(TEXT);
  const panel = await openArticle({ page, server, cdp, extensionId }, 'retry');
  await panel.click('#build');

  await expect.poll(() => panel.text('#status')).toMatch(BUILT);
  expect(await panel.texts('.claim > .node > .title')).toEqual(ARTICLE_TREE.branches.map((b) => b.title));
  expect(await panel.texts('.verdict')).toHaveLength(1);
  expect(provider.requests).toHaveLength(2);
  const [first, second] = provider.requests.map((r) => r.body.messages[1].content);
  expect(second).toBe(`${first}\n\nYour previous answer was rejected: ${error}. Answer again with the complete JSON object, following every rule.`);

  // Rebuild asks again rather than showing the tree just saved.
  provider.answer(JSON.stringify(bad));
  provider.answer(JSON.stringify(bad));
  await panel.click('#rebuild');
  await expect.poll(() => panel.text('#status')).toBe(MSG.brokeTwice(error));
  expect(provider.requests).toHaveLength(4);
});

test('Stop ends the request; the nodes already drawn stay', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await configure(serviceWorker, provider);
  provider.answer(TEXT, { holdAt: TEXT.indexOf('"branches"') });
  const panel = await openArticle({ page, server, cdp, extensionId }, 'stop');
  const buttons = () => panel.evaluate(() => ({ stop: !document.getElementById('stop').hidden, build: !document.getElementById('build').disabled }));
  expect(await buttons()).toEqual({ stop: false, build: true });
  await panel.click('#build');
  await expect.poll(() => panel.text('.verdict .title')).toBe(ARTICLE_TREE.verdict);
  expect(await buttons()).toEqual({ stop: true, build: false });

  await panel.click('#stop');
  await expect.poll(() => panel.text('#status')).toBe(MSG.stopped);
  await expect.poll(() => provider.requests[0].closed).toBe(true);
  expect(await panel.texts('.verdict .title')).toEqual([ARTICLE_TREE.verdict]);
  expect(await buttons()).toEqual({ stop: false, build: true });
  provider.release();
});

test('a provider error is shown as the provider worded it, without the key', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await configure(serviceWorker, provider);
  provider.fail(401, { error: { message: `Incorrect API key provided: ${KEY}.` } });
  const panel = await openArticle({ page, server, cdp, extensionId }, 'error');
  await panel.click('#build');
  await expect.poll(() => panel.text('#status'))
    .toBe(MSG.providerFailed('OpenAI-compatible', '401 Incorrect API key provided: [key].'));
  expect(await panel.texts('.verdict')).toEqual([]);
});

test('Settings: a model per provider, kept by Save; the eval\'s tested models are listed', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await configure(serviceWorker, provider);
  const panel = await openArticle({ page, server, cdp, extensionId }, 'settings-model');
  await expect.poll(() => panel.evaluate(() => document.getElementById('model').value)).toBe(MODEL);
  await panel.click('#settings summary');
  expect(await shown(panel, '#tested-models')).toEqual([true]);
  expect(await shown(panel, '#tested-none')).toEqual([false]);
  expect(await panel.text('#recommended')).toBe(MSG.recommended(['OpenAI gpt-5.4-mini', 'Anthropic claude-sonnet-5',
    'Google Gemini gemini-3.8-flash']));
  expect(await panel.evaluate(() => [...document.querySelectorAll('#tested-models tbody tr')]
    .map((tr) => [...tr.cells].map((td) => td.textContent)))).toEqual(TESTED_MODELS.map((r) => [
    `${PROVIDERS[r.provider].label} ${r.model}${r.via ? ` (via ${r.via})` : ''}`, percent(r.anchored),
    `${r.verdictSeconds} s / ${r.totalSeconds} s`, `${r.measured}, ${r.pages} pages`,
  ]));

  await panel.evaluate(() => {
    chrome.permissions.request = async () => true; // Chrome's prompt, which no test can answer
    const model = document.getElementById('model');
    model.value = ' mock-model-2 ';
    model.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await panel.click('#save');
  await expect.poll(() => panel.text('#settings-status')).toBe(MSG.saved);
  expect(await serviceWorker.evaluate(() => chrome.storage.local.get('settings'))).toEqual({
    settings: { provider: 'compatible', providers: { compatible: { baseUrl: provider.baseUrl, model: 'mock-model-2' } } },
  });

  // Each provider has its own: switching shows the other's (none), and switching back refills it.
  const pick = (id) => panel.evaluate((id) => {
    document.getElementById('provider').value = id;
    document.getElementById('provider').dispatchEvent(new Event('change'));
  }, id);
  await pick('gemini');
  await expect.poll(() => panel.evaluate(() => document.getElementById('model').value)).toBe(PROVIDERS.gemini.model);
  await pick('compatible');
  await expect.poll(() => panel.evaluate(() => document.getElementById('model').value)).toBe('mock-model-2');
});

test('Settings flags the model: ✓ when the provider serves it, with the eval\'s numbers for a measured one; a warning for a name it lacks or a key it refuses; an edit clears it', async ({ page, server, cdp, extensionId, serviceWorker, provider }) => {
  await configure(serviceWorker, provider);
  const panel = await openArticle({ page, server, cdp, extensionId }, 'settings-check');
  const host = new URL(provider.baseUrl).host;
  const flag = () => panel.evaluate(() => {
    const e = document.getElementById('model-check');
    return [e.textContent, e.className, e.title];
  });
  const type = (id, value) => panel.evaluate(([id, value]) => {
    const input = document.getElementById(id);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, value]);
  const pick = (id) => panel.evaluate((id) => {
    document.getElementById('provider').value = id;
    document.getElementById('provider').dispatchEvent(new Event('change'));
  }, id);
  const reopen = async () => {
    await panel.click('#settings summary');
    await panel.click('#settings summary');
  };
  await panel.evaluate(() => { chrome.permissions.request = async () => true; }); // Chrome's prompt, which no test can answer

  // The panel's start asks nothing; opening Settings asks the provider in use about its saved model.
  expect(provider.lookups).toEqual([]);
  await panel.click('#settings summary');
  await expect.poll(flag).toEqual([MSG.modelValid, 'ok', MSG.modelValidTip(host, MODEL)]);
  expect(provider.lookups.map((r) => [r.url, r.headers.authorization])).toEqual([['/v1/models', `Bearer ${KEY}`]]);
  // An edit clears it until the next check. A compatible server may serve a name it does not
  // list, so an unlisted one is no warning.
  await type('model', 'mock-model-2');
  expect(await flag()).toEqual(['', '', '']);
  await panel.click('#save');
  await expect.poll(() => panel.evaluate(() => document.getElementById('model-check').dataset.model)).toBe('mock-model-2');
  expect(provider.lookups).toHaveLength(2);
  expect(await flag()).toEqual(['', '', '']);
  provider.modelsStatus = 401;
  await reopen();
  await expect.poll(flag).toEqual([MSG.keyRejected, 'warn', MSG.keyRejectedTip(host)]);

  // A provider's own endpoint, answered here in place of the real one. One only looked at is not asked.
  const row = TESTED_MODELS.find((r) => r.via);
  expect(row, 'the shipped table has a row measured outside the extension').toBeTruthy();
  const preset = PROVIDERS[row.provider];
  await panel.evaluate(({ origin, model }) => {
    const real = window.fetch;
    window.asked = [];
    window.fetch = async (url, init) => {
      if (!url.startsWith(origin)) return real(url, init);
      window.asked.push(url);
      const known = url.endsWith('/models') || url.endsWith(`/models/${encodeURIComponent(model)}`);
      return new Response(JSON.stringify(known ? { data: [{ id: model }] } : { error: { message: 'not found' } }),
        { status: known ? 200 : 404, headers: { 'content-type': 'application/json' } });
    };
  }, { origin: new URL(preset.baseUrl).origin, model: row.model });
  await pick(row.provider);
  expect(await flag()).toEqual(['', '', '']);
  await reopen();
  expect(await panel.evaluate(() => window.asked)).toEqual([]);
  await type('model', row.model);
  await type('api-key', 'e2e-not-a-real-key');
  await panel.click('#save');
  await expect.poll(flag).toEqual([MSG.modelValid, 'ok', `${MSG.modelValidTip(preset.label, row.model)} ${MSG.tested(row)}`]);
  expect(await panel.evaluate(() => document.getElementById('model-check').title)).toContain(`(measured via ${row.via})`);
  await type('model', `${row.model}-x`);
  await panel.click('#save');
  await expect.poll(flag).toEqual([MSG.modelMissing(preset.label), 'warn', MSG.modelMissingTip(preset.label, `${row.model}-x`)]);
});
