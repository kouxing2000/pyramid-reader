// The models the eval (SPEC §8) has measured, shown in the settings' tested-models table (SPEC
// §5.4). `node eval/eval.mjs tested` writes the rows from a run's results (eval/results/<run>/);
// a model not listed still works, unmeasured.
//
//   {provider: 'openai', model: 'gpt-5.4-mini',
//    via: 'claude -p',     only when measured outside the extension's own transport
//    anchored: 0.99,       share of evidence quotes found on the page
//    verdictSeconds: 2.1,  median time to the verdict
//    totalSeconds: 6.5,    median time to the whole tree
//    pages: 81,            pages measured
//    measured: '2026-10-01'}  the run

/** @type {{provider: string, model: string, via?: string, anchored: number,
 *          verdictSeconds: number, totalSeconds: number, pages: number, measured: string}[]} */
export const TESTED_MODELS = [
  { provider: 'gemini', model: 'gemini-3.5-flash-lite', anchored: 0.965, verdictSeconds: 1.3, totalSeconds: 4.2, pages: 81, measured: '2026-09-24' },
  { provider: 'gemini', model: 'gemini-3.8-flash', anchored: 1, verdictSeconds: 1.5, totalSeconds: 5.4, pages: 81, measured: '2026-09-24' },
  { provider: 'openai', model: 'gpt-5.4-mini', anchored: 0.982, verdictSeconds: 1, totalSeconds: 4.9, pages: 81, measured: '2026-09-24' },
  { provider: 'openai', model: 'gpt-5.5', anchored: 1, verdictSeconds: 1.9, totalSeconds: 13, pages: 41, measured: '2026-09-24' },
  { provider: 'anthropic', model: 'claude-haiku-4-5', via: 'claude -p', anchored: 0.969, verdictSeconds: 3.4, totalSeconds: 18.3, pages: 79, measured: '2026-09-24' },
  { provider: 'anthropic', model: 'claude-sonnet-5', via: 'claude -p', anchored: 0.988, verdictSeconds: 16.4, totalSeconds: 18.1, pages: 41, measured: '2026-09-24' },
];

/** The eval's row for a provider's model, or null: the eval has not measured it. */
export const testedModel = (provider, model, rows = TESTED_MODELS) =>
  rows.find((r) => r.provider === provider && r.model === model?.trim()) ?? null;
