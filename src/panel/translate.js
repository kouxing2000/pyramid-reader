// The tree in a second language (SPEC §5.2): the model writes the tree in the article's own
// language, and Chrome's on-device Translator (Chrome 138+, on a computer) puts its verdict,
// titles and bodies into the reader's. Nothing leaves the device. The second language is the
// reader's choice in Settings, else the first of the browser's languages that isn't the
// article's, so a reader who reads the article in their only language is offered nothing.
// Imports cleanly in Node: the Translator is looked up only when a function runs, on the object
// passed in.

// The languages Chrome's Translator documents (developer.chrome.com/docs/ai/translator-api), the
// choices Settings offers. Whether one pair translates is availability()'s answer, not this list's.
export const LANGUAGES = ['ar', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'he', 'hi', 'hr', 'hu',
  'id', 'it', 'ja', 'kn', 'ko', 'lt', 'mr', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'ta', 'te', 'th',
  'tr', 'uk', 'vi', 'zh', 'zh-Hant'];

/**
 * A language tag as the Translator names languages: the language, and its script only when that
 * is not the language's usual one. 'zh-TW' is 'zh-Hant', 'zh-CN' and 'zh-Hans' are 'zh', 'pt-BR'
 * is 'pt'. Null for a tag that is not one.
 */
export function translatorCode(tag) {
  try {
    const full = new Intl.Locale(tag).maximize();
    const usual = new Intl.Locale(full.language).maximize();
    return full.script && full.script !== usual.script ? `${full.language}-${full.script}` : full.language;
  } catch {
    return null;
  }
}

/** Whether a and b are one language to a reader: 'en-US' and 'en' are, 'zh-TW' and 'zh' are not. */
export function sameLanguage(a, b) {
  const code = translatorCode(a);
  return code !== null && code === translatorCode(b);
}

/**
 * The language a tree written in `lang` is translated into, as a translatorCode(), or null when
 * the reader has no other language to read it in.
 * @param {string} lang  the tree's language, the article's
 * @param {{languages?: readonly string[], chosen?: string | null}} reader
 *   languages: the browser's, most preferred first (navigator.languages); chosen: the language
 *   the reader picked in Settings, which then is the only one
 */
export function secondLanguage(lang, { languages = [], chosen = null } = {}) {
  const found = (chosen ? [chosen] : languages).find((l) => translatorCode(l) !== null && !sameLanguage(l, lang));
  return found ? translatorCode(found) : null;
}

/** Whether `lang` is one of the reader's languages, so the article needs no translating. */
export const readsLanguage = (lang, languages = []) => languages.some((l) => sameLanguage(l, lang));

/** A language's name in itself, as a list of languages shows it: '中文', 'Français'. */
export function languageName(code) {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return code;
  }
}

/**
 * Translations on this device, kept while the panel is open: each language pair's translator is
 * created once, and each text is translated once per pair, however often it is asked for.
 * A failure is not kept, so asking again retries.
 * @param {object} [api]  what holds the Translator: globalThis in the panel, a fake in tests
 */
export function translations(api = globalThis) {
  const pairs = new Map(); // 'en>zh' -> Promise<translator>
  const texts = new Map(); // 'en>zh' + '\n' + text -> Promise<string>
  const remember = (map, key, make) => {
    if (!map.has(key)) {
      const made = make();
      map.set(key, made);
      made.catch(() => map.delete(key));
    }
    return map.get(key);
  };
  return {
    /** Whether this browser has the Translator at all. */
    get supported() {
      return typeof api.Translator?.create === 'function';
    },
    /** @returns {Promise<'available'|'downloadable'|'downloading'|'unavailable'>} */
    availability: (source, target) => api.Translator.availability({ sourceLanguage: source, targetLanguage: target }),
    /**
     * text in `target`. Creating a pair's translator may first download its model, which needs
     * the reader to have clicked in the panel; onProgress hears that download (0-1), if this
     * call is the one that starts it.
     */
    translate: (text, source, target, { onProgress } = {}) => remember(texts, `${source}>${target}\n${text}`, () =>
      remember(pairs, `${source}>${target}`, () => api.Translator.create({
        sourceLanguage: source,
        targetLanguage: target,
        monitor: (m) => m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded)),
      })).then((translator) => translator.translate(text))),
  };
}
