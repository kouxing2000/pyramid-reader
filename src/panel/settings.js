// The settings (SPEC §5.4): provider, model, an API key per endpoint origin, the language a tree
// is translated into, and the tested-models table with the models it recommends. Everything is
// stored in chrome.storage.local only: keys never sync to other machines, never logged. Nothing
// runs at import; initSettings() wires the form.
//
//   settings:    {provider, providers: {[id]: {baseUrl?, model}}}
//   keys:        {[endpoint origin]: key}
//   paint:       the paint mode (panel/paint.js PAINT_MODES), saved by the panel's switch
//   read:        how a translated tree is read ('original', 'both', 'mine'), saved by the panel's
//                switch; absent until the reader chooses
//   translateTo: the language the reader chose to translate into (translate.js LANGUAGES) over
//                the browser's; absent when they have not
// Each is its own entry, so that saving one never writes over another.
import { endpointOrigin, originPattern, providerConfig, PROVIDERS } from '../lib/providers/index.js';
import { TESTED_MODELS, testedModel } from '../lib/tested-models.js';
import { el } from './dom.js';
import { MSG, percent } from './messages.js';
import { LANGUAGES, languageName, translations, translatorCode } from './translate.js';

const $ = (id) => document.getElementById(id);

/**
 * What is stored now. Read afresh each time: a panel in another window may have saved since.
 * @returns {Promise<{settings: object, keys: Record<string, string>, paint: string, read: string | null,
 *   translateTo: string | null}>}  paint: 'all' unless the reader chose another mode
 */
export async function readSettings() {
  const { settings = {}, keys = {}, paint = 'all', read = null, translateTo = null } =
    await chrome.storage.local.get(['settings', 'keys', 'paint', 'read', 'translateTo']);
  return { settings, keys, paint, read, translateTo };
}

export function openSettings() {
  $('settings').open = true;
}

let storedKeys = {}; // keys by origin, kept current for the form's synchronous refills
// The key field shows the key stored for the endpoint in the form (keyOrigin), until the reader
// types in it. A stored key therefore never follows an edited base URL to another endpoint.
let keyOrigin = null;
let keyTyped = false;

function formOrigin() {
  const preset = PROVIDERS[$('provider').value];
  try {
    return endpointOrigin(preset.fixedBaseUrl ? preset.baseUrl : $('base-url').value.trim());
  } catch {
    return null;
  }
}

function fillKey() {
  keyOrigin = formOrigin();
  keyTyped = false;
  $('api-key').value = (keyOrigin && storedKeys[keyOrigin]) || '';
}

let checking = 0; // counts model checks: the answer to an earlier one, or about a form since edited, is dropped

// The flag beside the Model field (SPEC §5.4): whether the provider serves the model. Asked when
// Settings opens and after Save, and only about the provider in use with its saved model: never
// at the panel's start, and never with a key for a provider the reader is only looking at.
async function askProvider() {
  const ticket = clearCheck();
  const { settings, keys } = await readSettings();
  const config = settings.provider === $('provider').value ? providerConfig(settings, keys) : null;
  if (!config || config.model !== $('model').value.trim() || ticket !== checking) return;
  const result = await config.transport.checkModel(config).catch(() => null); // unreachable: no flag
  if (ticket === checking) showCheck(result, config);
}

function clearCheck() {
  showCheck(null);
  return ++checking;
}

// ✓, with the eval's numbers for a model it measured; a warning; or nothing, when the provider
// could not say.
function showCheck(result, config) {
  const where = config && (config.fixedBaseUrl ? config.label : new URL(config.baseUrl).host);
  const row = result === 'valid' ? testedModel($('provider').value, config.model) : null;
  const [text, title, className] = {
    valid: () => [MSG.modelValid, [MSG.modelValidTip(where, config.model), row && MSG.tested(row)].filter(Boolean).join(' '), 'ok'],
    missing: () => [MSG.modelMissing(where), MSG.modelMissingTip(where, config.model), 'warn'],
    key: () => [MSG.keyRejected, MSG.keyRejectedTip(where), 'warn'],
  }[result]?.() ?? ['', '', ''];
  Object.assign($('model-check'), { textContent: text, title, className });
  $('model-check').dataset.model = config?.model ?? ''; // the model the provider answered about
}

async function fillForm() {
  const { settings, keys } = await readSettings();
  storedKeys = keys;
  const id = $('provider').value;
  const preset = PROVIDERS[id];
  const saved = settings.providers?.[id] ?? {};
  $('base-url-row').hidden = preset.fixedBaseUrl;
  $('base-url').value = preset.fixedBaseUrl ? preset.baseUrl : saved.baseUrl ?? '';
  $('model').value = saved.model ?? preset.model;
  fillKey();
  clearCheck();
  $('settings-status').textContent = '';
}

