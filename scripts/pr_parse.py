"""Read the headline statement lines from an earnings press release (8-K Item 2.02, exhibit 99.1).

The release is filed minutes after the results; its condensed statements are unaudited and not XBRL-tagged, so the
lines are read from the HTML tables: the first number on a matched row is the current quarter (three months ended).
Only rows with an unambiguous label are taken; anything not found stays absent (never estimated).
"""
import os, re

VERSION = 2   # bump when the reader changes: stored reads from an older version are re-read
from html.parser import HTMLParser

from desknet import sec_ua

# SEC fair-access rule: automated requests must name a contact email. It comes from the SEC_CONTACT secret (never in the repo).
SEC_UA = sec_ua(**{"Accept-Encoding": "gzip, deflate"})

LINES = [   # key, label regex (whole label, case-insensitive), allow-negative
    ("rev", r"(total )?(net sales|net revenues?|revenues?|total revenues?|total net sales|total net revenues?|sales)", False),
    ("cogs", r"(total )?cost of (sales|revenues?|goods sold)", False),
    ("gp", r"(total )?gross (margin|profit)", True),
    ("opinc", r"(total )?(operating income( \(loss\))?|income( \(loss\))? from operations|operating profit)", True),
    ("ni", r"net (income|earnings)( \(loss\))?( attributable to [\w\s.,&'’()-]+)?", True),
]


