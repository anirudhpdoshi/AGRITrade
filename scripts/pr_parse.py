"""Read the headline statement lines from an earnings press release (8-K Item 2.02, exhibit 99.1).

The release is filed minutes after the results; its condensed statements are unaudited and not XBRL-tagged, so the
lines are read from the HTML tables: the first number on a matched row is the current quarter (three months ended).
Only rows with an unambiguous label are taken; anything not found stays absent (never estimated).
"""
import re
from html.parser import HTMLParser

SEC_UA = {"User-Agent": "AGRITrade desk anirudh.p.doshi@gmail.com", "Accept-Encoding": "gzip, deflate"}

LINES = [   # key, label regex (whole label, case-insensitive), allow-negative
    ("rev", r"(total )?(net sales|net revenues?|revenues?|total revenues?|total net sales|total net revenues?|sales)", False),
    ("cogs", r"(total )?cost of (sales|revenues?|goods sold)", False),
    ("gp", r"(total )?gross (margin|profit)", True),
    ("opinc", r"(total )?(operating income( \(loss\))?|income( \(loss\))? from operations|operating profit)", True),
    ("ni", r"net income( \(loss\))?( attributable to [\w\s.,&'’-]+)?", True),
]


class _T(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables, self.row, self.cell, self.inrow, self.incell, self.text = [], None, None, False, False, []

    def handle_starttag(self, tag, a):
        if tag == "table":
            self.tables.append([])
        elif tag == "tr" and self.tables:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None and self.row is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.row is not None and self.tables:
            if any(self.row):
                self.tables[-1].append(self.row)
            self.row = None

    def handle_data(self, d):
        self.text.append(d)
        if self.cell is not None:
            self.cell.append(d)


def _num(c):
    c = c.replace("$", "").replace(",", "").replace("—", "").replace("–", "").strip()
    neg = c.startswith("(") or c.endswith(")")
    c = c.strip("() ")
    if not re.fullmatch(r"-?\d+(\.\d+)?", c or "x"):
        return None
    v = float(c)
    return -v if neg else v


def _row(r):
    lab = next((c for c in r if c and _num(c) is None and not re.fullmatch(r"[$%()\s]*", c)), "")
    nums = [n for n in (_num(c) for c in r) if n is not None]
    return lab.strip(" :").lower(), nums


def parse(html):
    p = _T()
    p.feed(html)
    text = " ".join(" ".join(p.text).split()).lower()
    out = {}
    for T in p.tables:
        rows = [_row(r) for r in T]
        labels = " | ".join(l for l, _ in rows)
        if not re.search(r"net income|net earnings", labels) or not re.search(r"revenue|net sales|sales", labels):
            continue   # the income statement table only
        tt = " ".join(" ".join(c for c in r if c) for r in T).lower()
        mult = 1e6 if "in millions" in tt or "in millions" in text[:20000] else 1e3 if "in thousands" in tt or "in thousands" in text[:20000] else 1e6
        in_eps, total_rev = False, None
        for lab, nums in rows:
            if not nums:
                in_eps = in_eps or bool(re.search(r"(earnings|income|net income).*per (common )?share", lab))
                continue
            for key, rx, _ in LINES:
                if key not in out and re.fullmatch(rx, lab):
                    out[key] = nums[0] * mult
                    if key == "rev" and lab.startswith("total"):
                        total_rev = nums[0] * mult
            if total_rev:
                out["rev"] = total_rev
            if re.search(r"per (common )?share", lab):
                in_eps = True
            if "eps_d" not in out and (in_eps or "per share" in lab) and re.fullmatch(r"(diluted|diluted earnings per share|.*per share.*diluted|diluted net income per share)", lab) and abs(nums[0]) < 1000:
                out["eps_d"] = nums[0]
        if out.get("rev") and out.get("ni") is not None:
            break
    if out.get("rev") and out.get("gp") is None and out.get("cogs") is not None:
        out["gp"] = out["rev"] - out["cogs"]
    if out.get("rev"):
        if out.get("gp") is not None:
            out["gm"] = round(out["gp"] / out["rev"] * 100, 2)
        if out.get("opinc") is not None:
            out["opm"] = round(out["opinc"] / out["rev"] * 100, 2)
        if out.get("ni") is not None:
            out["nm"] = round(out["ni"] / out["rev"] * 100, 2)
    return out


def exhibit_url(get, cik, acc):
    """URL of exhibit 99.1 in a filing (from the filing index)."""
    base = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace('-', '')}/"
    j = get(base + "index.json").json()
    items = j.get("directory", {}).get("item", [])
    names = [i["name"] for i in items if i["name"].lower().endswith((".htm", ".html"))]
    pick = next((n for n in names if re.search(r"ex-?99[._-]?0?1|ex991|exhibit991|ex99", n.lower())), None)
    return base + pick if pick else None
