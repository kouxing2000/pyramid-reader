// One tree build for the eval: the extension's own prompt, buildTree() (validator and one retry)
// and verifier(), timed the way a reader waits for it, with what each attempt cost. The record
// keeps every attempt's raw answer, so the checks can be run again offline (score.js).
import fs from 'node:fs';
import { buildTree } from '../../src/lib/build.js';
import { treePrompt } from '../../src/lib/prompt.js';
import { verifier } from '../../src/lib/verify/index.js';
import { attemptWorstCase, cost, estimateTokens, tokens } from './models.js';

// A reader stops a build that hangs; the eval has no reader, so every build has a deadline.
const BUILD_TIMEOUT_MS = 240_000;

const seconds = (ms) => (ms === null ? null : Math.round(ms) / 1000);

/**
 * The most one build of this page can cost on this model: what the cap reserves. A retry is the
 * same prompt plus the rejection, so each attempt is sized at a little over the first.
 */
export const worstCase = (m, page) => 2.2 * attemptWorstCase(m, treePrompt(page));

/**
 * @param {object} m  a MODELS entry
 * @param {{stream: Function}} conn  connect(m)
 * @param {{id, url, sha256, title, paragraphs}} page
 * @param {{timeoutMs?: number, signal?: AbortSignal}} [o]  signal: stops the build, as a reader's
 *   Stop does
 * @returns {Promise<object>} the record: {model, page, tree | null, error | null, retries, attempts,
 *   seconds: {verdict, total}, costUsd, estimated, resolvedModel, rateLimit}
 */
export async function runOne(m, conn, page, { timeoutMs = BUILD_TIMEOUT_MS, signal } = {}) {
  const prompt = treePrompt(page);
  const attempts = [];
  const retries = [];
  const started = performance.now();
  const at = () => performance.now() - started;
  const stream = async function* (p, signal) {
    const a = { text: '', usage: null, settled: null, complete: false, verdictMs: null, promptChars: p.system.length + p.user.length };
    attempts.push(a);
    const hooks = {
      onUsage: (u) => { a.usage = { ...a.usage, ...u }; },
      onSettled: (s) => { a.settled = s; },
    };
    for await (const d of conn.stream(p, signal, hooks)) {
      a.text += d;
      yield d;
    }
    a.complete = true;
  };
  let tree = null;
  let error = null;
  try {
    tree = await buildTree({
      prompt, stream, count: page.paragraphs.length, verify: verifier(page.paragraphs),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      onNode: (n) => {
        if (n.type === 'verdict') attempts.at(-1).verdictMs ??= at();
      },
      onRetry: (e) => retries.push(e),
    });
  } catch (e) {
    error = `${e.name}: ${e.message}`;
  }
  const totalMs = at();

  let estimated = false;
  let resolvedModel = m.transport === 'claude-cli' ? null : m.model; // an alias until the CLI names it
  let rateLimit = null;
  // claude -p kills a process that outlives its deadline, so each of these settles.
  const settled = await Promise.all(attempts.map((a) => a.settled));
  const recorded = attempts.map((a, i) => {
    let t;
    let usd;
    const result = settled[i]?.result;
    if (result?.total_cost_usd !== undefined) {
      t = tokens(result.usage);
      usd = result.total_cost_usd;
      const [name, use] = Object.entries(result.modelUsage ?? {})[0] ?? [];
      resolvedModel = use?.canonicalModel ?? name ?? resolvedModel;
      rateLimit = settled[i].rateLimit ?? rateLimit;
    } else {
      // An answer abandoned or cut off mid-stream has no final usage report: what was reported so
      // far (Gemini's running count, Anthropic's message_start) undercounts its output.
      t = tokens(a.usage);
      if (!t || t.output === null || !a.complete) {
        estimated = true;
        t = {
          input: t?.input ?? estimateTokens(a.promptChars), cached: t?.cached ?? 0,
          output: Math.max(t?.output ?? 0, estimateTokens(a.text.length)),
        };
      }
      usd = cost(t, m.price);
    }
    return {
      text: a.text, tokens: t, costUsd: usd,
      seconds: { verdict: seconds(a.verdictMs) },
    };
  });
  const last = attempts.at(-1);
  return {
    model: m.id, provider: m.provider, via: m.via ?? null, resolvedModel,
    page: { id: page.id, url: page.url, sha256: page.sha256, paragraphs: page.paragraphs.length },
    at: new Date().toISOString(),
    tree, error, retries, attempts: recorded,
    seconds: {
      verdict: tree ? seconds(last.verdictMs) : null,
      total: seconds(totalMs),
    },
    costUsd: recorded.reduce((t, a) => t + a.costUsd, 0),
    estimated, rateLimit,
  };
}

/**
 * The spend cap: what the ledger (spend.jsonl) has spent, plus what running builds have reserved.
 * A build starts only when its worst case fits under the cap; its real cost replaces the reservation
 * when it ends. Reservations live in this process, so one run at a time spends from a ledger (the
 * run step holds a lock).
 */
export class Budget {
  /** @throws RangeError unless cap is a positive number of dollars */
  constructor(cap, ledgerFile) {
    if (!(Number.isFinite(cap) && cap > 0)) throw new RangeError(`the spend cap must be a positive number of dollars, not ${cap}`);
    this.cap = cap;
    this.file = ledgerFile;
    this.reserved = 0;
    this.inFlight = 0; // builds holding a reservation
  }

  /** What the ledger holds, read afresh. */
  get spent() {
    return fs.existsSync(this.file)
      ? fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).reduce((t, l) => t + JSON.parse(l).costUsd, 0)
      : 0;
  }

  /** @returns {boolean} false when `usd` more would pass the cap */
  reserve(usd) {
    if (this.spent + this.reserved + usd > this.cap) return false;
    this.reserved += usd;
    this.inFlight++;
    return true;
  }

  /** Replaces a reservation with the build's real cost, recorded in the ledger. */
  settle(reservedUsd, entry) {
    fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`);
    this.inFlight--;
    this.reserved = this.inFlight ? this.reserved - reservedUsd : 0;
  }
}