async function save(event) {
  event.preventDefault();
  const say = (text) => { $('settings-status').textContent = text; };
  const id = $('provider').value;
  const preset = PROVIDERS[id];
  const baseUrl = preset.fixedBaseUrl ? preset.baseUrl : $('base-url').value.trim();
  const model = $('model').value.trim();
  if (!baseUrl) return say(MSG.needsBaseUrl);
  let origin;
  try {
    origin = endpointOrigin(baseUrl);
  } catch {
    return say(MSG.badBaseUrl(baseUrl));
  }
  // A key the reader did not type for this endpoint is this endpoint's stored key, whatever the
  // field showed.
  const key = keyTyped || keyOrigin === origin ? $('api-key').value.trim() : storedKeys[origin] ?? '';
  if (!model) return say(MSG.needsModel);
  if (preset.keyRequired && !key) return say(MSG.needsKey(preset.label));

  // First await in the handler: the request needs the click's user gesture. Chrome rejects an
  // origin the manifest's optional_host_permissions do not cover.
  let granted;
  try {
    granted = await chrome.permissions.request({ origins: [originPattern(baseUrl)] });
  } catch {
    return say(MSG.originNotAllowed(origin));
  }
  if (!granted) return say(MSG.permissionDenied(origin));

  // Merge into what is stored now: another window's panel may have saved since this one loaded.
  const stored = await readSettings();
  const entry = { ...(preset.fixedBaseUrl ? {} : { baseUrl }), model };
  const settings = { ...stored.settings, provider: id, providers: { ...stored.settings.providers, [id]: entry } };
  const keys = { ...stored.keys, [origin]: key };
  if (!key) delete keys[origin];
  await chrome.storage.local.set({ settings, keys });
  storedKeys = keys;
  keyOrigin = origin;
  keyTyped = false;
  say(MSG.saved);
  askProvider();
}

// The eval's measurements (lib/tested-models.js), one row per model, under the recommendation:
// each provider's default model, or a larger one.
function drawTestedModels() {
  $('recommended').textContent = MSG.recommended(Object.values(PROVIDERS).filter((p) => p.model).map((p) => `${p.label} ${p.model}`));
  $('tested-models').hidden = TESTED_MODELS.length === 0;
  $('tested-none').hidden = TESTED_MODELS.length > 0;
  $('tested-none').textContent = MSG.noTestedModels;
  $('tested-models').querySelector('tbody').replaceChildren(...TESTED_MODELS.map((r) => el('tr', {},
    el('td', {}, `${PROVIDERS[r.provider]?.label ?? r.provider} ${r.model}${r.via ? ` (via ${r.via})` : ''}`),
    el('td', {}, percent(r.anchored)),
    el('td', {}, `${r.verdictSeconds} s / ${r.totalSeconds} s`), el('td', {}, `${r.measured}, ${r.pages} pages`))));
}

// The browser's languages as the Translator names them, most preferred first.
const browserLanguages = () => [...new Set(navigator.languages.map((l) => translatorCode(l)).filter(Boolean))];

// What translation does: into the chosen language, else into the browser's languages, of which
// the note names the ones it would use; nothing without Chrome's Translator.
function showTranslation(translateTo) {
  const supported = translations().supported;
  $('translation-note').textContent = !supported ? MSG.translationNone
    : translateTo ? MSG.translationChosen(languageName(translateTo))
      : MSG.translationFrom(browserLanguages().map(languageName).join(', '));
  $('translate-to-row').hidden = !supported;
  $('chrome-languages').hidden = !supported || Boolean(translateTo);
}

let onLanguage = () => {};

/**
 * The languages a tree can be translated into, as a select's options: Automatic first, then the
 * browser's languages, then every language the Translator lists. Settings and the panel's
 * Read-in switch both offer them.
 */
export function languageOptions() {
  const option = (code) => el('option', { value: code }, languageName(code));
  const mine = browserLanguages().filter((code) => LANGUAGES.includes(code));
  return [el('option', { value: '' }, MSG.translateAuto),
    mine.length > 0 && el('optgroup', { label: MSG.chromesLanguages }, mine.map(option)),
    el('optgroup', { label: MSG.allLanguages }, LANGUAGES.map(option))].filter(Boolean);
}

/**
 * Saves the language to translate into, wherever the reader chose it, and applies it: null goes
 * back to the browser's languages. Saved as soon as it is chosen: it needs no key, so it is not
 * part of the provider's Save.
 */
export async function chooseLanguage(to) {
  await (to ? chrome.storage.local.set({ translateTo: to }) : chrome.storage.local.remove('translateTo'));
  $('translate-to').value = to ?? '';
  showTranslation(to);
  onLanguage(to);
}

/**
 * Wires the settings form and fills it from storage.
 * @param {{onTranslateTo: (code: string | null) => void}} o  called when the reader picks a
 *   language to translate into, here or on the Read-in switch, or goes back to Automatic (null)
 */
export async function initSettings({ onTranslateTo }) {
  for (const [id, { label }] of Object.entries(PROVIDERS)) $('provider').append(el('option', { value: id }, label));
  $('provider').addEventListener('change', fillForm);
  $('base-url').addEventListener('input', () => { if (!keyTyped && formOrigin() !== keyOrigin) fillKey(); });
  $('api-key').addEventListener('input', () => { keyTyped = true; });
  $('settings-form').addEventListener('input', clearCheck);
  $('settings').addEventListener('toggle', () => { if ($('settings').open) askProvider(); });
  $('settings-form').addEventListener('submit', save);
  // The free key is Gemini's, so the form waits on Google Gemini for the key the reader brings back.
  // auxclick too: a middle click opens the link without a click event.
  for (const type of ['click', 'auxclick']) {
    $('free-key-link').addEventListener(type, () => {
      $('provider').value = 'gemini';
      fillForm();
    });
  }
  onLanguage = onTranslateTo;
  $('translate-to').append(...languageOptions());
  $('translate-to').addEventListener('change', () => chooseLanguage($('translate-to').value || null));
  $('chrome-languages').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://settings/languages' }));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.keys) storedKeys = changes.keys.newValue ?? {};
  });
  drawTestedModels();

  const stored = await readSettings();
  $('provider').value = PROVIDERS[stored.settings.provider] ? stored.settings.provider : 'openai';
  $('translate-to').value = stored.translateTo ?? '';
  showTranslation(stored.translateTo);
  await fillForm();
  return stored;
}
