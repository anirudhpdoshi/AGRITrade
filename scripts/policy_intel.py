#!/usr/bin/env python3
"""Central Bank Policy Intelligence (Fed, ECB, BoE, BoC, BoJ) -> policy.json on the orphan branch `policyintel`
(read by policy-ui.js, the "Policy" tab). Separate job: if it fails, nothing else on the desk is touched.

What it does, version one:
  * Reads each bank's OFFICIAL feeds / listing pages (statements, minutes/accounts, speeches, testimony, press conferences).
  * For every new document: fetches the official page, keeps a content hash + version, extracts the text.
  * Layer A  language: each sentence is tagged with a theme (inflation, employment, growth, financial conditions, forward
             guidance) and read as hawkish / dovish in context (negation flips it, "could / may / if" halves it).
  * Layer B  change: score vs the speaker's own previous 60 days (extended to their last 3 items when sparse, marked
             low-confidence) and vs the bank's latest policy statement. Baseline date and sample size are stored.
  * Layer C  speaker vs committee: statements/minutes are committee documents; speeches are individual. Voting status is
             only stated where it is certain (BoC decides by consensus -> NOT_APPLICABLE; otherwise UNKNOWN).
  * Layer D  forward guidance is extracted separately (direction + conditional/firm), so "could raise further" never
             becomes a predicted hike. Score, expected action and confidence are separate outputs.
  * Layer E  every score is stored with its timestamp so it can later be checked against what the bank actually did.
Rules: evidence is exact quoted sentences with paragraph numbers and the official URL - never paraphrased into quotes.
A phrase-based read, not a forecast. Respects each site's normal access (one request per page, short timeouts).
"""
import datetime as dt
import hashlib
import html as _html
import json
import os
import re
import subprocess
import sys
import time

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRANCH, FILE, WT = "policyintel", "policy.json", "/tmp/policyintel-worktree"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en;q=0.9"}
NOW = dt.datetime.now(dt.timezone.utc)

BANKS = {
    "fed": {"name": "Federal Reserve", "cc": "us", "feeds": ["https://www.federalreserve.gov/feeds/press_monetary.xml",
             "https://www.federalreserve.gov/feeds/speeches.xml", "https://www.federalreserve.gov/feeds/testimony.xml"]},
    "ecb": {"name": "European Central Bank", "cc": "eu", "feeds": ["https://www.ecb.europa.eu/rss/press.html"]},
    "boe": {"name": "Bank of England", "cc": "gb", "feeds": ["https://www.bankofengland.co.uk/rss/speeches", "https://www.bankofengland.co.uk/rss/news"]},
    "boc": {"name": "Bank of Canada", "cc": "ca", "feeds": ["https://www.bankofcanada.ca/content_type/speeches/feed/"],
            "lists": ["https://www.bankofcanada.ca/press/speeches/", "https://www.bankofcanada.ca/press/press-releases/"]},
    "boj": {"name": "Bank of Japan", "cc": "jp", "feeds": ["https://www.boj.or.jp/en/rss/whatsnew.xml"]},
}

# Published schedule (official calendars, as of Oct 29 2026 ET). Rechecked by hand / by the next build; shown with that date.
CALENDAR = [
    ("ecb", "2026-10-29", "14:15", "Europe/Berlin", "Policy decision + press conference", "decision"),
    ("boj", "2026-10-30", None, "Asia/Tokyo", "Policy statement + Outlook Report (meeting Oct 29–30)", "decision"),
    ("boe", "2026-11-05", "12:00", "Europe/London", "MPC decision, minutes + Monetary Policy Report", "decision"),
    ("boc", "2026-11-10", "13:30", "America/Toronto", "Summary of deliberations (Oct 28 decision)", "minutes"),
    ("boj", "2026-11-10", None, "Asia/Tokyo", "Summary of opinions", "minutes"),
    ("fed", "2026-11-18", "14:00", "America/New_York", "FOMC minutes (Oct 27–28 meeting)", "minutes"),
    ("fed", "2026-12-09", "14:00", "America/New_York", "FOMC decision + press conference (Dec 8–9)", "decision"),
    ("boc", "2026-12-09", "09:45", "America/Toronto", "Rate announcement", "decision"),
    ("ecb", "2026-12-17", "14:15", "Europe/Berlin", "Policy decision + press conference (Dec 16–17)", "decision"),
    ("boj", "2026-12-18", None, "Asia/Tokyo", "Policy statement (meeting Dec 17–18)", "decision"),
]
CAL_ASOF = "2026-10-29"

