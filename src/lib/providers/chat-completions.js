// The chat-completions wire format: OpenAI, and every OpenAI-compatible endpoint (DeepSeek, Qwen,
// Kimi, OpenRouter, Ollama), which differ only in base URL and how much JSON enforcement they
// offer. Transport only: the prompt is built once in lib/prompt.js.
import { answer, eventJson, events, lookup, outputLimit, ProviderError, scrubber, trimBase } from './http.js';

// How the endpoint is asked for JSON: 'json_schema' enforces TREE_SCHEMA (OpenAI strict mode),
// 'json_object' only valid JSON (the validator catches the rest either way).
const RESPONSE_FORMAT = {
  json_schema: (schema) => ({ type: 'json_schema', json_schema: { name: 'pyramid_tree', strict: true, schema } }),
  json_object: () => ({ type: 'json_object' }),
};

/**
 * @param {{baseUrl: string, apiKey?: string, model: string, jsonMode: keyof RESPONSE_FORMAT,
 *          params?: object, onUsage?: (usage: object) => void}} cfg  `params` go into the request
 *   body as is (e.g. reasoning_effort); `onUsage` gets each `usage` object the stream reports (with
 *   `stream_options: {include_usage: true}` in params, OpenAI sends one after the answer)
 * @param {{system: string, user: string, schema: object}} prompt
 * @param {AbortSignal} [signal]
 * @returns {AsyncGenerator<string>} the answer's text as it arrives; stopping early aborts the request
 */
export const stream = (cfg, prompt, signal) => answer(chunks(cfg, prompt, signal));

const headers = (cfg) => (cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {});

/**
 * Whether the endpoint serves cfg.model, from its model list (GET /models): 'valid', 'missing',
 * 'key' when it refuses the key, or null when it cannot say. Only a provider's own endpoint
 * (fixedBaseUrl) lists every name it serves: a compatible server may accept one it does not list
 * (Ollama's llama3 for llama3:latest, OpenRouter's :nitro), so a name missing there is null. Only
 * a 401 that says the key is invalid is 'key': OpenAI also answers 401 to a restricted key that
 * may build but not list models.
 * @throws ProviderError when the endpoint cannot be reached
 */
export async function checkModel(cfg, signal) {
  const { status, body } = await lookup(`${trimBase(cfg.baseUrl)}/models`, { headers: headers(cfg) },
    { scrub: scrubber(cfg.apiKey), signal });
  if (status === 401 && body?.error?.code === 'invalid_api_key') return 'key';
  if (status !== 200 || !Array.isArray(body?.data)) return null;
  if (body.data.some((m) => m?.id === cfg.model)) return 'valid';
  return cfg.fixedBaseUrl ? 'missing' : null;
}

async function* chunks(cfg, { system, user, schema }, signal) {
  const scrub = scrubber(cfg.apiKey);
  const request = {
    headers: headers(cfg),
    body: {
      model: cfg.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: true,
      response_format: RESPONSE_FORMAT[cfg.jsonMode](schema),
      ...cfg.params,
    },
  };
  let refusal = '';
  for await (const data of events(`${trimBase(cfg.baseUrl)}/chat/completions`, request, { scrub, signal })) {
    if (data === '[DONE]') break;
    const event = eventJson(data, scrub);
    if (event.usage) cfg.onUsage?.(event.usage);
    const choice = event.choices?.[0];
    if (!choice) continue; // e.g. a usage-only event
    if (choice.delta?.refusal) refusal += choice.delta.refusal;
    if (choice.delta?.content) yield choice.delta.content;
    if (choice.finish_reason === 'length') throw outputLimit();
    if (choice.finish_reason === 'content_filter') throw new ProviderError("the provider's content filter stopped the answer");
  }
  if (refusal) throw new ProviderError(`the model declined: ${scrub(refusal)}`);
}