class _T(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables, self.row, self.cell, self.inrow, self.incell, self.text = [], None, None, False, False, []
        self.depth, self.prose = 0, []   # text outside tables (narrative paragraphs) for the quoted sentences

    def handle_starttag(self, tag, a):
        if tag == "table":
            self.tables.append([])
            self.depth += 1
        elif tag in ("p", "div", "li", "br") and not self.depth:
            self.prose.append(" \n ")
        elif tag == "tr" and self.tables:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []

    def handle_endtag(self, tag):
        if tag == "table":
            self.depth = max(0, self.depth - 1)
        if tag in ("td", "th") and self.cell is not None and self.row is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.row is not None and self.tables:
            if any(self.row):
                self.tables[-1].append(self.row)
            self.row = None

    def handle_data(self, d):
        self.text.append(d)
        if not self.depth:
            self.prose.append(d)
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
        # the table's own unit wins; the narrative ("$701.5 million …") must not override "(in thousands)" on the table
        mult = (1e3 if "in thousands" in tt else 1e6 if "in millions" in tt else 1 if "in dollars" in tt else
                1e3 if "in thousands" in text[:20000] else 1e6)
        # column order: some companies put the prior year first (e.g. 2025 | 2026) — take the latest year's column
        yrs = []
        for r in T[:6]:
            for c in r:
                for y in re.findall(r"\b(20\d\d)\b", c):
                    yrs.append(int(y))
            if len(yrs) >= 2:
                break
        col = 1 if len(yrs) >= 2 and yrs[1] > yrs[0] else 0
        in_eps, total_rev, pyc = False, None, 0 if col == 1 else 1   # the other three-month column = same quarter last year
        py = out.setdefault("py", {})
        for lab, raw in rows:
            nums = raw[col:] if len(raw) > col else raw
            prior = raw[pyc] if len(raw) > max(col, pyc) else None
            if not nums:
                in_eps = in_eps or bool(re.search(r"(earnings|income|net income).*per (common )?share", lab))
                continue
            for key, rx, _ in LINES:
                if key not in out and re.fullmatch(rx, lab):
                    out[key] = nums[0] * mult
                    if prior is not None:
                        py[key] = prior * mult
                    if key == "rev" and lab.startswith("total"):
                        total_rev = nums[0] * mult
                        if prior is not None:
                            py["rev_total"] = prior * mult
            if total_rev:
                out["rev"] = total_rev
                if "rev_total" in py:
                    py["rev"] = py["rev_total"]
            if re.search(r"per (common )?share", lab):
                in_eps = True
            if "eps_d" not in out and (in_eps or "per share" in lab) and re.fullmatch(r"(diluted|diluted earnings per share|.*per share.*diluted|diluted net income per share)", lab) and abs(nums[0]) < 1000:
                out["eps_d"] = nums[0]
                if prior is not None and abs(prior) < 1000:
                    py["eps_d"] = prior
        if out.get("rev") and out.get("ni") is not None:
            break
    # EPS anywhere in the release (summary tables above the income statement included): GAAP diluted, and the company's own
    # adjusted / non-GAAP EPS (same basis as analyst consensus). First matching row wins; prior year from the other column.
    for T in p.tables:
        yrs = []
        for r in T[:6]:
            for c in r:
                yrs += [int(y) for y in re.findall(r"\b(20\d\d)\b", c)]
            if len(yrs) >= 2:
                break
        col = 1 if len(yrs) >= 2 and yrs[1] > yrs[0] else 0
        for r in T:
            lab, raw = _row(r)
            if len(raw) <= col or abs(raw[col]) >= 1000 or BAD_EPS.search(lab):
                continue
            prior = raw[1 - col] if len(raw) > 1 else None
            if "eps_adj" not in out and ADJ_EPS.search(lab):
                out["eps_adj"] = raw[col]
                if prior is not None and abs(prior) < 1000:
                    out.setdefault("py", {})["eps_adj"] = prior
            elif "eps_d" not in out and GAAP_EPS.search(lab) and not ADJ_EPS.search(lab):
                out["eps_d"] = raw[col]
                if prior is not None and abs(prior) < 1000:
                    out.setdefault("py", {})["eps_d"] = prior
    py = out.pop("py", {})
    py.pop("rev_total", None)
    if py.get("rev") and py.get("gp") is None and py.get("cogs") is not None:
        py["gp"] = py["rev"] - py["cogs"]
    for k in ("rev", "ni", "eps_d", "eps_adj", "opinc", "gp"):   # year-over-year growth, only where both years were read
        if out.get(k) is not None and py.get(k):
            out[k + "_yoy"] = round((out[k] / py[k] - 1) * 100, 1) if py[k] > 0 else None
    out["py"] = {k: v for k, v in py.items() if k in ("rev", "ni", "eps_d", "eps_adj", "opinc", "gp")}
    out["quotes"] = quotes(" ".join("".join(p.prose).split()))
    if out.get("rev") and (out["rev"] > 4e11 or out["rev"] < 1e6):
        return {}   # no S&P 500 company books > $400B or < $1M a quarter: the unit was misread — show N/A rather than a wrong number
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


GAAP_EPS = re.compile(r"(diluted (net )?(earnings|income|eps)|(earnings|income|eps).{0,40}\bper diluted|\bdiluted eps\b|^(gaap|reported)\W.{0,12}(diluted )?eps|^total diluted (earnings|income)|per (common )?share.{0,10}diluted|diluted.{0,50}per (common )?share|^diluted$)", re.I)
ADJ_EPS = re.compile(r"(adjusted|non-gaap|excluding special items|ex(\.|cluding)? items|core).{0,40}(eps|per (diluted |common )?share)|(eps|per share).{0,20}(excluding special items|adjusted)", re.I)
BAD_EPS = re.compile(r"basic|weighted|shares outstanding|impact|^less\b|dividend|par value|treasury|authorized|discontinued", re.I)
GUIDE = re.compile(r"\b(outlook|guidance|guides?|expects?|expected to|reaffirm\w*|raises?|raised|lowers?|lowered|narrow\w*|full[- ]year|fiscal (?:year )?20\d\d|next quarter)\b", re.I)
HIGH = re.compile(r"\b(record|increased?|decreased?|grew|growth|up \d|down \d|declined?|rose|fell|margin|demand|volumes?|segment)\b", re.I)
BOILER = re.compile(r"forward-looking statements|safe harbor|non-gaap financial measures? (?:are|is)|webcast|conference call|replay|investor relations|about [A-Z]|www\.|press release", re.I)


def quotes(text):
    """Guidance and highlight sentences quoted verbatim from the release (boilerplate dropped), at most 3 each."""
    S = [x.strip() for x in re.split(r"(?<=[.!?])\s+(?=[A-Z“\"])", text[:60000]) if 40 <= len(x.strip()) <= 320 and not BOILER.search(x)]
    g = [x for x in S if GUIDE.search(x) and re.search(r"\d", x)][:3]
    h = [x for x in S[:80] if HIGH.search(x) and re.search(r"\d", x) and x not in g][:3]
    return {"guidance": g, "highlights": h}


def exhibit_url(get, cik, acc):
    """URL of exhibit 99.1 in a filing (from the filing index)."""
    base = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace('-', '')}/"
    j = get(base + "index.json").json()
    items = j.get("directory", {}).get("item", [])
    names = [i["name"] for i in items if i["name"].lower().endswith((".htm", ".html"))]
    pick = next((n for n in names if re.search(r"ex-?99[._-]?0?1|ex991|exhibit991|ex99", n.lower())), None)
    return base + pick if pick else None
