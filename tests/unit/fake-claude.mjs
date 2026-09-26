#!/usr/bin/env node
// A stand-in for `claude -p --output-format stream-json`, for the claude -p transport's tests. The
// --model argument picks what it does:
//   answer  streams a StructuredOutput answer, then a result that reports its cost; the result's
//           `result` is the output cap the CLI was given in its environment, and `args` its
//           command line
//   tree    the same, with the article fixture's tree as the answer
//   error   ends with an error result and a cost, and no answer
//   hang    streams the answer, then never ends
//   slow    never answers
import process from 'node:process';
import { ARTICLE_TREE } from '../fixtures/trees/article.js';

const model = process.argv[process.argv.indexOf('--model') + 1];
const emit = (e) => process.stdout.write(`${JSON.stringify(e)}\n`);
const se = (event) => emit({ type: 'stream_event', event });
const answer = (parts = ['{"a":', ' 1}']) => {
  se({ type: 'message_start', message: {} });
  se({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'StructuredOutput', input: {} } });
  for (const partial_json of parts) se({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json } });
  se({ type: 'content_block_stop', index: 0 });
};

process.stdin.resume();
process.stdin.on('end', () => {
  emit({ type: 'system', subtype: 'init' });
  if (model === 'answer' || model === 'tree') {
    const tree = JSON.stringify(ARTICLE_TREE);
    answer(model === 'tree' ? [tree.slice(0, 200), tree.slice(200)] : undefined);
    emit({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } });
    emit({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.0123,
      result: process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, args: process.argv.slice(2), usage: { input_tokens: 10, output_tokens: 5 },
      modelUsage: { 'claude-x-20260101': { canonicalModel: 'claude-x', costUSD: 0.0123 } } });
    process.exit(0);
  } else if (model === 'error') {
    emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom', total_cost_usd: 0.004 });
    process.exit(1);
  } else if (model === 'hang') {
    answer();
    setInterval(() => {}, 1000);
  } else {
    setInterval(() => {}, 1000);
  }
});
