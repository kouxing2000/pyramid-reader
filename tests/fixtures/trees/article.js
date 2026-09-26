// The paragraphs the extension reads from tests/fixtures/pages/article.html, as numbered in a
// tree's `src` (tests/e2e/tree.spec.js checks they match what the panel sends).
export const ARTICLE_PAGE = [
  'A county that counts its footbridges discovers that maintenance, not construction, decides their fate.',
  'By Staff.',
  'The county surveyed all 214 of its footbridges last spring and found that 61 needed repairs within five years.',
  'Engineers said the cheapest bridges to build were often the most expensive to keep, because timber decks rot faster than anyone budgets for.',
  'Officials cautioned that the survey may undercount damage, since inspectors could reach only the bridges that were not flooded that season.',
  'Residents in the northern villages rely on the bridges to reach the only clinic, which makes a closed crossing a two-hour detour.',
  'A council report estimated the backlog at 3.2 million, though it remains unclear whether that figure includes the flooded crossings.',
  'Some councillors argue the money would be better spent on a single road bridge; others say that would strand the smallest hamlets entirely.',
  'The council will publish a ranked repair list in the autumn, and residents can comment on it for six weeks after that.',
].map((text, i) => ({ n: i + 1, text }));

export const ARTICLE_PARAGRAPHS = ARTICLE_PAGE.length;

// A valid tree for that page, written for the tests: the answer the mock provider streams, and the
// unit tests' sample. Quotes and bases are verbatim from the page. One body carries markup, which
// must reach the panel as text.
export const ARTICLE_TREE = {
  lang: 'en',
  kind: 'report',
  verdict: 'A county survey found that 61 of its 214 footbridges need repairs within five years, though the damage may be undercounted.',
  verdict_src: [3, 5],
  verdict_basis: 'The county surveyed all 214 of its footbridges last spring and found that 61 needed repairs within five years.',
  branches: [
    {
      title: 'The cheapest bridges to build are often the most expensive to keep',
      src: [4],
      basis: 'Engineers said the cheapest bridges to build were often the most expensive to keep, because timber decks rot faster than anyone budgets for.',
      body: 'Engineers blame timber decks, which rot faster than budgets allow. <img src=x onerror="document.title=document.domain"> stays text.',
      children: [
        { quote: 'the cheapest bridges to build were often the most expensive to keep', src: [4], derived: false },
        { quote: 'timber decks rot faster than anyone budgets for', src: [4], derived: false },
      ],
    },
    {
      title: 'A closed crossing cuts northern villages off from the only clinic',
      src: [6],
      basis: 'Residents in the northern villages rely on the bridges to reach the only clinic, which makes a closed crossing a two-hour detour.',
      body: 'Residents rely on the bridges to reach the clinic.',
      children: [],
    },
    {
      title: 'The repair bill is estimated at 3.2 million, but it remains unclear what that covers',
      src: [3, 7],
      basis: 'A council report estimated the backlog at 3.2 million, though it remains unclear whether that figure includes the flooded crossings.',
      body: 'A council report put the backlog at 3.2 million; whether flooded crossings are included remains unclear.',
      children: [
        { quote: 'A council report estimated the backlog at 3.2 million', src: [7], derived: false },
        { quote: 'About 29% of the footbridges need repairs (61 of 214)', src: [3], derived: true },
      ],
    },
  ],
};

// The node ids readyNodes() lists for ARTICLE_TREE, in reading order.
export const ARTICLE_NODE_IDS = ['verdict', 'b0', 'b0.0', 'b0.1', 'b1', 'b2', 'b2.0', 'b2.1'];


// ARTICLE_TREE with one flaw of each kind the checks show (SPEC §5.3), and one they do not:
//   verdict  drops ¶5's "may": the survey "undercounts" the damage (no check reads certainty)
//   b0.0     cites ¶5 for a quote that is in ¶4 (repaired to ¶4)
//   b1       gives a basis that is not on the page (unanchored)
//   b2       states 4.5 million where ¶7 says 3.2 million
export const FLAWED_TREE = (() => {
  const t = structuredClone(ARTICLE_TREE);
  t.verdict = 'A county survey found that 61 of its 214 footbridges need repairs within five years, but the survey undercounts the damage.';
  t.branches[0].children[0].src = [5];
  t.branches[1].basis = 'Every northern village has lost its clinic to a closed bridge.';
  t.branches[2].title = 'The repair bill is estimated at 4.5 million, but it remains unclear what that covers';
  return t;
})();
