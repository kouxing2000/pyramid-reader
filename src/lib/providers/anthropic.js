// The Anthropic Messages API wire format. Transport only: the prompt is built once in
// lib/prompt.js.
import { answer, eventJson, events, lookup, outputLimit, ProviderError, scrubber, trimBase } from './http.js';

const API_VERSION = '2023-06-01';
// A tree is a few thousand tokens; the cap only stops a runaway answer.
const MAX_TOKENS = 16000;

/**
 * The schema as the Messages API's structured output takes it. Its reference lists complex array
 * constraints as unsupported, so array bounds are dropped: 3-5 branches and "two or no children"
 * (an anyOf of two bounded arrays, which then read the same and merge into one) are left to the
 * prompt, where the full schema is written out, and to the validator, which enforces them for
 * every provider.
 */
export function lenientSchema(schema) {
  if (Array.isArray(schema)) return schema.map(lenientSchema);
  if (typeof schema !== 'object' || schema === null) return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key !== 'minItems' && key !== 'maxItems') out[key] = lenientSchema(value);
  }
  if (!out.anyOf) return out;
  const alternatives = [...new Map(out.anyOf.map((s) => [JSON.stringify(s), s])).values()];
  if (alternatives.length > 1) return { ...out, anyOf: alternatives };
  const { anyOf, ...rest } = out;
  return { ...rest, ...alternatives[0] };
}

/**
 * @param {{baseUrl: string, apiKey: string, model: string, params?: object,
 *   onUsage?: (usage: object) => void}} cfg  `params` go into the request body as is (thinking);
 *   `onUsage` gets the `usage` of message_start (the input) and of each message_delta (the output
 *   so far)
 * @param {{system: string, user: string, schema: object}} prompt
 * @param {AbortSignal} [signal]
 * @returns {AsyncGenerator<string>} the answer's text as it arrives; stopping early aborts the request
 */
export const stream = (cfg, prompt, signal) => answer(chunks(cfg, prompt, signal));

const headers = (cfg) => ({
  'x-api-key': cfg.apiKey,
  'anthropic-version': API_VERSION,
  // Anthropic's browser CORS support: the API answers a browser's cross-origin request only with
  // this header, the one its official JS SDK sends when dangerouslyAllowBrowser is set. The key
  // sent is the reader's own, from this machine, to Anthropic only (SPEC §4.4).
  'anthropic-dangerous-direct-browser-access': 'true',
});

/**
 * Whether Anthropic serves cfg.model (GET /models/{model}, which takes aliases too): 'valid',
 * 'missing', 'key' when it refuses the key, or null when it cannot say.
 * @throws ProviderError when the endpoint cannot be reached
 */
export async function checkModel(cfg, signal) {
  const { status } = await lookup(`${trimBase(cfg.baseUrl)}/models/${encodeURIComponent(cfg.model)}`,
    { headers: headers(cfg) }, { scrub: scrubber(cfg.apiKey), signal });
  return { 200: 'valid', 404: 'missing', 401: 'key' }[status] ?? null;
}

async function* chunks(cfg, { system, user, schema }, signal) {
  const scrub = scrubber(cfg.apiKey);
  const request = {
    headers: headers(cfg),
    body: {
      model: cfg.model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
      stream: true,
      output_config: { format: { type: 'json_schema', schema: lenientSchema(schema) } },
      ...cfg.params,
    },
  };
  for await (const data of events(`${trimBase(cfg.baseUrl)}/messages`, request, { scrub, signal })) {
    const event = eventJson(data, scrub); // an `error` event throws here
    if (event.type === 'message_start' && event.message?.usage) cfg.onUsage?.(event.message.usage);
    if (event.type === 'message_delta' && event.usage) cfg.onUsage?.(event.usage);
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
      yield event.delta.text;
    } else if (event.type === 'message_delta') {
      const reason = event.delta?.stop_reason;
      if (reason === 'max_tokens') throw outputLimit();
      if (reason === 'model_context_window_exceeded') throw new ProviderError("the article is too long for the model's context window");
      if (reason === 'refusal') {
        const why = event.delta.stop_details?.explanation;
        throw new ProviderError(`the model declined${why ? `: ${scrub(why)}` : ''}`);
      }
    } else if (event.type === 'message_stop') {
      break;
    }
  }
}