# ---------------------------------------------------------------- Layer A: themes and context
THEMES = {
    "inflation": r"inflation|price pressures?|price growth|cpi|core (?:inflation|measures|pce)|wage-price|inflation expectations",
    "employment": r"labou?r market|employment|unemployment|jobs?\b|job gains|hiring|wages?|payroll",
    "growth": r"growth|gdp|demand|consumption|spending|activity|output|recession|economy",
    "financial": r"financial conditions|credit|lending|financial stability|bank(?:ing)? stress|liquidity|spreads",
    "guidance": r"policy rate|interest rates?|bank rate|federal funds|overnight rate|deposit facility|monetary policy|tighten|eas(?:e|ing)|hike|cut",
}
HAWK = [
    (r"persist|sticky|stubborn|elevated|above (?:our |the )?target|too high|upside risks?|second[- ]round|de-?anchor|broad-?based price", "inflation"),
    (r"resilient|tight(?:ness)?|strong hiring|wage (?:growth|pressure)s? (?:remains?|is|are) (?:strong|elevated|high)|labou?r shortages?", "employment"),
    (r"above (?:potential|capacity)|excess demand|robust|strong (?:demand|consumption|growth)|overheat", "growth"),
    (r"too (?:loose|accommodative)|insufficient(?:ly)? restrict|eased? too much|financial conditions have eased", "financial"),
    (r"(?:raise|increase|tighten)\w*|further (?:increases?|tightening|hikes?)|cuts? (?:would be|are|is) premature|(?:rates?|policy)[^.]{0,20}higher for longer|remain restrictive for (?:some time|longer)|not (?:yet )?(?:time|appropriate) to (?:cut|ease|lower)", "guidance"),
]
DOVE = [
    (r"disinflation|eas(?:ed|ing) (?:price|inflation)|moderat(?:ed|ing)|declin(?:ed|ing) inflation|below (?:our |the )?target|fading|returned to target|close to (?:our |the )?target", "inflation"),
    (r"rising unemployment|unemployment(?: rate)? (?:has )?(?:risen|rose|increased|edged up|moved up)|job gains (?:have )?(?:slowed|weakened|moderated)|weak(?:er|ening) hiring|softening|cool(?:ed|ing)|slack|job losses|labou?r demand (?:has )?(?:weakened|eased)", "employment"),
    (r"weak(?:er|ening)? (?:demand|growth|activity)|recession|slow(?:down|ing|er|ed)|contract(?:ion|ed)|excess supply|deteriorat|subdued", "growth"),
    (r"tighter (?:financing|financial|credit)|credit stress|financial (?:instability|stress)|strains?", "financial"),
    (r"(?:lower|reduce|cut)\w* (?:the |our )?(?:policy |interest |bank )?rates?|further (?:easing|cuts?|reductions?)|less restrictive|room to (?:ease|cut)|easing (?:may|could|would) be (?:warranted|appropriate)", "guidance"),
]
AV = 2   # analysis version: stored items scored by an older version are re-read
FOREIGN = re.compile(r"\b(?:In the United States|U\.S\. economy|China|Chinese|euro area|Europe(?:an)? economy|Japan(?:ese)? economy|global (?:growth|economy|activity)|emerging market|other countries|abroad)\b", re.I)
DISSENT = re.compile(r"voting against|dissent|preferred (?:instead )?to (?:raise|lower|cut|reduce|increase|hold|maintain|leave|keep)|voted (?:in favour|in favor|for) (?:a |an )?(?:increase|reduction|cut|hike)|(?:\d+|one|two|three|four)[–-](?:\d+|one|two|three|four) vote|(?:majority|minority) of", re.I)
NEG = re.compile(r"\b(?:not|no longer|nor|never|without|unlikely)\b")
COND = re.compile(r"\b(?:could|may|might|if|would|should|possib|conditional|depend|one meeting at a time|data[- ]dependent)\w*")
GUIDE_T = re.compile(r"(?:need|necessary|prepared|appropriate)[^.]{0,40}(?:raise|increase|tighten)|further (?:increases?|tightening|hikes?)|raise (?:the )?(?:policy )?rate (?:further|again)", re.I)
GUIDE_E = re.compile(r"(?:need|necessary|prepared|appropriate|room)[^.]{0,40}(?:lower|reduce|cut|ease)|further (?:easing|cuts?|reductions?)", re.I)
GUIDE_H = re.compile(r"(?:maintain|keep|hold|left)\w*[^.]{0,40}(?:target range|policy rate|bank rate|interest rates?|overnight rate)\b|(?:rates?|policy)[^.]{0,30}(?:unchanged|steady|on hold)|\bpause\b", re.I)


