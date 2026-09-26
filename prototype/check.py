"""Faithfulness spot-check: every quote and number in a node must appear in its cited paragraphs."""
import json, re, sys
WORDS = r"\b(?:three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)(?:-(?:one|two|three|four|five|six|seven|eight|nine))?\b"
norm = lambda s: (s.replace("’", "'").replace("‘", "'").replace("“", '"')
                   .replace("”", '"').replace("…", "...").lower())

def check(sid, verbose=True):
    src = {}
    for line in open(f"{sid}.source.txt", encoding="utf-8"):
        m = re.match(r"\[(\d+)\] (.*)", line)
        if m: src[int(m.group(1))] = norm(m.group(2))
    allsrc = " ".join(src.values())
    t = json.load(open(f"{sid}.tree.json"))
    nodes = [("VERDICT", t["verdict"], t["verdict_src"])]
    for b in t["branches"]:
        nodes.append((b["title"], b["title"] + " " + b["body"], b["src"]))
        nodes += [(c["title"], c["title"] + " " + c["body"], c["src"]) for c in b["children"]]
    stat = dict(nodes=len(nodes), checked=0, wrong_cite=0, absent=0, dangling=0, uncited=0,
                one_child=sum(1 for b in t["branches"] if len(b["children"]) == 1))
    for title, text, cites in nodes:
        stat["dangling"] += sum(1 for c in cites if c not in src)
        stat["uncited"] += not cites
        cited = " ".join(src.get(c, "") for c in cites)
        toks = []
        for q in re.findall(r'"([^"]{4,})"', norm(text)):
            toks += [p.strip(" .,") for p in q.split("...") if len(p.strip(" .,")) >= 4]
        toks += re.findall(r"\d[\d,.]*%?", text)
        toks += [w.lower() for w in re.findall(WORDS, text, re.I)]
        for tok in toks:
            stat["checked"] += 1
            k = norm(tok).rstrip(".,")
            if k in cited: continue
            where = "wrong_cite" if k in allsrc else "absent"
            stat[where] += 1
            if verbose: print(f"    {where}: {tok!r} cites={cites} <- {title[:55]}")
    return t, stat

if __name__ == "__main__":
    for sid in sys.argv[1:]:
        t, s = check(sid)
        print(f"{sid:32} kind={t['kind']:9} branches={len(t['branches'])} " + " ".join(f"{k}={v}" for k, v in s.items()))
