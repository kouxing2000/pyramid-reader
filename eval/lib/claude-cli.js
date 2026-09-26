// Claude through the dev machine's `claude -p` (SPEC §8), behind the stream() shape of the
// extension's transports, so buildTree(), the validator and the checks are the extension's own.
// Dev-only and never shipped (SPEC §6). No Anthropic API key exists here, so this is how the eval
// measures Claude models; the extension's own Anthropic transport stays unexercised live.
//
// The system prompt replaces Claude Code's, tools are off, thinking is off (SPEC §6), and the tree
// schema goes in as --json-schema, reduced by the Anthropic transport's own lenientSchema(). The
// CLI returns the answer as the input of a StructuredOutput tool call, streamed as
// input_json_delta; the first such call is the answer, and the stream ends when it closes. When
// the CLI rejects it against the schema, the model calls the tool again inside the same process:
// that call is not read, since the validator has already judged the first, and buildTree() retries
// as it does for any provider. Its cost still counts: the process is read to its end in the
// background for the cost it reports.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { lenientSchema } from '../../src/lib/providers/anthropic.js';
import { ProviderError } from '../../src/lib/providers/http.js';

export const CLAUDE = path.join(os.homedir(), '.local/bin/claude');

/**
 * The command line, as prototype/read.py runs it plus the switches above; the article goes on
 * stdin. maxBudgetUsd caps what the process spends, its own retries included: the CLI checks it
 * after each response, so each response's output is capped too, through the environment
 * (cliEnv()).
 */
export function claudeArgs(model, { system, schema }, maxBudgetUsd) {
  return [
    '-p', '--safe-mode', '--no-session-persistence', '--model', model,
    '--max-budget-usd', maxBudgetUsd.toFixed(4),
    '--settings', JSON.stringify({ alwaysThinkingEnabled: false }),
    '--system-prompt', system, '--tools', '',
    '--json-schema', JSON.stringify(lenientSchema(schema)),
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
  ];
}

/** The CLI's environment, with its output cap per response, which no flag sets. */
export const cliEnv = (maxOutputTokens, env = process.env) => ({ ...env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxOutputTokens) });

export const END = Symbol('the answer ended');

/** What one process reported: filled in by readEvent(). */
export const newState = () => ({ answer: null, closed: false, rateLimit: null, result: null });

/**
 * Reads one stream-json event into `state`.
 * @returns {string | typeof END | null}  a piece of the answer, END when the answer's block
 *   closes, else null; nothing more once it has closed
 */
export function readEvent(e, state) {
  if (e.type === 'rate_limit_event') state.rateLimit = e.rate_limit_info;
  else if (e.type === 'result') state.result = e;
  else if (e.type === 'stream_event' && !state.closed) {
    const ev = e.event;
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use' &&
        ev.content_block.name === 'StructuredOutput') state.answer = ev.index;
    else if (ev.type === 'content_block_delta' && ev.index === state.answer && ev.delta?.type === 'input_json_delta') {
      return ev.delta.partial_json || null;
    } else if (ev.type === 'content_block_stop' && ev.index === state.answer) {
      state.closed = true;
      return END;
    }
  }
  return null;
}

// How long the process may run on after its answer, reporting what it cost, before it is killed.
export const SETTLE_MS = 120_000;

/**
 * A transport for buildTree(): spawns `claude -p` and yields the answer's text as it streams.
 * Abandoning the answer before it ends, or the signal, kills the process.
 * @param {{model: string, maxBudgetUsd: number, maxOutputTokens: number, bin?: string,
 *   settleMs?: number, onSettled?: (p: Promise<object>) => void}} cfg
 *   model: a `--model` value; maxBudgetUsd: see claudeArgs(); maxOutputTokens: see cliEnv();
 *   bin: the CLI (CLAUDE); settleMs:
 *   SETTLE_MS; onSettled: a promise of the process's state (readEvent()) with its exit and stderr,
 *   given whenever the process ran to its own end (after the answer, or with no answer), for the
 *   cost it reports; a process still running settleMs after its answer is killed
 * @param {{system: string, user: string, schema: object}} prompt
 * @param {AbortSignal} [signal]
 * @returns {AsyncGenerator<string>}
 * @throws ProviderError when the CLI fails or exits without an answer
 */
export async function* stream(cfg, prompt, signal) {
  const child = spawn(cfg.bin ?? CLAUDE, claudeArgs(cfg.model, prompt, cfg.maxBudgetUsd), { stdio: ['pipe', 'pipe', 'pipe'], env: cliEnv(cfg.maxOutputTokens) });
  let stderr = '';
  let failed = null; // the process could not be started
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
  const exited = new Promise((ok) => {
    child.on('close', (code, sig) => ok({ code, sig }));
    child.on('error', (e) => {
      failed = e;
      ok({ code: null, sig: null });
    });
  });
  const kill = (sig = 'SIGTERM') => { if (child.exitCode === null && child.signalCode === null) child.kill(sig); };
  const onAbort = () => kill();
  signal?.addEventListener('abort', onAbort, { once: true });
  child.stdin.on('error', () => {}); // a process killed early closes its stdin under the write
  child.stdin.end(prompt.user);
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
  const state = newState();
  const next = async () => {
    for (;;) {
      const { value, done } = await lines.next();
      if (done) return null;
      if (!value.trim()) continue;
      try {
        return JSON.parse(value);
      } catch {
        throw new ProviderError(`claude -p wrote a line that is not JSON: ${value.slice(0, 100)}`);
      }
    }
  };
  let ended = false; // the answer's block closed
  let finished = false; // the process ran to its end with no answer
  try {
    for (let e; (e = await next());) {
      const out = readEvent(e, state);
      if (out === END) {
        ended = true;
        return;
      }
      if (out) yield out;
    }
    const { code, sig } = await exited;
    if (signal?.aborted) throw signal.reason;
    finished = true;
    if (failed) throw new ProviderError(`could not start claude -p: ${failed.message}`);
    const r = state.result;
    if (r?.is_error) throw new ProviderError(`claude -p: ${r.subtype}: ${String(r.result ?? r.errors ?? '').slice(0, 300)}`);
    throw new ProviderError(`claude -p ended without an answer (exit ${code ?? sig}): ${stderr.trim().split('\n').at(-1) ?? ''}`);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (ended) {
      cfg.onSettled?.((async () => {
        const timer = setTimeout(() => kill('SIGKILL'), cfg.settleMs ?? SETTLE_MS);
        try {
          for (let e; (e = await next());) readEvent(e, state);
        } catch {
          // a line that is not JSON after the answer: the state read so far stands
        } finally {
          clearTimeout(timer);
        }
        return { ...state, ...(await exited), stderr };
      })());
    } else if (finished) {
      cfg.onSettled?.(exited.then((exit) => ({ ...state, ...exit, stderr })));
    } else {
      kill();
    }
  }
}