def sentences(text):
    paras = [p.strip() for p in re.split(r"\n\s*\n|\n", text) if len(p.strip()) > 24]
    out = []
    for i, p in enumerate(paras):
        parts = re.split(r"(?<=[.!?])\s+(?=[A-Z“\"])", p)
        merged = []
        for x in parts:   # keep initials / abbreviations ("Beth M. Hammack", "U.S. economy") inside one sentence
            if merged and re.search(r"(?:\b[A-Z]|\bU\.S|\bNo|\bvs|\bMr|\bMs|\bDr|\bSt)\.$", merged[-1]):
                merged[-1] += " " + x
            else:
                merged.append(x)
        for s in merged:
            s = s.strip()
            if 24 <= len(s) <= 600:
                out.append((i + 1, s))
    return out


def analyse(text):
    """Return score -10..+10, label, theme scores, guidance, evidence (exact sentences with paragraph numbers)."""
    th = {k: 0.0 for k in THEMES}
    ev, H, D = [], 0.0, 0.0
    for para, s in sentences(text):
        sl = s.lower()
        if not any(re.search(p, sl) for p in THEMES.values()):
            continue
        w = 0.5 if COND.search(sl) else 1.0
        neg = bool(NEG.search(sl))
        foreign = bool(FOREIGN.search(s))
        hits = []   # a phrase only counts inside its own theme ("uncertainty remains elevated" is not inflation)
        for pat, theme in HAWK:
            if re.search(THEMES[theme], sl) and re.search(pat, sl) and not (foreign and theme in ("growth", "employment")):
                hits.append((+1, theme))
        for pat, theme in DOVE:
            if re.search(THEMES[theme], sl) and re.search(pat, sl) and not (foreign and theme in ("growth", "employment")):
                hits.append((-1, theme))
        if not hits:
            continue
        net = 0.0
        for sign, theme in hits:
            v = sign * w * (-1 if neg else 1)
            th[theme] += v
            net += v
        if net > 0:
            H += net
        elif net < 0:
            D += -net
        if net:
            ev.append({"q": s, "para": para, "dir": "hawk" if net > 0 else "dove", "w": round(abs(net), 2),
                       "theme": max(set(t for _, t in hits), key=lambda t: abs(th[t])), "cond": w < 1})
    score = round(10 * (H - D) / (H + D + 6), 1)   # +6 damps short texts: a few phrases cannot make an extreme score
    lab = "HAWKISH" if score >= 5 else "LEANING HAWKISH" if score >= 2 else "DOVISH" if score <= -5 else "LEANING DOVISH" if score <= -2 else "NEUTRAL"
    t = text
    g_dir = "tighten" if GUIDE_T.search(t) else "ease" if GUIDE_E.search(t) else "hold" if GUIDE_H.search(t) else "none"
    gm = (GUIDE_T if g_dir == "tighten" else GUIDE_E if g_dir == "ease" else GUIDE_H).search(t) if g_dir != "none" else None
    g_sent = ""
    if gm:
        a = t.rfind(".", 0, gm.start()) + 1
        b = t.find(".", gm.end())
        g_sent = t[a:b + 1 if b > 0 else len(t)].strip()[:400]
    g_cond = bool(g_sent and COND.search(g_sent.lower()))
    nxt = {("tighten", True): "Further tightening possible (conditional) — not a commitment to the next meeting",
           ("tighten", False): "Tightening signalled",
           ("ease", True): "Easing possible (conditional) — not a commitment",
           ("ease", False): "Easing signalled",
           ("hold", True): "Hold, with the door open either way", ("hold", False): "Hold signalled"}.get((g_dir, g_cond), "No explicit forward guidance")
    ev.sort(key=lambda e: -e["w"])
    dissent = [{"q": s, "para": p} for p, s in sentences(text) if DISSENT.search(s)][:4]
    rel = sum(1 for _, s in sentences(text) if re.search(THEMES["inflation"] + "|" + THEMES["guidance"], s.lower()))
    return {"av": AV, "dissent": dissent, "relevance": rel, "policy_relevant": rel >= 4, "score": score, "label": lab, "themes": {k: round(v, 1) for k, v in th.items()}, "hawk_n": round(H, 1), "dove_n": round(D, 1),
            "guidance": {"direction": g_dir, "conditional": g_cond, "quote": g_sent, "next_action": nxt},
            "evidence": [e for e in ev if e["dir"] == "hawk"][:4] + [e for e in ev if e["dir"] == "dove"][:4]}


