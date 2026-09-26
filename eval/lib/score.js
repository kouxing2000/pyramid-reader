// The eval's scores (SPEC §8), computed offline from the stored raw trees and page text: every
// tree is validated and checked again with the extension's own readyNodes() and verifier(), so a
// change to the checks is re-scored without paying for a model call. Nothing here returns page
// text.
import { readyNodes } from '../../src/lib/tree.js';
import { verifier } from '../../src/lib/verify/index.js';

/**
 * Re-checks one record's tree against its page.
 * @returns {{nodes: object[]} | {error: string}}  nodes: readyNodes() shapes with anchor and flags
 */
function checkRecord(record, page) {
  if (!record.tree) return { error: record.error ?? 'no tree' };
  if (!page) return { error: `page ${record.page.id} is not in the run's pages` };
  if (page.sha256 !== record.page.sha256) return { error: `page ${record.page.id} changed since the build` };
  try {
    const verify = verifier(page.paragraphs);
    return { nodes: readyNodes(record.tree, page.paragraphs.length, true).map(verify) };
  } catch (e) {
    return { error: `${e.name}: ${e.message}` };
  }
}

// The median (the mean of the middle two for an even count), and nearest-rank for other quantiles.
const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  if (q === 0.5) return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
};
// Rounded down, in integers, so a rate short of 1 never becomes 1.
const ratio = (n, d) => (d ? Math.floor((n * 1000) / d) / 1000 : null);
const round = (x, digits = 1) => (x === null ? null : Math.round(x * 10 ** digits) / 10 ** digits);

/**
 * @param {Map<string, object>} pages  page id -> the page as extracted (with its kind)
 * @param {object[]} records  runOne() records
 * @returns {{models: object[], nodes: object[]}}  nodes: one row per checked node, with its anchor
 *   status and number flags but no text
 */
export function scoreRun(pages, records) {
  const rows = [];
  const byModel = new Map();
  for (const r of records) {
    if (!byModel.has(r.model)) byModel.set(r.model, []);
    byModel.get(r.model).push(r);
  }
  const models = [];
  for (const [model, recs] of byModel) {
    const m = {
      model, provider: recs[0].provider, via: recs[0].via, resolvedModel: recs.find((r) => r.resolvedModel)?.resolvedModel ?? null,
      attempted: recs.length, built: 0, firstTry: 0, failures: [],
      evidence: { total: 0, anchored: 0, repaired: 0, unanchored: 0, derived: 0 },
      basis: { total: 0, anchored: 0, repaired: 0, unanchored: 0 },
      numberFlaggedNodes: 0,
      byKind: {},
    };
    const verdictS = [];
    const totalS = [];
    let tokensIn = 0;
    let tokensOut = 0;
    let costUsd = 0;
    let estimated = false;
    for (const r of recs) {
      tokensIn += r.attempts.reduce((t, a) => t + (a.tokens?.input ?? 0), 0);
      tokensOut += r.attempts.reduce((t, a) => t + (a.tokens?.output ?? 0), 0);
      costUsd += r.costUsd;
      estimated ||= r.estimated;
      const page = pages.get(r.page.id);
      const kind = page?.kind ?? 'unknown';
      const k = (m.byKind[kind] ??= { built: 0, evidence: 0, evidenceAnchored: 0 });
      const checked = checkRecord(r, page);
      if (checked.error) {
        m.failures.push({ page: r.page.id, error: checked.error });
        continue;
      }
      m.built++;
      k.built++;
      if (!r.retries.length) m.firstTry++;
      if (r.seconds.verdict !== null) verdictS.push(r.seconds.verdict);
      totalS.push(r.seconds.total);
      for (const n of checked.nodes) {
        const row = { model, page: r.page.id, node: n.id, type: n.type, anchor: n.anchor.status };
        if (n.anchor.from) row.from = n.anchor.from;
        if (n.type === 'evidence') {
          m.evidence.total++;
          m.evidence[n.anchor.status]++;
          if (n.anchor.status !== 'derived') {
            k.evidence++;
            if (n.anchor.status !== 'unanchored') k.evidenceAnchored++;
          }
          rows.push(row);
          continue;
        }
        m.basis.total++;
        m.basis[n.anchor.status]++;
        const numbers = n.flags.filter((f) => f.type === 'number');
        if (numbers.length) m.numberFlaggedNodes++;
        row.flags = numbers.map((f) => ({ type: 'number', value: f.value, foundIn: f.foundIn }));
        rows.push(row);
      }
    }
    Object.assign(m, {
      firstTryRate: ratio(m.firstTry, m.attempted),
      anchored: ratio(m.evidence.anchored + m.evidence.repaired, m.evidence.total - m.evidence.derived),
      basisAnchored: ratio(m.basis.anchored + m.basis.repaired, m.basis.total),
      seconds: {
        verdict: round(quantile(verdictS, 0.5)), verdictP90: round(quantile(verdictS, 0.9)),
        total: round(quantile(totalS, 0.5)), totalP90: round(quantile(totalS, 0.9)),
      },
      tokens: { input: tokensIn, output: tokensOut, perTreeInput: Math.round(tokensIn / recs.length), perTreeOutput: Math.round(tokensOut / recs.length) },
      costUsd: round(costUsd, 4), costPerTreeUsd: round(costUsd / recs.length, 4), costEstimated: estimated,
    });
    models.push(m);
  }
  return { models, nodes: rows };
}

/** The ids of the pages every model has a record for, or null when there are no records. */
export function commonPages(records) {
  const byModel = Object.groupBy(records, (r) => r.model);
  return Object.values(byModel).map((rs) => new Set(rs.map((r) => r.page.id)))
    .reduce((a, b) => (a ? new Set([...a].filter((id) => b.has(id))) : b), null);
}
