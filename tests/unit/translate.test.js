import { test } from 'node:test';
import assert from 'node:assert/strict';
import { languageName, readsLanguage, sameLanguage, secondLanguage, translations, translatorCode } from '../../src/panel/translate.js';

test('a language tag names its language as the Translator does: the script only when unusual', () => {
  assert.deepEqual(['zh', 'zh-CN', 'zh-Hans', 'zh-TW', 'zh-Hant', 'en-US', 'pt-BR', 'iw'].map(translatorCode),
    ['zh', 'zh', 'zh', 'zh-Hant', 'zh-Hant', 'en', 'pt', 'he']);
  assert.equal(translatorCode('en_US'), null);
  assert.ok(sameLanguage('en-GB', 'en'));
  assert.ok(!sameLanguage('zh-TW', 'zh'));
  assert.ok(!sameLanguage('x y', 'x y'));
});

test('the second language: the first of the reader\'s languages that is not the article\'s, or none', () => {
  // One language, the article's: nothing to offer.
  assert.equal(secondLanguage('en', { languages: ['en-US', 'en'] }), null);
  // A Chinese reader whose browser is in English still gets Chinese on an English page.
  assert.equal(secondLanguage('en', { languages: ['en-US', 'zh-CN'] }), 'zh');
  assert.equal(secondLanguage('zh', { languages: ['en-US', 'zh-CN'] }), 'en');
  assert.equal(secondLanguage('fr', { languages: ['en'] }), 'en');
  assert.equal(secondLanguage('zh-CN', { languages: ['zh-TW'] }), 'zh-Hant');
  assert.equal(secondLanguage('en', { languages: ['en_US', 'ja'] }), 'ja');
  assert.equal(secondLanguage('en', {}), null);
  // A language chosen in Settings is the only one, and none when it is the article's.
  assert.equal(secondLanguage('en', { languages: ['en', 'zh'], chosen: 'ja' }), 'ja');
  assert.equal(secondLanguage('en', { languages: ['en', 'zh'], chosen: 'en' }), null);
});

test('whether the reader reads the article\'s language, and languages by their own names', () => {
  assert.ok(readsLanguage('en', ['zh-CN', 'en-US']));
  assert.ok(!readsLanguage('fr', ['zh-CN', 'en-US']));
  assert.deepEqual(['zh', 'zh-Hant', 'fr', 'ja'].map(languageName), ['中文', '繁體中文', 'Français', '日本語']);
});

// A Translator that counts: create() once per pair, translate() once per text.
function fakeApi({ fail = 0 } = {}) {
  const calls = { create: [], translate: [] };
  let failures = fail;
  const api = {
    Translator: {
      availability: async ({ targetLanguage }) => (targetLanguage === 'xx' ? 'unavailable' : 'downloadable'),
      create: async ({ sourceLanguage, targetLanguage, monitor }) => {
        calls.create.push(`${sourceLanguage}>${targetLanguage}`);
        if (failures-- > 0) throw new DOMException('Requires a user gesture', 'NotAllowedError');
        const target = new EventTarget();
        monitor?.(target);
        target.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: 1 }));
        return { translate: async (text) => { calls.translate.push(text); return `[${targetLanguage}] ${text}`; } };
      },
    },
  };
  return { api, calls };
}

test('each pair is created once and each text translated once, however often asked', async () => {
  const { api, calls } = fakeApi();
  const t = translations(api);
  assert.equal(t.supported, true);
  const progress = [];
  const out = await Promise.all([
    t.translate('One.', 'en', 'zh', { onProgress: (p) => progress.push(p) }),
    t.translate('One.', 'en', 'zh'),
    t.translate('Two.', 'en', 'zh'),
    t.translate('One.', 'en', 'ja'),
  ]);
  assert.deepEqual(out, ['[zh] One.', '[zh] One.', '[zh] Two.', '[ja] One.']);
  assert.deepEqual(calls.create, ['en>zh', 'en>ja']);
  assert.deepEqual(calls.translate, ['One.', 'Two.', 'One.']);
  assert.deepEqual(progress, [1]);
  assert.equal(await t.availability('en', 'xx'), 'unavailable');
});

test('a failed translation is not kept: asking again tries again', async () => {
  const { api, calls } = fakeApi({ fail: 1 });
  const t = translations(api);
  await assert.rejects(t.translate('One.', 'en', 'zh'), { name: 'NotAllowedError' });
  assert.equal(await t.translate('One.', 'en', 'zh'), '[zh] One.');
  assert.deepEqual(calls.create, ['en>zh', 'en>zh']);
});

test('without a Translator, translation is not supported', () => {
  assert.equal(translations({}).supported, false);
});