# ---------------------------------------------------------------- fetching
DIAG = {}


def get(url, timeout=12):
    try:
        r = requests.get(url, headers=UA, timeout=(5, timeout))
        if "charset" not in (r.headers.get("Content-Type") or "").lower():
            r.encoding = "utf-8"
        DIAG[url[:120]] = r.status_code
        return r.text if r.status_code == 200 else None
    except Exception as e:
        DIAG[url[:120]] = type(e).__name__
        return None


def page_text(h):
    h = re.sub(r"(?is)<(script|style|nav|header|footer|aside|form|noscript)[^>]*>.*?</\1>", " ", h)
    m = re.search(r"(?is)<(main|article)[^>]*>(.*)</\1>", h) or re.search(r'(?is)<div[^>]+(?:id|class)="[^"]*(?:article|content|main|post)[^"]*"[^>]*>(.*)', h)
    body = m.group(m.lastindex) if m else h
    body = re.sub(r"(?i)</(p|div|li|h\d|br|tr)>|<br\s*/?>", "\n", body)
    t = _html.unescape(re.sub(r"(?s)<[^>]+>", " ", body))
    t = re.sub(r"[ \t\r\f\v]+", " ", t)
    return re.sub(r"\n\s*\n+", "\n", t).strip()


def rss_items(xml):
    out = []
    for it in re.findall(r"(?s)<(?:item|entry)\b[^>]*>(.*?)</(?:item|entry)>", xml or ""):
        def tag(n):
            m = re.search(r"(?s)<%s\b[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</%s>" % (n, n), it)
            return _html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip() if m else ""
        link = tag("link") or (re.search(r'<link[^>]+href="([^"]+)"', it) or [None, ""])[1]
        out.append({"title": tag("title"), "link": link.strip(), "date": tag("pubDate") or tag("dc:date") or tag("updated") or tag("published"),
                    "desc": tag("description")[:300]})
    return out


def parse_date(s):
    if not s:
        return None
    for f in ("%a, %d %b %Y %H:%M:%S %Z", "%a, %d %b %Y %H:%M:%S %z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            d = dt.datetime.strptime(s.strip().replace("GMT", "+0000") if "%z" in f else s.strip(), f)
            return (d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)).astimezone(dt.timezone.utc).isoformat()
        except ValueError:
            continue
    return None


TYPES = [("statement", r"monetary policy summary|statement on monetary policy|fomc statement|monetary policy decision|policy rate|interest rate decision|bank rate (?:maintained|increased|reduced|cut|raised)|statement on monetary policy|maintains|lowers|raises|holds"),
         ("minutes", r"minutes|account of the monetary|summary of (?:deliberations|opinions)"),
         ("press_conference", r"press conference|opening statement"),
         ("testimony", r"testimony|before the committee"),
         ("speech", r"speech|remarks|lecture|address|keynote|fireside|panel"),
         ("interview", r"interview")]
