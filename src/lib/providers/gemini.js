// The Gemini API wire format (generativelanguage.googleapis.com, streamGenerateContent). Transport
// only: the prompt is built once in lib/prompt.js.
import { answer, eventJson, events, lookup, outputLimit, ProviderError, scrubber, trimBase } from './http.js';

// Why an answer ended other than STOP, as the reader is told it.
const FINISH = {
  MAX_TOKENS: outputLimit,
  SAFETY: () => new ProviderError("the provider's safety filter stopped the answer"),
  RECITATION: () => new ProviderError('the provider stopped the answer for quoting its source at length (RECITATION)'),
};

/**
 * @param {{baseUrl: string, apiKey: string, model: string, params?: object,
 *   onUsage?: (usage: object) => void}} cfg  `params` go into generationConfig as is
 *   (thinkingConfig); `onUsage` gets each chunk's `usageMetadata`, running totals the last of
 *   which covers the whole answer
 * @param {{system: string, user: string, schema: object}} prompt
 * @param {AbortSignal} [signal]
 * @returns {AsyncGenerator<string>} the answer's text as it arrives; stopping early aborts the request
 */
export const stream = (cfg, prompt, signal) => answer(chunks(cfg, prompt, signal));

// The model's URL, with or without the API's "models/" prefix in the name. The key goes in a
// header, never the URL, where an error message could echo it.
const modelUrl = (cfg) => `${trimBase(cfg.baseUrl)}/models/${encodeURIComponent(cfg.model.replace(/^models\//, ''))}`;
const headers = (cfg) => ({ 'x-goog-api-key': cfg.apiKey });

/**
 * Whether Gemini serves cfg.model (GET /models/{model}): 'valid', 'missing', 'key' when it refuses
 * the key (a 400 whose reason is API_KEY_INVALID), or null when it cannot say.
 * @throws ProviderError when the endpoint cannot be reached
 */
export async function checkModel(cfg, signal) {
  const { status, body } = await lookup(modelUrl(cfg), { headers: headers(cfg) }, { scrub: scrubber(cfg.apiKey), signal });
  if (status === 400 && body?.error?.details?.some((d) => d?.reason === 'API_KEY_INVALID')) return 'key';
  return { 200: 'valid', 404: 'missing', 401: 'key' }[status] ?? null;
}

async function* chunks(cfg, { system, user, schema }, signal) {
  const scrub = scrubber(cfg.apiKey);
  const request = {
    headers: headers(cfg),
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, ...cfg.params },
    },
  };
  const url = `${modelUrl(cfg)}:streamGenerateContent?alt=sse`;
  for await (const data of events(url, request, { scrub, signal })) {
    const chunk = eventJson(data, scrub);
    if (chunk.usageMetadata) cfg.onUsage?.(chunk.usageMetadata);
    const blocked = chunk.promptFeedback?.blockReason;
    if (blocked) throw new ProviderError(`the provider refused the article (${blocked})`);
    const candidate = chunk.candidates?.[0];
    if (!candidate) continue;
    for (const part of candidate.content?.parts ?? []) {
      if (typeof part.text === 'string' && part.text && !part.thought) yield part.text;
    }
    const reason = candidate.finishReason;
    if (reason && reason !== 'STOP') throw FINISH[reason]?.() ?? new ProviderError(`the provider stopped the answer (${reason})`);
  }
}
