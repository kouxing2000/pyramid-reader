// What every provider transport shares: one POST whose answer is a server-sent event stream, one
// GET that asks the provider about a model, and the error raised when the endpoint refuses the
// request or breaks off the answer. Transports differ only in the requests they build and the
// shape of each event. send() is the extension's only network call (SPEC §4.4;
// tests/unit/rules.test.js keeps it so).
import { sseData } from '../sse.js';

/** The provider refused the request or broke off the answer. The message never holds the key. */
export class ProviderError extends Error {
  name = 'ProviderError';
}

/** A function that replaces every occurrence of the key in a text, for messages shown or thrown. */
export const scrubber = (apiKey) => (text) => (apiKey ? String(text).split(apiKey).join('[key]') : String(text));

// The provider's own words from an `{error: {message}}` or `{error: "..."}` body (text or parsed),
// the shape OpenAI, Anthropic and Gemini all use, else undefined.
function errorMessage(body) {
  let error;
  try {
    error = typeof body === 'string' ? JSON.parse(body).error : body?.error;
  } catch {
    return undefined;
  }
  if (!error) return undefined;
  return typeof error === 'string' ? error : error.message ?? JSON.stringify(error);
}

// The body of a response that is not the answer. Only a Stop (AbortError) interrupts it: an
// unreadable body is just an empty one.
const readBody = (res) => res.text().catch((e) => {
  if (e.name === 'AbortError') throw e;
  return '';
});

/**
 * POSTs `body` as JSON and yields the `data` of each server-sent event of the answer. Stopping the
 * iteration, or the signal, ends the request.
 * @param {string} url
 * @param {{headers?: Record<string, string>, body: object}} request
 * @param {{scrub: (text: string) => string, signal?: AbortSignal}} o  scrub: scrubber(cfg.apiKey)
 * @returns {AsyncGenerator<string>}
 * @throws ProviderError when the endpoint cannot be reached, answers an error status, or answers
 *   with anything but an event stream; AbortError on Stop
 */
export async function* events(url, { headers = {}, body }, { scrub, signal }) {
  const res = await send(url, {
    method: 'POST', signal, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }, scrub);
  if (!res.ok) {
    const text = await readBody(res);
    throw new ProviderError(scrub(`${res.status} ${errorMessage(text) ?? (text.slice(0, 300) || res.statusText)}`));
  }
  // Anything but a stream (a gateway's JSON error, a login page) is the endpoint's failure, not
  // an answer that broke the schema: it must not be retried as one.
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('text/event-stream')) {
    const text = await readBody(res);
    throw new ProviderError(scrub(errorMessage(text) ?? `the endpoint sent ${type || 'a response with no content type'}, not a stream`));
  }
  yield* sseData(res.body);
}

/**
 * GETs `url` and returns the status and the JSON body, null when the body is not JSON.
 * @param {string} url
 * @param {{headers?: Record<string, string>}} request
 * @param {{scrub: (text: string) => string, signal?: AbortSignal}} o  scrub: scrubber(cfg.apiKey)
 * @returns {Promise<{status: number, body: any}>}
 * @throws ProviderError when the endpoint cannot be reached; AbortError when the signal aborts
 */
export async function lookup(url, { headers = {} }, { scrub, signal }) {
  const res = await send(url, { method: 'GET', signal, headers }, scrub);
  const text = await readBody(res);
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: null };
  }
}

// The one network call. A redirect would re-send the key, and a build's article, to wherever it
// points (SPEC §4.4).
async function send(url, init, scrub) {
  try {
    return await fetch(url, { ...init, redirect: 'error' });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ProviderError(`could not reach ${new URL(url).origin} (${scrub(e.message)})`);
  }
}

/**
 * One event's JSON payload.
 * @throws ProviderError when it is not JSON, or is an error event (`{error: ...}`)
 */
export function eventJson(data, scrub) {
  let payload;
  try {
    payload = JSON.parse(data);
  } catch {
    throw new ProviderError(`unreadable stream event: ${scrub(data.slice(0, 100))}`);
  }
  if (payload?.error) throw new ProviderError(scrub(errorMessage(payload)));
  return payload;
}

/** The error for an answer cut off at the model's output limit, whichever provider says so. */
export const outputLimit = () => new ProviderError("the answer hit the model's output limit");

/**
 * The answer's text chunks as a transport reads them from its events, passed on as they come.
 * A stream that ends without one is the endpoint's failure, not an empty answer.
 * @param {AsyncIterable<string>} chunks  non-empty text
 * @returns {AsyncGenerator<string>}
 * @throws ProviderError when the chunks end having yielded nothing
 */
export async function* answer(chunks) {
  let answered = false;
  for await (const chunk of chunks) {
    answered = true;
    yield chunk;
  }
  if (!answered) throw new ProviderError('the stream ended without an answer');
}

/** baseUrl without trailing slashes, to append a path to. */
export const trimBase = (baseUrl) => baseUrl.replace(/\/+$/, '');