SKIP = r"enforcement|termination|application|announces (?:approval|denial)|reserve requirements|consumer|discount rate meetings|job|career|museum|banknote|statistics release|supervis|payments|cbdc|digital euro|consultation"


def classify(title):
    t = title.lower()
    if re.search(SKIP, t):
        return None
    for k, p in TYPES:
        if re.search(p, t):
            return k
    return None


NAME = re.compile(r"(?:(?:speech|remarks|testimony|lecture|address|interview)\s+(?:by|with)\s+|[-–—:]\s*(?:speech|remarks)\s+by\s+)((?:Governor|Vice Chair(?:man)?(?: for Supervision)?|Chair(?:man)?|President|Deputy Governor|Senior Deputy Governor|Executive Director)?\s*[A-Z][\w.'’-]+(?:\s+[A-Z][\w.'’-]+){0,3})")


KNOWN = r"\b(Powell|Jefferson|Waller|Bowman|Barr|Cook|Kugler|Miran|Logan|Hammack|Musalem|Kashkari|Goolsbee|Daly|Bostic|Williams|Barkin|Schmid|Collins|Harker|Lagarde|Schnabel|Lane|de Guindos|Cipollone|Elderson|Bailey|Pill|Lombardelli|Breeden|Greene|Mann|Dhingra|Taylor|Macklem|Rogers|Gravelle|Kozicki|Vincent|Mendes|Ueda|Himino|Uchida)\b"


def speaker_of(title, text, typ):
    """Canonical surname so one person's remarks line up for the speaker baseline."""
    if typ in ("statement", "minutes"):
        return "Committee"
    m = re.search(KNOWN, title) or re.search(KNOWN, text[:600])
    if m:
        return m.group(1)
    m = NAME.search(title) or NAME.search(text[:600])
    if m:
        return re.sub(r"\s+(?:on|at|to|before|in)$", "", m.group(1).strip().rstrip(","))
    return "Unattributed"


def collect(bank, cfg, known):
    items = []
    for f in cfg.get("feeds", []):
        items += [dict(i, src=f) for i in rss_items(get(f))]
    for lst in cfg.get("lists", []):
        h = get(lst) or ""
        for href, title in re.findall(r'<a[^>]+href="(https://www\.bankofcanada\.ca/20\d\d/\d\d/[^"]+/)"[^>]*>\s*([^<]{12,160})</a>', h):
            items.append({"title": _html.unescape(title).strip(), "link": href, "date": "", "src": lst})
    seen, out = set(), []
    for it in items:
        if not it["link"] or it["link"] in seen:
            continue
        seen.add(it["link"])
        typ = classify(it["title"])
        if not typ:
            continue
        pub = parse_date(it["date"])
        if not pub:
            m = re.search(r"/(20\d\d)/(\d\d)/[^/]*?(?:(20\d\d)-(\d\d)-(\d\d))?/?$", it["link"])
            pub = f"{m.group(3) or m.group(1)}-{m.group(4) or m.group(2)}-{m.group(5) or '01'}T12:00:00+00:00" if m else None
        if pub and dt.datetime.fromisoformat(pub) < NOW - dt.timedelta(days=120):
            continue
        out.append(dict(it, type=typ, published_at=pub))
    return out[:25]


