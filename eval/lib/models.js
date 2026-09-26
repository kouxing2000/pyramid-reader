// The models the eval measures (SPEC §8) and how each is reached: the extension's own transports
// for every provider with a key in the environment, and `claude -p` for Claude on the dev machine.
// A model that cannot be reached prints `SKIPPED <model>: <why>`, never a silent omission.
//
// Prices are USD per million tokens, from each provider's pricing page (read 2026-09-24): they turn
// the tokens a provider reports into the cost the spend cap counts. claude -p reports its own cost;
// its prices here only size the reservation made before a call.
import fs from 'node:fs';
import * as chatCompletions from '../../src/lib/providers/chat-completions.js';
import { endpointOrigin, providerConfig, PROVIDERS } from '../../src/lib/providers/index.js';
import * as claudeCli from './claude-cli.js';

// transport: 'api' goes through the extension's own transport for the provider; 'claude-cli'
// through claude-cli.js, where `model` is a --model alias and `via` labels the measurement.
export const MODELS = [
  { id: 'gpt-5.4-mini', transport: 'api', provider: 'openai', model: 'gpt-5.4-mini', key: 'OPENAI_API_KEY', price: { in: 0.75, cached: 0.075, out: 4.5 } },
  { id: 'gpt-5.5', transport: 'api', provider: 'openai', model: 'gpt-5.5', key: 'OPENAI_API_KEY', price: { in: 5, cached: 0.5, out: 30 } },
  // Gemini's cached-input price is not used: implicit cache hits are counted at the full price.
  { id: 'gemini-3.8-flash', transport: 'api', provider: 'gemini', model: 'gemini-3.8-flash', key: 'GEMINI_API_KEY', price: { in: 0.75, cached: 0.75, out: 3.75 } },
  { id: 'gemini-3.5-flash-lite', transport: 'api', provider: 'gemini', model: 'gemini-3.5-flash-lite', key: 'GEMINI_API_KEY', price: { in: 0.3, cached: 0.3, out: 2.5 } },
  // Sonnet's prompt is written to the cache at 1.25 times the input price.
  { id: 'claude-cli-haiku', transport: 'claude-cli', via: 'claude -p', provider: 'anthropic', model: 'haiku', price: { in: 1.25, cached: 1.25, out: 5 } },
  { id: 'claude-cli-sonnet', transport: 'claude-cli', via: 'claude -p', provider: 'anthropic', model: 'sonnet', price: { in: 3.75, cached: 3.75, out: 15 } },
  // No key on the dev machine: each prints SKIPPED until one is set.
  { id: 'claude-sonnet-5', transport: 'api', provider: 'anthropic', model: 'claude-sonnet-5', key: 'ANTHROPIC_API_KEY', price: { in: 3, cached: 0.3, out: 15 } },
  { id: 'deepseek-chat', transport: 'api', provider: 'compatible', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: 'DEEPSEEK_API_KEY', price: null },
];

// The most output one attempt may produce. Every request is capped at it (OUTPUT_LIMIT; claude -p
// per response through its environment, and in all by --max-budget-usd), so the spend cap's
// reservation holds; answers so far are a fraction of it.
export const MAX_OUTPUT_TOKENS = 8000;

// Where each API takes the output cap: the request body, or Gemini's generationConfig.
const OUTPUT_LIMIT = {
  openai: { max_completion_tokens: MAX_OUTPUT_TOKENS },
  compatible: { max_tokens: MAX_OUTPUT_TOKENS },
  gemini: { maxOutputTokens: MAX_OUTPUT_TOKENS },
  anthropic: { max_tokens: MAX_OUTPUT_TOKENS },
};

/** The most one attempt at this prompt can cost on this model. */
export const attemptWorstCase = (m, { system, user }) =>
  cost({ input: estimateTokens(system.length + user.length), cached: 0, output: MAX_OUTPUT_TOKENS }, m.price);

/**
 * How to call one model, or why it cannot be called.
 * @param {{bin?: string}} [o]  bin: the claude CLI to run (claudeCli.CLAUDE)
 * @returns {{skip: string} | {stream: (prompt, signal, hooks: {onUsage, onSettled}) => AsyncIterable<string>}}
 */
export function connect(m, env = process.env, { bin = claudeCli.CLAUDE } = {}) {
  if (m.transport === 'claude-cli') {
    if (!fs.existsSync(bin)) return { skip: `no claude CLI at ${bin}` };
    return {
      stream: (prompt, signal, hooks) => claudeCli.stream(
        { model: m.model, maxBudgetUsd: attemptWorstCase(m, prompt), maxOutputTokens: MAX_OUTPUT_TOKENS, bin, ...hooks },
        prompt, signal),
    };
  }
  if (!env[m.key]) return { skip: 'no key' };
  if (!m.price) return { skip: 'no price to hold the spend cap to' };
  const preset = PROVIDERS[m.provider];
  const cfg = providerConfig(
    { provider: m.provider, providers: { [m.provider]: { model: m.model, ...(m.baseUrl && { baseUrl: m.baseUrl }) } } },
    { [endpointOrigin(m.baseUrl ?? preset.baseUrl)]: env[m.key] });
  // A chat-completions stream reports its usage only when asked (the extension does not ask).
  const params = {
    ...cfg.params, ...OUTPUT_LIMIT[m.provider],
    ...(cfg.transport === chatCompletions && { stream_options: { include_usage: true } }),
  };
  return { stream: (prompt, signal, { onUsage }) => cfg.transport.stream({ ...cfg, params, onUsage }, prompt, signal) };
}

/** Tokens in, of them cached, and out (thinking included), from any provider's usage report. */
export function tokens(u) {
  if (!u) return null;
  if ('prompt_tokens' in u) {
    return { input: u.prompt_tokens, cached: u.prompt_tokens_details?.cached_tokens ?? 0, output: u.completion_tokens ?? null };
  }
  if ('promptTokenCount' in u) {
    const output = u.candidatesTokenCount === undefined ? null : u.candidatesTokenCount + (u.thoughtsTokenCount ?? 0);
    return { input: u.promptTokenCount, cached: u.cachedContentTokenCount ?? 0, output };
  }
  const cached = u.cache_read_input_tokens ?? 0;
  return {
    input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + cached, cached,
    output: u.output_tokens ?? null,
  };
}

/** USD for the tokens at the model's prices. */
export const cost = ({ input, cached, output }, price) =>
  ((input - cached) * price.in + cached * price.cached + output * price.out) / 1e6;

// Tokens counted from characters when a provider reported none (an answer abandoned mid-stream):
// three characters a token, more tokens than English text takes, so the cap errs high.
export const estimateTokens = (chars) => Math.ceil(chars / 3);
