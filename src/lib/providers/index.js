// The providers the settings offer, and the transport config a saved choice turns into.
import * as anthropic from './anthropic.js';
import * as chatCompletions from './chat-completions.js';
import * as gemini from './gemini.js';

// OpenAI's models without reasoning, fine-tunes of them included. They reject reasoning_effort
// outright (400 "Unrecognized request argument") and have no thinking to turn off. The family
// is closed: new models reason.
const OPENAI_NO_REASONING = /^(ft:)?(gpt-3\.5|gpt-4|chatgpt-)|chat-latest$/;
// Gemini's flash-lite models do not think unless asked, and some of them (3.5-flash-lite,
// flash-lite-latest) reject a thinking budget of 0 with a bare 400.
const GEMINI_NO_THINKING = /flash-lite/;

/**
 * baseUrl/model: defaults (an empty baseUrl is the reader's to fill in); the default model is also
 * the smallest one Settings recommends (SPEC §5.4). keyRequired: a build
 * without a key is refused (a local server needs none); jsonMode: see chat-completions.js;
 * params(model): extra request fields, where the transport puts its settings. Thinking stays off
 * (SPEC §6). A model that cannot turn it off answers 400 rather
 * than think, and the panel shows that: OpenAI's gpt-5-mini and o4-mini and Gemini's pro models
 * ("only works in thinking mode"), as probed; Anthropic's Opus 5.5 and Fable, by Anthropic's API
 * reference. An OpenAI-compatible endpoint has no common switch, so its model name decides.
 */
export const PROVIDERS = {
  openai: {
    label: 'OpenAI', transport: chatCompletions, baseUrl: 'https://api.openai.com/v1', fixedBaseUrl: true,
    model: 'gpt-5.4-mini', keyRequired: true, jsonMode: 'json_schema',
    params: (model) => (OPENAI_NO_REASONING.test(model) ? {} : { reasoning_effort: 'none' }),
  },
  anthropic: {
    label: 'Anthropic', transport: anthropic, baseUrl: 'https://api.anthropic.com/v1', fixedBaseUrl: true,
    model: 'claude-sonnet-5', keyRequired: true,
    params: () => ({ thinking: { type: 'disabled' } }),
  },
  gemini: {
    label: 'Google Gemini', transport: gemini, baseUrl: 'https://generativelanguage.googleapis.com/v1beta', fixedBaseUrl: true,
    model: 'gemini-3.8-flash', keyRequired: true,
    params: (model) => (GEMINI_NO_THINKING.test(model) ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
  },
  compatible: {
    label: 'OpenAI-compatible', transport: chatCompletions, baseUrl: '', fixedBaseUrl: false,
    model: '', keyRequired: false, jsonMode: 'json_object', params: () => ({}),
  },
};

/**
 * @param {{provider?: string, providers?: Record<string, {baseUrl?: string, model?: string}>}} settings
 *   as stored under `settings` in chrome.storage.local
 * @param {Record<string, string>} keys  API keys by endpoint origin, stored under `keys`: a key
 *   saved for one endpoint is never sent to another
 * @returns the transport config, or null when the choice is incomplete (no key, model or URL)
 */
export function providerConfig(settings = {}, keys = {}) {
  const preset = PROVIDERS[settings.provider];
  if (!preset) return null;
  const saved = settings.providers?.[settings.provider] ?? {};
  const baseUrl = (!preset.fixedBaseUrl && saved.baseUrl) || preset.baseUrl;
  let origin;
  try {
    origin = endpointOrigin(baseUrl);
  } catch {
    return null;
  }
  const model = saved.model || preset.model;
  const apiKey = keys[origin] ?? '';
  if (!model || (preset.keyRequired && !apiKey)) return null;
  return { ...preset, baseUrl, model, apiKey, params: preset.params(model) };
}

/**
 * An endpoint's origin: where its key is stored, and what host permission it needs.
 * @throws TypeError when baseUrl is not an http(s) URL
 */
export function endpointOrigin(baseUrl) {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TypeError(`not an http(s) URL: ${baseUrl}`);
  return url.origin;
}

/** The host-permission pattern for an endpoint, as chrome.permissions.request takes it. */
export const originPattern = (baseUrl) => `${endpointOrigin(baseUrl)}/*`;