# ---------------------------------------------------------------- baselines (Layer B) and confidence
def baselines(doc, docs):
    prior = [d for d in docs if d["bank"] == doc["bank"] and d["id"] != doc["id"] and d.get("policy_relevant", True) and (d.get("published_at") or "") < (doc.get("published_at") or "")]
    sp = [d for d in prior if d["speaker"] == doc["speaker"] and d["speaker"] not in ("Committee", "Unattributed")]
    cut = (dt.datetime.fromisoformat(doc["published_at"]) - dt.timedelta(days=60)).isoformat() if doc.get("published_at") else ""
    sp60 = [d for d in sp if d.get("published_at", "") >= cut]
    low = len(sp60) < 2
    use = sp60 if not low else sorted(sp, key=lambda d: d.get("published_at", ""))[-3:]
    b = {}
    if use:
        m = sum(d["score"] for d in use) / len(use)
        b["speaker"] = {"mean": round(m, 1), "n": len(use), "since": min(d["published_at"][:10] for d in use), "low_confidence": low,
                        "change": round(doc["score"] - m, 1)}
    st = sorted([d for d in prior if d["type"] == "statement"], key=lambda d: d.get("published_at", ""))
    if st:
        s = st[-1]
        b["institution"] = {"score": s["score"], "date": (s.get("published_at") or "")[:10], "title": s["title"][:120], "change": round(doc["score"] - s["score"], 1)}
    return b


def confidence(doc):
    pts, why = 0, []
    if doc["words"] >= 700: pts += 1
    else: why.append("short text")
    if len(doc["evidence"]) >= 4: pts += 1
    else: why.append("few scored sentences")
    sb = doc["baseline"].get("speaker")
    if doc["speaker"] == "Committee" or (sb and not sb["low_confidence"]): pts += 1
    else: why.append("thin speaker baseline")
    if doc.get("transcript_status") == "official": pts += 1
    return {"level": "High" if pts >= 4 else "Medium" if pts >= 2 else "Low", "why": why}


VOTE = {"boc": "NOT_APPLICABLE"}   # BoC decides by consensus; other banks' voting rights are date-specific -> UNKNOWN unless verified


# ---------------------------------------------------------------- git publish (same pattern as intel.py / world.py)
def sh(*a, cwd=ROOT, check=True):
    return subprocess.run(a, cwd=cwd, check=check, capture_output=True, text=True)


def load_prev():
    sh("git", "fetch", "-q", "origin", BRANCH, check=False)
    r = sh("git", "show", f"origin/{BRANCH}:{FILE}", check=False)
    try:
        return json.loads(r.stdout) if r.returncode == 0 else {}
    except Exception:
        return {}


def publish(body):
    for k, v in (("user.name", "desk-policy-bot"), ("user.email", "41898282+github-actions[bot]@users.noreply.github.com")):
        sh("git", "config", k, v)
    sh("git", "worktree", "prune", check=False)
    if sh("git", "ls-remote", "--exit-code", "--heads", "origin", BRANCH, check=False).returncode == 0:
        sh("git", "worktree", "add", "-f", "-B", BRANCH, WT, f"origin/{BRANCH}")
    else:
        sh("git", "worktree", "add", "--detach", WT)
        sh("git", "checkout", "-q", "--orphan", BRANCH, cwd=WT)
        sh("git", "rm", "-rqf", ".", cwd=WT, check=False)
    with open(os.path.join(WT, FILE), "w") as f:
        json.dump(body, f, ensure_ascii=False, separators=(",", ":"))
    sh("git", "add", FILE, cwd=WT)
    if sh("git", "diff", "--cached", "--quiet", cwd=WT, check=False).returncode == 0:
        print("no change"); return
    sh("git", "commit", "-qm", f"policy intel {NOW.isoformat(timespec='minutes')}", cwd=WT)
    sh("git", "push", "-q", "origin", f"HEAD:{BRANCH}", cwd=WT)
    print("published")


def event_day():
    today = NOW.date().isoformat()
    return any(c[1] == today for c in CALENDAR)


