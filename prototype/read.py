#!/usr/bin/env python3
"""Prototype: turn any article URL into a pyramid tree, written next to this file as NAME.tree.json.

    read.py URL NAME [MODEL]

Throwaway validation for "is a pyramid reader worth building", not product code:
stdlib extraction, one `claude -p` call, every node cites the numbered paragraphs it
came from so faithfulness can be checked against the source afterwards.
"""
import json, re, subprocess, sys, time, urllib.request
from html.parser import HTMLParser
from pathlib import Path

CLAUDE = str(Path.home() / ".local/bin/claude")
OUT = Path(__file__).resolve().parent


class Extract(HTMLParser):
    """Paragraphs and h2/h3 headings inside the page's <article>, else <main>, else body."""
    KEEP = {"p", "h2", "h3"}
    SKIP = {"script", "style", "noscript", "figure", "figcaption", "nav", "footer", "aside",
            "table", "sup"}

    def __init__(self, scope):
        super().__init__(convert_charrefs=True)
        self.scope, self.depth_scope, self.skip = scope, 0, 0
        self.cur, self.tag, self.blocks = None, None, []

    def handle_starttag(self, tag, attrs):
        if tag == self.scope:
            self.depth_scope += 1
        if tag in self.SKIP:
            self.skip += 1
        if self.depth_scope and not self.skip and tag in self.KEEP:
            self.cur, self.tag = [], tag

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        if tag == self.tag and self.cur is not None:
            text = " ".join("".join(self.cur).split())
            text = re.sub(r"\[(\d+|[a-z]|citation needed|note \d+)\]", "", text).strip()
            if text:
                self.blocks.append((self.tag, text))
            self.cur, self.tag = None, None
        if tag == self.scope and self.depth_scope:
            self.depth_scope -= 1

    def handle_data(self, data):
        if self.cur is not None and not self.skip:
            self.cur.append(data)


def extract(html: str) -> list[tuple[str, str]]:
    for scope in ("article", "main", "body"):
        p = Extract(scope); p.feed(html)
        paras = [b for b in p.blocks if b[0] == "p" and len(b[1]) >= 40]
        if len(paras) >= 5:
            return [b for b in p.blocks if b[0] != "p" or len(b[1]) >= 40]
    return []


SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["kind", "verdict", "zh", "verdict_src", "branches"],
    "properties": {
        "kind": {"type": "string", "enum": ["argument", "report", "narrative", "reference"]},
        "verdict": {"type": "string"}, "zh": {"type": "string"},
        "verdict_src": {"type": "array", "items": {"type": "integer"}},
        "branches": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["title", "zh", "body", "src", "children"],
            "properties": {
                "title": {"type": "string"}, "zh": {"type": "string"},
                "body": {"type": "string"},
                "src": {"type": "array", "items": {"type": "integer"}},
                "children": {"type": "array", "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["title", "body", "src"],
                    "properties": {"title": {"type": "string"}, "body": {"type": "string"},
                                   "src": {"type": "array", "items": {"type": "integer"}}}}}}}},
    },
}

RULES = """You restructure an article into a Minto pyramid a reader can skim top-down and
drill into. Rules:

1. `verdict`: ONE sentence, the article's main point -- the thing a reader must take away
   if they read nothing else. `zh`: the same in Chinese, one line, full-width punctuation.
2. `kind`: argument (makes a case), report (news: what happened), narrative (a story or
   biography), reference (explains a topic). NEVER invent a thesis the text does not make:
   for a narrative or reference piece, the verdict states what the piece establishes about
   its subject, not an argument you supply.
3. `branches`: 3-5, MECE, ordered by importance. Each `title` is a CLAIM that answers the
   "why?" or "how?" the verdict provokes -- never a bucket like "Background", "Reactions",
   "Early life". Each branch has a one-line Chinese `zh` and a `body` of 1-3 sentences.
4. `children`: two or none per branch -- one child groups nothing. Each is a claim with a
   1-2 sentence body carrying the specific evidence (numbers, names, quotes).
5. `src` / `verdict_src`: the paragraph numbers [n] the node is based on. Every node must
   cite at least one. Say only what the cited paragraphs say: no outside knowledge, no
   inference beyond the text. If the article attributes a claim to someone, keep the
   attribution.

The article follows, one numbered paragraph per line; lines starting with ## are headings."""


def run(url: str, sid: str, model: str = "") -> None:
    t0 = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    blocks = extract(html)
    lines, n = [], 0
    for tag, text in blocks:
        if tag == "p":
            n += 1
            lines.append(f"[{n}] {text}")
        else:
            lines.append(f"## {text}")
    article = "\n".join(lines)
    (OUT / f"{sid}.source.txt").write_text(article, encoding="utf-8")
    print(f"[{sid}] extracted {n} paragraphs, {len(article)} chars", file=sys.stderr)
    if n < 5:
        raise SystemExit(f"[{sid}] extraction found too little text")

    cmd = [CLAUDE, "-p", RULES + "\n\n" + article,
           "--safe-mode", "--no-session-persistence", "--allowed-tools", "",
           "--json-schema", json.dumps(SCHEMA), "--output-format", "json"]
    if model:
        cmd += ["--model", model]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       stdin=subprocess.DEVNULL, cwd=str(OUT), timeout=600)
    (OUT / f"{sid}.envelope.json").write_bytes(r.stdout)
    if r.returncode != 0:
        raise SystemExit(f"[{sid}] claude exited {r.returncode}: {r.stderr.decode()[:400]}")
    env = json.loads(r.stdout)
    tree = env.get("structured_output") or env.get("result")
    if isinstance(tree, str):
        tree = json.loads(tree)

    (OUT / f"{sid}.tree.json").write_text(json.dumps(tree, ensure_ascii=False, indent=1),
                                          encoding="utf-8")
    usage = {k: env.get(k) for k in ("total_cost_usd", "duration_ms", "modelUsage")}
    print(f"[{sid}] kind={tree['kind']} branches={len(tree['branches'])} "
          f"secs={time.time() - t0:.0f} usage={json.dumps(usage)[:400]}", file=sys.stderr)


if __name__ == "__main__":
    run(*sys.argv[1:4])
