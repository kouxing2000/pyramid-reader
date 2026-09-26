// Every sentence the panel shows. panel.js and the tests import the same strings, so rewording
// one changes it everywhere.

const plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
// Rounded down to a tenth, so a rate short of 100% never reads as 100%.
export const percent = (share) => {
  const tenths = Math.floor(share * 1000 + 1e-9) / 10; // 0.989 * 1000 may land just under 989
  return `${Number.isInteger(tenths) ? tenths : tenths.toFixed(1)}%`;
};
const skippedNote = ({ hidden, clipped, covered }) => [
  covered && `${covered} behind an overlay`,
  clipped && `${clipped} cut off`,
  hidden && `${hidden} not shown on the page`,
].filter(Boolean).join(', ');

export const MSG = {
  // Reading the page
  reading: 'Reading the page…',
  noTab: 'This tab is gone.',
  needsClick: 'Pyramid Reader needs your OK to read this page: click its icon in the toolbar.',
  buildThisPage: 'Build tree to read this page.',
  unreadable: (reason) => `This page can't be read: ${reason}`,
  paragraphs: (count, skipped) => {
    const note = skippedNote(skipped);
    return plural(count, 'paragraph') + (note ? ` · skipped ${note}` : '');
  },
  noText: (skipped) => {
    const note = skippedNote(skipped);
    return 'No visible article text found' + (note ? ` (skipped ${note}).` : '.') +
      (skipped.covered || skipped.clipped ? ' Close any overlay on the page, then build again.' : '');
  },
  pageChanged: 'The page has changed since it was read. Build again.',
  paintStale: (k) => `The page has changed since it was read: ${plural(k, 'sentence')} of the tree could not be shown on it. Build again.`,

  // Building the tree
  needsSettings: 'Add a model and API key in Settings to build a tree. Until then, here is the text a tree would be built from.',
  asking: (model) => `Asking ${model}…`,
  retrying: (error) => `The answer broke a rule (${error}). Asking once more…`,
  built: (model, verdictMs, totalMs) => `${model}: verdict in ${seconds(verdictMs)}, whole tree in ${seconds(totalMs)}.`,
  brokeTwice: (error) => `Stopped: the answer broke a rule twice (${error}).`,
  providerFailed: (label, message) => `Stopped: ${label}: ${message}`,
  failed: (message) => `Stopped: ${message}`,
  stopped: 'Stopped.',
  derived: 'computed',

  // The tree's layout
  claims: 'Claims',
  expandAll: 'Expand all',
  collapseAll: 'Collapse all',
  foldTip: 'Open this claim when you want more than its title: its summary, sources and quotes',
  foldOpenTip: 'Fold this claim back to its title',
  expandAllTip: 'Open or fold every claim at once',
  summary: (found, total, flags) => `✓ ${found} of ${total} on the page${flags ? ` · ⚠ ${plural(flags, 'flag')}` : ''}`,

  // The tree in a second language (translate.js)
  readIn: 'Read in',
  readBoth: 'Both',
  readOriginalTip: (lang) => `The tree in the article's language, ${lang}.`,
  readBothTip: (lang, other) => `${lang}, with the ${other} translation under each line.`,
  readMineTip: (other) => `In ${other}, translated on this computer. Quotes stay as the page wrote them; hover a line for its original.`,
  readPickTip: 'Read the tree in another language',
  translateOffer: (lang) => `Translate into ${lang}`,
  translateOfferNote: 'Chrome downloads its translation model once, and translates on this computer.',
  translating: (lang) => `Translating into ${lang} on this computer…`,
  downloading: (lang, share) => `Downloading ${lang}… ${Math.floor(share * 100)}%`,
  translateFailed: (lang, message) => `Couldn't translate into ${lang}: ${message}`,
  retry: 'Retry',
  translateNeedsChrome: (to) => `Reading this tree in ${to} needs Chrome 138 or later, on a computer.`,
  cannotTranslate: (from, to, why) => `Chrome can't translate ${from} into ${to} on this computer${why ? ` (${why})` : ''}.`,

  // Check results on a node (SPEC §5.3): each is a mark, a space, then words (tree-view.js check())
  anchored: '✓ on the page',
  anchoredTip: 'Found on the page. Click the text to see its sentence there.',
  repaired: (n) => `↪ found in ¶${n}`,
  repairedTip: (from, n) => `Not in the cited ¶${from.join(', ¶')}; found in ¶${n}, which it now cites.`,
  unanchored: '⚠ not on the page',
  unanchoredTip: 'This text is not on the page. Clicking it shows the first paragraph it cites.',
  numberMissing: (value, foundIn) => `⚠ ${value} is not in the paragraphs it cites${foundIn ? `; it is in ¶${foundIn}` : ''}.`,

  // Saved trees and the demo (SPEC §5.1, §5.5)
  savedTree: (model, date) => `Saved tree, built by ${model} on ${date}.`,
  demoTree: ({ title, model, license }) => `Demo: the tree ${model} built for “${title}” from Wikipedia (${license}). ` +
    'Add an API key in Settings to use Pyramid Reader on any page.',
  demoOffer: 'No API key yet? See a tree first, built for a Wikipedia article.',
  demoMismatch: 'The demo’s tree does not fit its page: the demo page has changed.',

  // Settings
  saved: 'Saved. Build a tree on any article.',
  translation: 'Translation',
  translationFrom: (languages) => `A tree is translated on this computer into the first of your Chrome languages that isn't the article's. Your Chrome languages: ${languages}.`,
  translationChosen: (lang) => `A tree in another language is translated on this computer into ${lang}.`,
  translationNone: 'Translating a tree needs Chrome 138 or later, on a computer.',
  translateAuto: 'Automatic, from Chrome’s languages',
  chromesLanguages: 'Chrome’s languages',
  allLanguages: 'All languages',
  chromeLanguages: 'Change Chrome’s languages',
  // The model check beside the Model field (settings.js): `where` is the provider, or the host of
  // an OpenAI-compatible endpoint.
  modelValid: '✓',
  modelValidTip: (where, model) => `${where} has the model ${model}.`,
  modelMissing: (where) => `⚠ not found on ${where}`,
  modelMissingTip: (where, model) => `${where} has no model named ${model} for this key. Check the name.`,
  keyRejected: '⚠ key rejected',
  keyRejectedTip: (where) => `${where} refused the saved key, so the model could not be checked.`,
  tested: ({ anchored, verdictSeconds, totalSeconds, via }) =>
    `Measured: quotes anchored ${percent(anchored)}, ` +
    `verdict ${verdictSeconds} s, tree ${totalSeconds} s${via ? ` (measured via ${via})` : ''}.`,
  noTestedModels: 'No model has been measured yet.',
  // Above the tested-models table: each provider's default model (settings.js).
  recommended: (models) => `Recommended: ${models.join(', ')}, or a larger model from the same provider. ` +
    'In the eval even these sometimes stated a claim more surely than the page: click a claim to read its sentence before you rely on it.',
  needsModel: 'Enter a model name.',
  needsBaseUrl: 'Enter the endpoint’s base URL, such as https://api.deepseek.com/v1.',
  badBaseUrl: (value) => `Not a web address: ${value}`,
  needsKey: (label) => `Enter your ${label} API key.`,
  permissionDenied: (origin) => `Not saved: Pyramid Reader needs your OK to reach ${origin}.`,
  originNotAllowed: (origin) => `Not saved: ${origin} is not an endpoint Pyramid Reader may reach.`,
};