def main():
    if "--if-due" in sys.argv and not event_day() and NOW.minute >= 15:
        print("ordinary day - hourly cadence; skipping this quarter-hour"); return
    prev = load_prev()
    docs = {d["id"]: d for d in prev.get("docs", [])}
    status = {}
    cap = 15 if "--backfill" in sys.argv else 5
    for bank, cfg in BANKS.items():
        new = 0
        DIAG.clear()
        found = collect(bank, cfg, docs)
        status[bank] = {"checked_at": NOW.isoformat(), "found": len(found), "sources": dict(DIAG)}
        for it in found:
            did = hashlib.sha1(it["link"].encode()).hexdigest()[:12]
            if did in docs and docs[did].get("hash") and docs[did].get("av") == AV and (NOW - dt.datetime.fromisoformat(docs[did]["fetched_at"])) < dt.timedelta(days=2):
                continue      # re-read recent items for revisions; older items are kept as stored
            if new >= cap:
                break         # per-bank, per-run budget: be gentle with the banks' sites
            h = get(it["link"], 20)
            time.sleep(1)
            if not h:
                continue
            if it["type"] == "minutes":   # announcement pages link to the full minutes / account / summary
                m = re.search(r'href="([^"]*(?:fomcminutes\d+\.htm|/press/accounts/\d{4}/html/[^"]+\.en\.html|summary-governing-council-deliberations[^"]*))"', h)
                if m:
                    u = m.group(1) if m.group(1).startswith("http") else re.match(r"https://[^/]+", it["link"]).group(0) + m.group(1)
                    h2 = get(u, 25)
                    if h2:
                        h, it["link_full"] = h2, u
            text = page_text(h)
            if len(text) < 300:
                continue
            hsh = hashlib.sha256(text.encode()).hexdigest()[:16]
            old = docs.get(did)
            if old and old.get("hash") == hsh and old.get("av") == AV:
                old["fetched_at"] = NOW.isoformat(); continue
            a = analyse(text)
            d = {"id": did, "bank": bank, "title": it["title"][:200], "type": it["type"], "url": it.get("link_full") or it["link"], "page": it["link"], "published_at": it.get("published_at"),
                 "fetched_at": NOW.isoformat(), "hash": hsh, "version": (old or {}).get("version", 0) + 1, "words": len(text.split()),
                 "source_type": "official", "transcript_status": "official", "speaker": speaker_of(it["title"], text, it["type"]),
                 "voting_status": "NOT_APPLICABLE" if it["type"] in ("statement", "minutes") and bank != "boc" else VOTE.get(bank, "UNKNOWN"),
                 **a}
            if old and old.get("hash") and old.get("hash") != hsh:
                d["revised_from"] = {"hash": old["hash"], "fetched_at": old["fetched_at"], "score": old["score"]}
            docs[did] = d
            new += 1
    allv = sorted(docs.values(), key=lambda d: d.get("published_at") or "", reverse=True)[:300]
    for d in allv:
        d["baseline"] = baselines(d, allv)
        d["confidence"] = confidence(d)
    # institutional stance per bank: latest committee document, plus the average of individual remarks since it
    stance = {}
    for bank in BANKS:
        b = [d for d in allv if d["bank"] == bank and d.get("policy_relevant", True)]
        st = next((d for d in b if d["type"] in ("statement", "press_conference")), None)
        since = [d for d in b if d["type"] in ("speech", "testimony", "interview") and (not st or (d.get("published_at") or "") > (st.get("published_at") or ""))]
        stance[bank] = {"statement": {k: st[k] for k in ("id", "title", "score", "label", "published_at")} if st else None,
                        "speeches_since": len(since), "speeches_mean": round(sum(d["score"] for d in since) / len(since), 1) if since else None,
                        "latest": b[0]["id"] if b else None}
    body = {"updated_at": NOW.isoformat(), "calendar": [{"bank": c[0], "date": c[1], "time": c[2], "tz": c[3], "what": c[4], "kind": c[5]} for c in CALENDAR],
            "calendar_asof": CAL_ASOF, "banks": {k: {"name": v["name"], "cc": v["cc"]} for k, v in BANKS.items()},
            "status": status, "stance": stance, "docs": allv,
            "method": "Sentence-level theme lexicon, negation flips, conditional language at half weight; score = 10·(H−D)/(H+D+3), "
                      "labels ≥+5 hawkish, ≥+2 leaning hawkish, ≤−2 leaning dovish, ≤−5 dovish. Forward guidance read separately."}
    print({k: (v["found"], v["sources"]) for k, v in status.items()})
    if "--dry-run" in sys.argv:
        print(json.dumps(allv[:2], indent=1)[:3000]); return
    publish(body)


if __name__ == "__main__":
    main()
