// Numbers in the tree's own words must come from the text it cites (SPEC §4.1). A value the model
// computed is declared `derived` on an evidence node (decision 8); a number anywhere else that the
// cited paragraphs do not hold is flagged, never taken to be derived.

const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = { hundred: 1e2, thousand: 1e3, million: 1e6, m: 1e6, mn: 1e6, billion: 1e9, bn: 1e9, trillion: 1e12, tn: 1e12, k: 1e3 };
// "one" and "two" count only before a scale word ("two million"): on their own they are mostly
// pronouns and determiners ("one of them", "the two sides").
const LONE_WORD_MIN = 3;

const WORD_NUMBER = `(?:(?:${TENS.join('|')})(?:[- ](?:${UNITS.slice(1, 10).join('|')}))?|${UNITS.join('|')})`;
const NUMBER = new RegExp(
  `(?<![\\p{L}\\p{N}.,])(?:(\\d+(?:,\\d{3})*(?:\\.\\d+)?|\\.\\d+)|(${WORD_NUMBER})(?!\\p{L}))` +
  `(?:((?:\\s+(?:hundred|thousand|million|billion|trillion)\\b)+)|(m|mn|bn|tn|k)(?![\\p{L}\\p{N}]))?`,
  'giu');

const wordValue = (w) => {
  const [tens, unit] = w.toLowerCase().split(/[- ]/);
  const t = TENS.indexOf(tens);
  return t >= 0 ? (t + 2) * 10 + (unit ? UNITS.indexOf(unit) : 0) : UNITS.indexOf(tens);
};

/**
 * The numbers a text states, as digits, words ("fifty-seven") or with a scale ("3.2 million",
 * "£3.2m", "three hundred thousand"), each with its value so "fifty-seven" meets "57" and "3.2m"
 * meets "3,200,000". A digit ordinal ("21st") is its number; ordinal and fraction words ("first",
 * "half") and a lone "one" or "two" are not read.
 * @returns {{raw: string, value: number}[]}
 */
export function numbersIn(text) {
  const out = [];
  for (const m of text.matchAll(NUMBER)) {
    const [raw, digits, words, scaleWords, scaleSuffix] = m;
    const scale = (scaleWords?.trim().split(/\s+/) ?? [scaleSuffix ?? ''])
      .reduce((product, w) => product * (SCALES[w.toLowerCase()] ?? 1), 1);
    let value;
    if (digits) value = Number(digits.replace(/,/g, ''));
    else {
      value = wordValue(words);
      if (value < LONE_WORD_MIN && scale === 1) continue;
    }
    out.push({ raw: raw.trim(), value: Math.round(value * scale * 1e6) / 1e6 });
  }
  return out;
}

export const hasNumber = (text) => numbersIn(text).length > 0;

/**
 * Numbers in a verdict's or claim's own words (title, and a claim's body) that none of its cited
 * paragraphs states. `foundIn` names a paragraph that does hold it, or null.
 * @param {{type: string, title: string, body?: string, src: number[]}} node
 * @param {{numbers: Set<number>}[]} paragraphs  per paragraph, the values numbersIn() finds
 * @returns {{type: 'number', value: string, foundIn: number | null}[]}
 */
export function numberFlags(node, paragraphs) {
  const text = node.type === 'claim' ? `${node.title} ${node.body}` : node.title;
  const cited = node.src.map((n) => paragraphs[n - 1].numbers);
  const flags = [];
  const seen = new Set();
  for (const { raw, value } of numbersIn(text)) {
    if (seen.has(value) || cited.some((set) => set.has(value))) continue;
    seen.add(value);
    const at = paragraphs.findIndex((p) => p.numbers.has(value));
    flags.push({ type: 'number', value: raw, foundIn: at >= 0 ? at + 1 : null });
  }
  return flags;
}
